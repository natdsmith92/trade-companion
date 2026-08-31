import { Level, ParsedPlan } from "./types";

// Source-grounded verification: the anti-hallucination guarantee for parsed plans.
//
// THE IDEA
// Level extraction has a property most LLM tasks lack: every correct output is
// derivable from the input. So correctness is CHECKABLE, not merely votable.
// That is why this exists instead of an ensemble of models voting — a vote is
// probabilistic and needs a referee that is itself an unchecked LLM, whereas
// this is proof, costs zero API calls, and runs in milliseconds.
//
// WHAT IT DOES NOT CATCH
//
// 1. Omissions. A level present in the email that the parser skipped looks
//    identical to a level that was never there. Measured instead by the eval
//    suite and by the user's inline confidence corrections. This is not
//    hypothetical: on one real email the regex parser found 34 levels where
//    the LLM found 67, and verification passed both, because everything each
//    reported was genuinely in the text.
//
// 2. A MISREAD date, as opposed to an invented one. Observed for real:
//    "Can Bulls Finish Off the July 4th Week Strong? July 2nd Plan" — the
//    regex parser returned July 4th, having matched the first date in the
//    subject rather than the one naming the session. dateAppearsInSource()
//    returns true, correctly: July 4th IS in the text. The check can prove a
//    date was not fabricated; it cannot prove the right date was chosen.
//    That plan would have been filed one session late, silently.
//
//    This is a large part of why the LLM is the primary parser and the regex
//    path is bannered as degraded rather than treated as equivalent.
//
// WHY "DERIVABLE" AND NOT "VERBATIM"  ← the correction that matters
// A first pass of this design required every level to appear verbatim in the
// body. That was wrong, and parser.ts:5-8 documents exactly why: Mancini writes
// range shorthand ("6778-82" means 6778 AND 6782; "6820-6822" means 6820 and
// 6822). Neither endpoint of "6778-82" appears verbatim as a 4-digit level, so
// verbatim matching would reject correct parses and quietly constrain the LLM
// to whatever the regex already handles — deleting the reason to have an LLM.
//
// A companion rule was also dropped: "level count must be within a band of the
// regex parser's count". The regex parser can legitimately return ZERO levels
// (that is the failure mode motivating the LLM parser at all), and zero is not
// within a sane band of forty-seven. Gating the LLM on the regex inverts the
// design: it blocks precisely the emails the LLM exists to rescue.
//
// The expansion rules below MUST stay in lockstep with extractLevels() in
// parser.ts. If that function's range handling changes, change this too, and
// extend the fixtures.

export interface VerificationIssue {
  kind: "unsourced_level" | "unsourced_date" | "no_levels";
  detail: string;
  value?: number | string;
}

export interface VerificationResult {
  ok: boolean;
  issues: VerificationIssue[];
  /** Levels that could not be traced back to the source text. */
  unsourced: number[];
  /** How many levels were checked. */
  checked: number;
}

export interface VerifyOptions {
  /**
   * Minimum levels required to consider a parse publishable. A plan with no
   * levels is not a plan. Kept separate from sourcing so the caller can
   * distinguish "hallucinated" from "empty".
   */
  minLevels?: number;
  /**
   * Session date the parse claims. Verified against the source separately
   * because the regex parser invents one via fallbackNextTradingDay() when it
   * cannot find a date, and a plan filed under the wrong day is worse than no
   * plan at all.
   */
  requireDateInSource?: boolean;
}

/**
 * Every number in the source text, plus every value derivable from range
 * shorthand. This is the set a parsed level is allowed to come from.
 *
 *   "6685"        ──▶ {6685}
 *   "6778-82"     ──▶ {6778, 6782}          (2-digit tail completes the prefix)
 *   "6820-6822"   ──▶ {6820, 6822}          (explicit both ends)
 *   "6,120"       ──▶ {6120}                (thousands separator)
 *   "6120/22"     ──▶ {6120, 6122}          (slash shorthand)
 */
export function derivableNumbers(text: string): Set<number> {
  const out = new Set<number>();
  if (!text) return out;

  // Normalize thousands separators so "6,120" reads as "6120". Only between
  // digits, so ordinary comma-separated prose is untouched.
  const normalized = text.replace(/(\d),(\d{3})\b/g, "$1$2");

  // Base numbers with optional range tails, mirroring parser.ts's levelRegex
  // but also accepting "/" as the separator, which appears in prose.
  const re = /(\d{4,5})(?:\s*[-/]\s*(\d{2,5}))?/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(normalized)) !== null) {
    const base = parseInt(m[1], 10);
    out.add(base);

    if (m[2]) {
      const tail = m[2];
      let end: number;
      if (tail.length >= m[1].length) {
        // "6820-6822" — the tail is a full number.
        end = parseInt(tail, 10);
      } else {
        // "6778-82" — graft the tail onto the base's leading digits.
        const prefix = m[1].slice(0, m[1].length - tail.length);
        end = parseInt(prefix + tail, 10);
      }
      out.add(end);
      // Ranges name their endpoints; intermediate ticks are not asserted by
      // the source, so they are deliberately NOT added.
    }
  }

  return out;
}

/** True when the parsed session date actually appears in the source text. */
export function dateAppearsInSource(sessionDate: string, text: string): boolean {
  if (!sessionDate || !text) return false;

  const [y, m, d] = sessionDate.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return false;

  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const month = monthNames[m - 1];
  const hay = text.toLowerCase();

  // Accept the forms a newsletter actually uses: ISO, US numeric with or
  // without a leading zero, and "Month D" / "Mon D" with optional ordinal.
  const candidates = [
    sessionDate,
    `${m}/${d}`,
    `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`,
    `${m}/${d}/${y}`,
    `${m}/${d}/${String(y).slice(2)}`,
  ];
  if (candidates.some((c) => hay.includes(c.toLowerCase()))) return true;

  const dayPattern = `${d}(?:st|nd|rd|th)?`;
  const monthPattern = `${month}|${month.slice(0, 3)}`;
  return new RegExp(`\\b(?:${monthPattern})\\.?\\s+${dayPattern}\\b`, "i").test(hay);
}

/**
 * Verify a parsed plan against the email it came from.
 *
 * Returns ok:false when any level cannot be traced to the source, when the
 * plan has too few levels to be useful, or when the session date was invented.
 * A failing result must block publication — a confidently wrong ladder is
 * worse than a visibly absent one.
 */
export function verifyAgainstSource(
  plan: ParsedPlan,
  sourceText: string,
  opts: VerifyOptions = {},
): VerificationResult {
  const { minLevels = 3, requireDateInSource = true } = opts;

  const allowed = derivableNumbers(sourceText);
  const levels: Level[] = [...(plan.supports ?? []), ...(plan.resistances ?? [])];
  const issues: VerificationIssue[] = [];
  const unsourced: number[] = [];

  for (const lvl of levels) {
    if (!allowed.has(lvl.price)) {
      unsourced.push(lvl.price);
      issues.push({
        kind: "unsourced_level",
        detail: `${lvl.type} ${lvl.price} does not appear in the email and is not derivable from its range shorthand`,
        value: lvl.price,
      });
    }
  }

  if (levels.length < minLevels) {
    issues.push({
      kind: "no_levels",
      detail: `parsed only ${levels.length} level(s); minimum for publication is ${minLevels}`,
      value: levels.length,
    });
  }

  if (requireDateInSource && !dateAppearsInSource(plan.sessionDate, sourceText)) {
    issues.push({
      kind: "unsourced_date",
      detail:
        `session date ${plan.sessionDate} does not appear in the email — ` +
        `this is the signature of parser.ts's fallbackNextTradingDay() inventing one`,
      value: plan.sessionDate,
    });
  }

  return { ok: issues.length === 0, issues, unsourced, checked: levels.length };
}
