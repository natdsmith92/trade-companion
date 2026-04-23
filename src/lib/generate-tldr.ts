import Anthropic from "@anthropic-ai/sdk";
import { createAdminSupabase } from "./supabase-server";
import { TldrData } from "./tldr-types";

const SYSTEM_PROMPT = `You are a trading analyst summarizing Adam Mancini's daily ES futures plan for a trader who needs to act on it quickly.

Given the raw email body, produce a JSON object with this exact structure. Return ONLY valid JSON — no markdown fences, no preamble, no explanation.

{
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
- The "If Boring" scenario should always conclude with do nothing / hold runners / wait`;

export async function generateTldr(
  planId: string,
  emailBody: string
): Promise<TldrData | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set — skipping TL;DR generation");
    return null;
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here is today's Mancini email. Generate the TL;DR JSON:\n\n${emailBody}`,
        },
      ],
    });

    // Extract text from response
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.error("No text block in Claude response");
      return null;
    }

    // Strip markdown fences if present
    let raw = textBlock.text.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const tldr: TldrData = JSON.parse(raw);

    // Validate basic structure
    if (!tldr.stats || !tldr.sections || !Array.isArray(tldr.stats) || !Array.isArray(tldr.sections)) {
      console.error("Invalid TL;DR structure from Claude");
      return null;
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
