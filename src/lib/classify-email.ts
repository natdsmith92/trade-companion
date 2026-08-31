import { z } from "zod";
import { callLLMJson } from "./llm";

// Decides whether an inbound email is TODAY'S TRADE PLAN, something else from
// the same sender, or too ambiguous to act on.
//
// WHY THIS EXISTS
// Mancini sends more than one email a day: the morning plan, intraday updates,
// and end-of-day recaps. Parsing all of them as plans would let an afternoon
// recap overwrite the ladder mid-session — replacing the levels the user is
// actively trading against. Classification is the guard.
//
// FAIL-SAFE POSTURE (eng decision ENG 6A)
// When the LLM tie-break is unavailable, this QUARANTINES rather than falling
// through to heuristics alone. An outage is not a reason to relax the
// guarantee that only confidently-classified mail touches the ladder. A
// quarantined email is visible and one-tap approvable in the ingest inbox, so
// the cost of being cautious is one tap; the cost of being wrong is a corrupted
// ladder during live trading.
//
//   heuristics ──confident──▶ plan | not_plan          (no LLM call needed)
//        │
//    ambiguous
//        │
//        ▼
//   LLM tie-break ──ok──▶ plan | not_plan | quarantine
//        │
//   unavailable
//        │
//        ▼
//     quarantine

export type Classification = "plan" | "not_plan" | "quarantine";

export interface ClassificationResult {
  classification: Classification;
  /** Where the decision came from, for the audit trail. */
  source: "heuristic" | "llm" | "llm_unavailable";
  reason: string;
}

// Subject-line markers. Deliberately conservative: these only short-circuit
// the LLM when the signal is unambiguous.
const RECAP_MARKERS = [
  "recap", "review", "wrap", "summary of", "how we did", "results",
  "end of day", "eod", "aftermath",
];
const UPDATE_MARKERS = [
  "update", "alert", "intraday", "midday", "adjustment", "revised note",
];
const PLAN_MARKERS = [
  "trade plan", "game plan", "the plan", "es levels", "levels for",
  "premarket", "pre-market", "morning note",
];

// Calibrated against 25 real subjects pulled from Postmark. Every plan email
// ends with a session date, essentially always followed by "Plan":
//
//   "Are Bulls Running Out Of Steam In SPX? July 14 Plan"
//   "Can Bulls Keep The Push Going Into September? August 31st Plan"
//   "[RE-SEND] Nvidia Earnings Incoming. Will It Move SPX? Aug 27 Plan"
//   "Will Todays Dip Get Bought Next Week In SPX? July 3rd/6th Plan"
//   "Bulls Bought The FOMC Dip In SPX. Will The Rally Continue? June 19/22"
//
// Matching this turns an LLM call into a string test on the morning path,
// where latency is worth the most. It stays safe because a recap or update
// subject trips RECAP_MARKERS/UPDATE_MARKERS, and mixed signals defer to the
// tie-break rather than guessing.
//
// Note the trailing "Plan" is OPTIONAL (see the June 19/22 case) and the day
// may be a pair ("3rd/6th", "19/22") when one plan covers two sessions.
const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|" +
  "aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const DATED_PLAN = new RegExp(
  `\\b(?:${MONTHS})\\.?\\s+${DAY}(?:\\s*/\\s*${DAY})?\\s*(?:plan)?\\s*\\.?\\s*$`,
  "i",
);

const SYSTEM_PROMPT = `You classify emails from Adam Mancini's ES futures newsletter.

Return ONLY JSON: {"classification": "plan" | "not_plan", "confident": true|false, "reason": "short explanation"}

"plan" means: this email contains the trade plan for an UPCOMING session —
support/resistance levels the reader will trade against, scenarios, triggers.

"not_plan" means anything else: a recap of a session that already happened, an
intraday update or alert, an administrative or marketing message.

Set "confident": false if you genuinely cannot tell. It is far better to admit
uncertainty than to guess, because misclassifying a recap as a plan would
overwrite the levels a trader is actively using.`;

const ClassifySchema = z.object({
  classification: z.enum(["plan", "not_plan"]),
  // Required, not optional: an omitted "confident" would default to confident,
  // which defeats the point of asking.
  confident: z.boolean(),
  reason: z.string(),
});

/**
 * Cheap subject-line pass. Returns null when the subject is not decisive,
 * which sends the email to the LLM tie-break.
 */
export function heuristicClassify(subject: string): Classification | null {
  const s = (subject ?? "").toLowerCase();
  if (!s) return null;

  // Strip a forwarding prefix so "Fwd: ... July 14 Plan" still ends in the
  // date pattern, and drop a "[RE-SEND]"-style tag from the front.
  const cleaned = s
    .replace(/^\s*(?:fwd|fw|re)\s*:\s*/i, "")
    .replace(/^\s*\[[^\]]*\]\s*/, "")
    .trim();

  const looksRecap = RECAP_MARKERS.some((m) => cleaned.includes(m));
  const looksUpdate = UPDATE_MARKERS.some((m) => cleaned.includes(m));
  const looksPlan =
    PLAN_MARKERS.some((m) => cleaned.includes(m)) || DATED_PLAN.test(cleaned);

  // Mixed signals are exactly the case the tie-break exists for.
  if (looksPlan && (looksRecap || looksUpdate)) return null;
  if (looksRecap || looksUpdate) return "not_plan";
  if (looksPlan) return "plan";
  return null;
}

export async function classifyEmail(
  subject: string,
  body: string,
): Promise<ClassificationResult> {
  const heuristic = heuristicClassify(subject);
  if (heuristic) {
    return {
      classification: heuristic,
      source: "heuristic",
      reason: `subject line was decisive: "${subject}"`,
    };
  }

  const llm = await callLLMJson({
    label: "classify-email",
    system: SYSTEM_PROMPT,
    // Classification needs the shape of the email, not all of it. Truncating
    // keeps this call fast, which matters because it shares the sweep's
    // timeout budget with the parse call.
    user: `Subject: ${subject || "(none)"}\n\n${body.slice(0, 4000)}`,
    // Same model as the parser, less deliberation: this is a binary call on a
    // known sender, and it sits in front of the parse call in the sweep's
    // timeout budget.
    effort: "low",
    maxTokens: 2000,
    timeoutMs: 30_000,
    schema: ClassifySchema,
  });

  if (!llm.ok) {
    // ENG 6A: fail safe, not fast.
    return {
      classification: "quarantine",
      source: "llm_unavailable",
      reason: `classifier unavailable (${llm.reason}): ${llm.detail}. Quarantined rather than guessing from heuristics alone.`,
    };
  }

  if (llm.data.confident === false) {
    return {
      classification: "quarantine",
      source: "llm",
      reason: `classifier was not confident: ${llm.data.reason || "no reason given"}`,
    };
  }

  return {
    classification: llm.data.classification,
    source: "llm",
    reason: llm.data.reason || "classified by model",
  };
}
