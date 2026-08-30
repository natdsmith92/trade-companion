import OpenAI from "openai";

// Shared LLM call surface for every OpenAI JSON call in the app.
//
// WHY A DISCRIMINATED RESULT INSTEAD OF `null`
// generate-tldr.ts returns bare `null` on every distinct failure: missing key,
// empty completion, invalid structure. That is fine for an optional TL;DR and
// wrong everywhere else, because the ingest pipeline's retry rule is
// "retry transient failures twice, never retry a schema rejection, then fall
// back to the regex parser". A caller holding `null` cannot tell a timeout
// (retry) from a malformed response (do not retry), so the rule silently
// degrades into "any failure falls back immediately" and the LLM parser's
// advantage is burned on blips.
//
//   callLLMJson()
//     ├── ok:true  ──▶ data (already passed the caller's validator)
//     └── ok:false ──▶ reason:
//                        no_key    — env not configured; never retryable
//                        timeout   — network/timeout/5xx/429; retryable
//                        refusal   — model returned nothing; not retryable
//                        malformed — unparseable or failed validation; not retryable
//
// Retry policy lives here so it is written once and testable without a network.

export type LLMFailureReason = "no_key" | "timeout" | "refusal" | "malformed";

export type LLMResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; reason: LLMFailureReason; detail: string };

export interface LLMCallOptions<T> {
  /** System prompt. */
  system: string;
  /** User content (typically the email body). */
  user: string;
  /**
   * Narrowing validator. Return the typed value, or throw to signal the
   * response was structurally wrong. Throwing yields reason:"malformed".
   */
  validate: (parsed: unknown) => T;
  model?: string;
  maxCompletionTokens?: number;
  /**
   * OpenAI reasoning effort. Defaults to "high" to match generate-tldr.ts.
   * Note that "high" is a 30-60s call — the sweep budgets for this.
   */
  reasoningEffort?: "low" | "medium" | "high";
  /** Retries for transient failures only. Default 2. */
  maxRetries?: number;
  /** Per-attempt timeout in ms. Default 90s. */
  timeoutMs?: number;
  /** Label used in logs so failures are attributable to a call site. */
  label: string;
}

const RETRYABLE: LLMFailureReason[] = ["timeout"];

function classifyError(err: unknown): { reason: LLMFailureReason; detail: string } {
  const e = err as { status?: number; name?: string; message?: string };
  const message = e?.message ?? String(err);

  // Abort from our own timeout, plus transport-level failures.
  if (e?.name === "AbortError" || /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(message)) {
    return { reason: "timeout", detail: message };
  }
  // Rate limit and server errors are worth another attempt.
  if (e?.status === 429 || (typeof e?.status === "number" && e.status >= 500)) {
    return { reason: "timeout", detail: `HTTP ${e.status}: ${message}` };
  }
  // 4xx other than 429 is a request problem; retrying reproduces it.
  return { reason: "malformed", detail: message };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callLLMJson<T>(opts: LLMCallOptions<T>): Promise<LLMResult<T>> {
  const {
    system,
    user,
    validate,
    model = "gpt-5.5",
    maxCompletionTokens = 16000,
    reasoningEffort = "high",
    maxRetries = 2,
    timeoutMs = 90_000,
    label,
  } = opts;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "no_key", detail: "OPENAI_API_KEY not set" };
  }

  const client = new OpenAI({ apiKey });
  let last: { reason: LLMFailureReason; detail: string } = {
    reason: "timeout",
    detail: "no attempt made",
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const completion = await client.chat.completions.create(
        {
          model,
          max_completion_tokens: maxCompletionTokens,
          reasoning_effort: reasoningEffort,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { signal: controller.signal },
      );

      const raw = completion.choices[0]?.message?.content?.trim();
      if (!raw) {
        // The model produced nothing. Retrying a refusal reproduces it.
        return {
          ok: false,
          reason: "refusal",
          detail: `${label}: empty completion`,
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return {
          ok: false,
          reason: "malformed",
          detail: `${label}: response was not valid JSON: ${(e as Error).message}`,
        };
      }

      try {
        return { ok: true, data: validate(parsed), raw };
      } catch (e) {
        return {
          ok: false,
          reason: "malformed",
          detail: `${label}: failed validation: ${(e as Error).message}`,
        };
      }
    } catch (err) {
      last = classifyError(err);
      if (!RETRYABLE.includes(last.reason) || attempt === maxRetries) {
        return { ok: false, reason: last.reason, detail: `${label}: ${last.detail}` };
      }
      // Exponential backoff: 1s, 2s.
      await sleep(1000 * Math.pow(2, attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reason: last.reason, detail: `${label}: ${last.detail}` };
}

/** True when a reason is worth another attempt at a higher layer. */
export function isRetryable(reason: LLMFailureReason): boolean {
  return RETRYABLE.includes(reason);
}
