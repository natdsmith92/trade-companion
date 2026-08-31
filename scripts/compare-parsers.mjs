// Runs both parsers over real corpus emails and compares them.
//
// This is the honest quality read the eval gate was designed to give but
// could not until there was a labeled corpus. There is still no hand-labeled
// ground truth, so this does NOT score correctness — it scores agreement and
// source-verifiability, which is what is available without human labeling:
//   - does each parse survive source verification (no invented numbers)?
//   - where do the two disagree, and which one is defensible?
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLib } from "./_load-ts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=['"]?([^'"]*)['"]?$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const N = Number(process.argv[2] ?? 5);
const DIR = join(ROOT, "evals", "corpus");
const emails = readdirSync(DIR).filter(f => f.endsWith(".json") && f !== "index.json")
  .map(f => JSON.parse(readFileSync(join(DIR, f), "utf8")))
  .filter(d => (d.Subject || "").includes("Plan"))
  .slice(0, N);

const { parsePlanFromEmail, tryRegex } = await loadLib("parse-plan-llm");
const prices = p => new Set([...(p?.supports||[]), ...(p?.resistances||[])].map(l => l.price));

let llmOk = 0, rgxOk = 0;
for (const d of emails) {
  const subj = (d.Subject || "").replace(/^Fwd:\s*/, "").slice(0, 52);
  const rgx = tryRegex(d.TextBody, d.Subject);
  const t0 = Date.now();
  const llm = await parsePlanFromEmail(d.TextBody, d.Subject);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  if (llm.published && llm.method === "llm") llmOk++;
  if (rgx.published) rgxOk++;

  const L = prices(llm.plan), R = prices(rgx.plan);
  const onlyL = [...L].filter(x => !R.has(x));
  const onlyR = [...R].filter(x => !L.has(x));

  console.log(`\n${subj}`);
  console.log(`  llm   ${llm.published ? "PUB" : "BLOCKED"} via ${llm.method ?? "-"} (${secs}s)  levels=${L.size}  date=${llm.plan?.sessionDate ?? "-"}`);
  console.log(`  regex ${rgx.published ? "PUB" : "BLOCKED"}                    levels=${R.size}  date=${rgx.plan?.sessionDate ?? "-"}`);
  if (onlyL.length) console.log(`  only LLM found  : ${onlyL.slice(0,10).join(", ")}${onlyL.length>10?` (+${onlyL.length-10})`:""}`);
  if (onlyR.length) console.log(`  only regex found: ${onlyR.slice(0,10).join(", ")}${onlyR.length>10?` (+${onlyR.length-10})`:""}`);
  if (llm.failureReason) console.log(`  llm failure: ${llm.failureReason.slice(0,120)}`);
  console.log(`  lean(llm)  : ${(llm.plan?.lean||"").slice(0,72)}`);
  console.log(`  lean(regex): ${(rgx.plan?.lean||"").slice(0,72)}`);
}
console.log(`\n  LLM published via llm path: ${llmOk}/${emails.length}   regex published: ${rgxOk}/${emails.length}`);
