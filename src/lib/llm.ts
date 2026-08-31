import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

// Shared LLM call surface. Claude (Anthropic SDK) for every model call.
//
// WHY A DISCRIMINATED RESULT INSTEAD OF `null`
// The ingest pipeline's rule is "retry transient failures twice, never retry a
// schema rejection, then fall back to the regex parser". A caller holding a
// bare `null` cannot tell a timeout (retry) from a malformed response (do not
// retry), so the rule silently degrades into "any failure falls back
// immediately" and the LLM parser's advantage is burned on blips.
//
//   callLLMJson()
//     ├── ok:true  ──▶ data, already validated against the Zod schema
//     └── ok:false ──▶ reason:
//                        no_key    — env not configured; never retryable
//                        timeout   — network/timeout/5xx/429; retryable
//                        refusal   — safety decline or empty turn; not retryable
//                        malformed — schema mismatch after parsing; not retryable
//
// WHY STRUCTURED OUTPUTS AND NOT PROMPT-FOR-JSON
// Claude constrains the response to the schema server-side via
// `output_config.format`, and `messages.parse()` returns it already typed. That
// removes the whole class of "asked for JSON, got prose with JSON inside it"
// failures. Note the assistant-prefill trick (seeding a `{`) that older
// guides recommend is REJECTED with a 400 on current models — structured
// outputs is the supported replacement, not a nicety.
//
// MODEL
// claude-opus-5 for everything. Volume here is one to three emails a day, so
// the cost difference against a smaller model is pennies, while a misread
// price level is money. Depth is tuned per call site with `effort` instead:
// the classifier runs `low`, the parser runs `high`.

export type LLMFailureReason = "no_key" | "timeout" | "refusal" | "malformed";

export type LLMResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: LLMFailureReason; detail: string };

export const DEFAULT_MODEL = "claude-opus-5";

export interface LLMCallOptions<S extends z.ZodType> {
  /** System prompt. Top-level on Anthropic, not a message with role "system". */
  system: string;
  /** User content (typically the email body). */
  user: string;
  /** Zod schema. The response is constrained to it and returned typed. */
  schema: S;
  model?: string;
  maxTokens?: number;
  /**
   * Thinking depth and overall token spend: low | medium | high | xhigh | max.
   * Not a model downgrade — same model, less deliberation.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Retries for transient failures only. Default 2. */
  maxRetries?: number;
  /** Per-attempt timeout in ms. Default 90s. */
  timeoutMs?: number;
  /** Label used in logs so failures are attributable to a call site. */
  label: string;
}

const RETRYABLE: LLMFailureReason[] = ["timeout"];

function classifyError(err: unknown): { reason: LLMFailureReason; detail: string } {
  // Typed SDK errors first — string-matching messages is how this rots.
  if (err instanceof Anthropic.RateLimitError) {
    return { reason: "timeout", detail: `rate limited: ${err.message}` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { reason: "timeout", detail: `connection: ${err.message}` };
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    // 5xx is worth another attempt; 4xx will reproduce exactly.
    return {
      reason: status >= 500 ? "timeout" : "malformed",
      detail: `HTTP ${status}: ${err.message}`,
    };
  }
  const message = (err as Error)?.message ?? String(err);
  if (/abort|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(message)) {
    return { reason: "timeout", detail: message };
  }
  return { reason: "malformed", detail: message };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callLLMJson<S extends z.ZodType>(
  opts: LLMCallOptions<S>,
): Promise<LLMResult<z.infer<S>>> {
  const {
    system,
    user,
    schema,
    model = DEFAULT_MODEL,
    maxTokens = 16000,
    effort = "high",
    maxRetries = 2,
    timeoutMs = 90_000,
    label,
  } = opts;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "no_key", detail: "ANTHROPIC_API_KEY not set" };
  }

  // Identity-linked keys must name the workspace the request acts in, or the
  // API rejects every call with a 400. Plain org keys do not need this, so the
  // header is only sent when configured. The failure without it is unhelpfully
  // generic at the call site — it surfaces as a malformed 400 — which is why
  // it is worth handling explicitly here.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;

  const client = new Anthropic({
    apiKey,
    timeout: timeoutMs,
    // Retries are handled in the loop below so the reason classification and
    // backoff stay in one place.
    maxRetries: 0,
    ...(workspaceId
      ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
      : {}),
  });
  let last: { reason: LLMFailureReason; detail: string } = {
    reason: "timeout",
    detail: "no attempt made",
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: maxTokens,
        // Thinking is on by default on this model family. budget_tokens was
        // removed and returns a 400 — depth is controlled by effort below.
        output_config: { effort, format: zodOutputFormat(schema) },
        system,
        messages: [{ role: "user", content: user }],
      });

      // A safety decline returns HTTP 200 with no usable content, so this has
      // to be checked before reading the result rather than caught.
      if (response.stop_reason === "refusal") {
        return {
          ok: false,
          reason: "refusal",
          detail:
            `${label}: declined` +
            (response.stop_details
              ? ` (${response.stop_details.category ?? "uncategorized"})`
              : ""),
        };
      }

      // Truncation means the schema was probably not completed. Treat it as
      // malformed rather than pretending a partial answer is an answer.
      if (response.stop_reason === "max_tokens") {
        return {
          ok: false,
          reason: "malformed",
          detail: `${label}: hit max_tokens (${maxTokens}) before completing the response`,
        };
      }

      const parsed = response.parsed_output;
      if (parsed == null) {
        return {
          ok: false,
          reason: "malformed",
          detail: `${label}: response did not parse against the schema`,
        };
      }

      return { ok: true, data: parsed as z.infer<S> };
    } catch (err) {
      last = classifyError(err);
      if (!RETRYABLE.includes(last.reason) || attempt === maxRetries) {
        return { ok: false, reason: last.reason, detail: `${label}: ${last.detail}` };
      }
      await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s
    }
  }

  return { ok: false, reason: last.reason, detail: `${label}: ${last.detail}` };
}

/** True when a reason is worth another attempt at a higher layer. */
export function isRetryable(reason: LLMFailureReason): boolean {
  return RETRYABLE.includes(reason);
}
