import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLib } from "./_load-ts.mjs";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=['"]?([^'"]*)['"]?$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
console.log("key present:", !!process.env.ANTHROPIC_API_KEY, "| prefix:", (process.env.ANTHROPIC_API_KEY||"").slice(0,14));
const { callLLMJson } = await loadLib("llm");
const { z } = await import("zod");
const r = await callLLMJson({
  label: "smoke", system: "You extract data. Reply with the JSON only.",
  user: "Supports are: 7373, 7382 (major). The plan is for August 31st.",
  schema: z.object({ sessionDate: z.string(), supports: z.array(z.number()) }),
  effort: "low", maxTokens: 2000,
});
console.log(JSON.stringify(r, null, 2));
