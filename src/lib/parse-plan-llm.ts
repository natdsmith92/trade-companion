import { z } from "zod";
import { callLLMJson, LLMFailureReason } from "./llm";
import { parseLevels } from "./parser";
import { verifyAgainstSource, VerificationResult } from "./verify-levels";
import { Level, ParsedPlan } from "./types";

// LLM plan parser, with a regex fallback and a hard publish gate.
//
// PIPELINE
//
//   email body
//       │
//       ├──▶ LLM parse ──ok──▶ verify against source ──pass──▶ PUBLISH (llm)
//       │        │                      │
//       │      fail                   fail
//       │        │                      │
//       │        ▼                      ▼
//       └──▶ regex parse ──▶ verify against source ──pass──▶ PUBLISH (regex, bannered)
//                                       │
//                                     fail
//                                       │
//                                       ▼
//                              PUBLISH NOTHING + alert
//
// WHY THE GATE EXISTS
// Auto-import removes the human who used to eyeball the email every morning.
// The gate is what replaces that check. A confidently wrong ladder is worse
// than a visibly absent one: the user trades real money off these numbers, so
// "no plan, paste manually" beats "here are some levels, one of which the
// model invented".
//
// WHY THE FALLBACK IS NOT UNCONDITIONAL
// parser.ts can return zero levels, and fallbackNextTradingDay() invents a
// session date when it cannot find one. Publishing that behind a "basic parse"
// banner would file an empty ladder under the wrong day. So the fallback is
// held to the same source-verification bar as the LLM.

export type ParseMethod = "llm" | "regex";

export interface ParseOutcome {
  published: boolean;
  method: ParseMethod | null;
  plan: ParsedPlan | null;
  /** Levels the model was unsure about, surfaced as confidence flags in the UI. */
  lowConfidence: number[];
  verification: VerificationResult | null;
  /** Machine-readable reason when published is false. */
  failureReason: string | null;
  /** Human-facing note rendered as a banner when the plan is degraded. */
  banner: string | null;
}

const SYSTEM_PROMPT = `You extract structured trade-plan data from Adam Mancini's daily ES futures newsletter.

Return ONLY JSON matching this shape:
{
  "sessionDate": "YYYY-MM-DD",
  "supports":    [{"price": 6685, "major": true, "confident": true}],
  "resistances": [{"price": 6700, "major": false, "confident": true}],
  "lean": "one sentence describing the directional bias",
  "bullTargets": [6700, 6716],
  "bearTargets": [6663, 6650],
  "triggers": ["if/then conditional rules, one per string"]
}

Rules:
- Extract ONLY price levels that appear in the email. Never infer, round, or invent a level.
- Range shorthand: "6778-82" means TWO levels, 6778 and 6782. "6820-6822" means 6820 and 6822.
  Emit both endpoints as separate levels. Do not emit intermediate values.
- "(major)" after a level means major: true. Otherwise major: false.
- sessionDate is the trading day the plan is FOR. It must appear in the email
  (subject or body). If you genuinely cannot find it, return an empty string —
  do NOT guess a date.
- Set "confident": false on any level you are unsure about (ambiguous wording,
  unclear whether it is support or resistance, unclear digits). Being honest here
  is more useful than being decisive.
- If the email is not a trade plan at all, return empty arrays.`;

// The response is constrained to this schema server-side, so the hand-rolled
// validator this replaced is gone: malformed shapes cannot come back at all.
const LevelSchema = z.object({
  price: z.number(),
  major: z.boolean(),
  // Deliberately required, not optional. Made optional, the model omits it and
  // every level silently reads as confident — which is the opposite of the
  // caution this field exists to capture.
  confident: z.boolean(),
});

const PlanSchema = z.object({
  sessionDate: z.string(),
  supports: z.array(LevelSchema),
  resistances: z.array(LevelSchema),
  lean: z.string(),
  bullTargets: z.array(z.number()),
  bearTargets: z.array(z.number()),
  triggers: z.array(z.string()),
});

type LLMPlanShape = z.infer<typeof PlanSchema>;
type LLMLevel = z.infer<typeof LevelSchema>;

function toLevels(items: LLMLevel[], type: "support" | "resistance"): Level[] {
  return items.map((l) => ({ price: l.price, type, major: !!l.major }));
}

function collectLowConfidence(p: LLMPlanShape): number[] {
  return [...p.supports, ...p.resistances]
    .filter((l) => l.confident === false)
    .map((l) => l.price);
}

/**
 * Parse an email into a plan, or decline to publish.
 *
 * Never throws. Every failure path returns published:false with a reason the
 * ingest inbox can render and the caller can alert on.
 */
export async function parsePlanFromEmail(
  body: string,
  subject?: string,
): Promise<ParseOutcome> {
  const llm = await callLLMJson({
    label: "parse-plan",
    system: SYSTEM_PROMPT,
    user: `Subject: ${subject ?? "(none)"}\n\n${body}`,
    schema: PlanSchema,
    effort: "high", // extraction accuracy is the whole point of this call
  });

  if (llm.ok) {
    const p = llm.data;
    const plan: ParsedPlan = {
      supports: toLevels(p.supports, "support"),
      resistances: toLevels(p.resistances, "resistance"),
      lean: p.lean,
      bullTargets: p.bullTargets,
      bearTargets: p.bearTargets,
      triggers: p.triggers,
      sessionDate: p.sessionDate,
    };

    const verification = verifyAgainstSource(plan, body);
    if (verification.ok) {
      return {
        published: true,
        method: "llm",
        plan,
        lowConfidence: collectLowConfidence(p),
        verification,
        failureReason: null,
        banner: null,
      };
    }

    // The model produced something, but it does not trace back to the email.
    // Fall through to regex rather than publishing unsourced numbers.
    const fallback = tryRegex(body, subject);
    return fallback.published
      ? {
          ...fallback,
          banner:
            "Basic parse — the AI parse could not be verified against the email, " +
            "so these levels come from pattern matching. Double-check before trading.",
        }
      : {
          ...fallback,
          failureReason:
            `llm_unverified: ${verification.issues.map((i) => i.detail).join("; ")}` +
            (fallback.failureReason ? ` | regex also failed: ${fallback.failureReason}` : ""),
        };
  }

  // The LLM call itself failed. llm.ts has already exhausted its retries for
  // transient reasons, so there is nothing to retry here.
  const fallback = tryRegex(body, subject);
  const reason: LLMFailureReason = llm.reason;

  if (fallback.published) {
    return {
      ...fallback,
      banner:
        reason === "no_key"
          ? "Basic parse — AI parsing is not configured. Levels come from pattern matching."
          : reason === "refusal"
            ? "Basic parse — the AI declined this email. Levels come from pattern matching; double-check before trading."
            : "Basic parse — AI parsing was unavailable. Levels come from pattern matching; double-check before trading.",
    };
  }

  return {
    ...fallback,
    failureReason: `llm_${reason}: ${llm.detail}` +
      (fallback.failureReason ? ` | regex also failed: ${fallback.failureReason}` : ""),
  };
}

/**
 * Regex fallback, held to the same source-verification bar as the LLM.
 * Exported for the eval harness.
 */
export function tryRegex(body: string, subject?: string): ParseOutcome {
  let plan: ParsedPlan;
  try {
    plan = parseLevels(body, subject);
  } catch (e) {
    return {
      published: false,
      method: null,
      plan: null,
      lowConfidence: [],
      verification: null,
      failureReason: `regex_threw: ${(e as Error).message}`,
      banner: null,
    };
  }

  const verification = verifyAgainstSource(plan, body);
  if (!verification.ok) {
    return {
      published: false,
      method: null,
      plan,
      lowConfidence: [],
      verification,
      failureReason: `regex_unverified: ${verification.issues.map((i) => i.detail).join("; ")}`,
      banner: null,
    };
  }

  // Everything the regex produced is unflagged by construction — it has no
  // notion of confidence — so treat all of it as low-confidence. The user is
  // seeing a degraded parse and the UI should say so per level, not just once
  // in a banner.
  const all = [...plan.supports, ...plan.resistances].map((l) => l.price);

  return {
    published: true,
    method: "regex",
    plan,
    lowConfidence: all,
    verification,
    failureReason: null,
    banner: null,
  };
}
