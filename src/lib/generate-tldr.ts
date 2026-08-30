import OpenAI from "openai";
import { createAdminSupabase } from "./supabase-server";
import { TldrData } from "./tldr-types";

const SYSTEM_PROMPT = `You are a trading analyst summarizing Adam Mancini's daily ES futures plan for a trader who needs to act on it quickly.

Given the raw email body, produce a JSON object with this exact structure. Return ONLY valid JSON — no markdown fences, no preamble, no explanation.

{
  "headline": "One sentence — the directional thesis for today's session. Example: 'Bullish above 5520, targeting 5560-5580 if dips hold 5500.' Keep it under 100 characters, trading-style, no fluff.",
  "stats": [
    // Exactly 3 stat cards. Pick the 3 most relevant from:
    // - Rally/selloff magnitude in points from a key swing low/high
    // - Duration of the current move (days or weeks)
    // - The key bull/bear decision level for the session
    // - Overnight range or gap size
    // - Key Failed Breakdown level to watch
    // Each stat needs: label, value, color (bull|bear|gold|blue), subtitle
    { "label": "...", "value": "...", "color": "bull", "subtitle": "..." }
  ],
  "sections": [
    {
      "title": "WARNINGS",
      "icon": "⚠",
      "color": "bear",
      "insights": [
        // 2-3 caution items. What could go wrong today? Traps to avoid?
        // Common warnings: chasing first bounces after sell days, low-volatility = few setups,
        // first supports after big rips getting crushed, late-day reversals
        // Tag each as "Caution", tagType "caution"
      ]
    },
    {
      "title": "BEST SETUPS",
      "icon": "★",
      "color": "bull",
      "insights": [
        // 2-3 of the highest-quality trade setups from the email
        // Rate as "A+ Setup" (best on the board), "A Setup" (strong), or "Structure" (context level)
        // tagType: "opportunity" for A+/A setups, "key" for structure
        // Always mention the specific price, when it formed, why it matters
      ]
    },
    {
      "title": "BIG PICTURE",
      "icon": "📐",
      "color": "gold",
      "insights": [
        // 1-2 context items. Where are we in the larger move?
        // Reference the origin of the current rally/selloff, runner status, multi-day trends
        // Tag as "Context", tagType "context"
      ]
    },
    {
      "title": "DECISION TREE",
      "icon": "🎯",
      "color": "blue",
      "insights": [
        // Exactly 3 scenarios. tagType "key" for all three.
        { "tag": "If Bullish", "text": "what levels hold, what triggers, what targets" },
        { "tag": "If Bearish", "text": "what levels fail, what breaks down, where it goes" },
        { "tag": "If Boring", "text": "always: do nothing, hold runners, wait for volatility" }
      ]
    }
  ]
}

Formatting rules for the "text" field in each insight:
- Wrap all price numbers in <span class="num">PRICE</span>
- Use <strong>bold</strong> for key warnings, conclusions, or action items
- Write in Mancini's direct trading style — concise, no fluff
- Abbreviate "Failed Breakdown" as "FB" always
- Use → for directional flows (e.g. "6700 → 6716 → 6738")
- Keep each insight to 1-3 sentences max
- The "If Boring" scenario should always conclude with do nothing / hold runners / wait

Additionally, include a top-level "fbSetups" array — polished Failed Breakdown (FB) setup recommendations extracted from the email. For each FB setup mentioned:

{
  "fbSetups": [
    {
      "level": 7147,
      "quality": "A+",
      "action": "Buy if price flushes below <span class=\"num\">7147</span> and <strong>recovers back above within 15 minutes</strong>",
      "context": "12:50PM low set — FB here targets <span class=\"num\">7180</span> → <span class=\"num\">7200</span>",
      "invalidation": "Closes below 7130 on 15m candle"
    }
  ]
}

Rules for fbSetups:
- Extract EVERY specific FB level or FB watch mentioned in the email
- quality: "A+" = high quality pre-planned FB, "A" = decent FB with confirmation, "B" = low quality / needs extra confirmation, "Watch" = just monitor, not a direct trade
- action: What exactly to do — be specific about entry trigger (flush + recover pattern)
- context: Why this level matters — reference how it formed, target levels after FB triggers
- invalidation: What kills the setup — a close below, time decay, etc.
- If the email says "I would NOT buy X again" — mark it as "Watch" quality with explanation
- If no FB setups are mentioned, return an empty array []
- Wrap prices in <span class="num">PRICE</span>, key actions in <strong>bold</strong>`;

export async function generateTldr(
  planId: string,
  emailBody: string
): Promise<TldrData | null> {
  // env.ts validates at server start; we re-read to keep this function
  // testable without a global mock.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set — skipping TL;DR generation");
    return null;
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-5.5",
      max_completion_tokens: 16000,
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Here is today's Mancini email. Generate the TL;DR JSON:\n\n${emailBody}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      console.error("No content in OpenAI response");
      return null;
    }

    const tldr: TldrData = JSON.parse(raw);

    // Validate basic structure
    if (!tldr.stats || !tldr.sections || !Array.isArray(tldr.stats) || !Array.isArray(tldr.sections)) {
      console.error("Invalid TL;DR structure from OpenAI");
      return null;
    }

    // Ensure fbSetups is at least an empty array
    if (!tldr.fbSetups || !Array.isArray(tldr.fbSetups)) {
      tldr.fbSetups = [];
    }

    // Ensure headline has a fallback
    if (!tldr.headline || typeof tldr.headline !== "string") {
      tldr.headline = "";
    }

    // Write to database
    const supabase = createAdminSupabase();
    const { error } = await supabase
      .from("plans")
      .update({ tldr })
      .eq("id", planId);

    if (error) {
      console.error("Failed to save TL;DR to database:", error);
      // Still return the data even if save failed
    } else {
      console.log(`[${new Date().toISOString()}] TL;DR generated and cached for plan ${planId}`);
    }

    return tldr;
  } catch (err) {
    console.error("TL;DR generation failed:", err);
    return null;
  }
}
