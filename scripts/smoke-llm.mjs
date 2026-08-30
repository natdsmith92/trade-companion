// One real Claude call against a real corpus email, end to end through the
// same code path the sweep uses. Verifies the migration for real, not in types.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLib } from "./_load-ts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=['"]?([^'"]*)['"]?$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const DIR = join(ROOT, "evals", "corpus");
const file = readdirSync(DIR).filter(f => f.endsWith(".json") && f !== "index.json")
  .map(f => JSON.parse(readFileSync(join(DIR, f), "utf8")))
  .find(d => (d.Subject || "").includes("Plan"));

console.log("Email:", file.Subject);
console.log("Body chars:", (file.TextBody || "").length, "\n");

const { parsePlanFromEmail } = await loadLib("parse-plan-llm");
const t0 = Date.now();
const out = await parsePlanFromEmail(file.TextBody, file.Subject);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`published : ${out.published}`);
console.log(`method    : ${out.method}   (${secs}s)`);
console.log(`session   : ${out.plan?.sessionDate}`);
console.log(`supports  : ${out.plan?.supports.length}  resistances: ${out.plan?.resistances.length}`);
console.log(`lowConf   : ${out.lowConfidence.length}`);
console.log(`lean      : ${(out.plan?.lean || "").slice(0, 90)}`);
if (out.failureReason) console.log(`FAILURE   : ${out.failureReason}`);
if (out.banner) console.log(`banner    : ${out.banner}`);
const all = [...(out.plan?.supports||[]), ...(out.plan?.resistances||[])].map(l=>l.price);
console.log(`levels    : ${all.slice(0,14).join(", ")}${all.length>14?" ...":""}`);
