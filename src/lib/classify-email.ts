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

const SYSTEM_PROMPT = `You classify emails from Adam Mancini's ES futures newsletter.

Return ONLY JSON: {"classification": "plan" | "not_plan", "confident": true|false, "reason": "short explanation"}

"plan" means: this email contains the trade plan for an UPCOMING session —
support/resistance levels the reader will trade against, scenarios, triggers.

"not_plan" means anything else: a recap of a session that already happened, an
intraday update or alert, an administrative or marketing message.

Set "confident": false if you genuinely cannot tell. It is far better to admit
uncertainty than to guess, because misclassifying a recap as a plan would
overwrite the levels a trader is actively using.`;

interface ClassifyShape {
  classification: "plan" | "not_plan";
  confident?: boolean;
  reason?: string;
}

function validateShape(parsed: unknown): ClassifyShape {
  const p = parsed as ClassifyShape;
  if (!p || typeof p !== "object") throw new Error("not an object");
  if (p.classification !== "plan" && p.classification !== "not_plan") {
    throw new Error(`classification must be "plan" or "not_plan", got ${String(p.classification)}`);
  }
  return p;
}

/**
 * Cheap subject-line pass. Returns null when the subject is not decisive,
 * which sends the email to the LLM tie-break.
 */
export function heuristicClassify(subject: string): Classification | null {
  const s = (subject ?? "").toLowerCase();
  if (!s) return null;

  const looksRecap = RECAP_MARKERS.some((m) => s.includes(m));
  const looksUpdate = UPDATE_MARKERS.some((m) => s.includes(m));
  const looksPlan = PLAN_MARKERS.some((m) => s.includes(m));

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

  const llm = await callLLMJson<ClassifyShape>({
    label: "classify-email",
    system: SYSTEM_PROMPT,
    // Classification needs the shape of the email, not all of it. Truncating
    // keeps this call fast, which matters because it shares the sweep's
    // timeout budget with the parse call.
    user: `Subject: ${subject || "(none)"}\n\n${body.slice(0, 4000)}`,
    reasoningEffort: "low",
    maxCompletionTokens: 2000,
    timeoutMs: 30_000,
    validate: validateShape,
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
      reason: `classifier was not confident: ${llm.data.reason ?? "no reason given"}`,
    };
  }

  return {
    classification: llm.data.classification,
    source: "llm",
    reason: llm.data.reason ?? "classified by model",
  };
}
