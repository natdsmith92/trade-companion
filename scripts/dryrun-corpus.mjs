import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadLib } from "./_load-ts.mjs";

const sender = await loadLib("verify-sender");
const parser = await loadLib("parser");
const verify = await loadLib("verify-levels");
const classify = await loadLib("classify-email");

const DIR = fileURLToPath(new URL("../evals/corpus/", import.meta.url));
const files = readdirSync(DIR).filter(f => f.endsWith(".json") && f !== "index.json");
const route = { allowedForwarder:"theoverstockshop@gmail.com", allowedFrom:"tradecompanion@substack.com" };

const seen = new Set(); const uniq = [];
for (const f of files) {
  const d = JSON.parse(readFileSync(join(DIR,f),"utf8"));
  const body = (d.TextBody||"");
  const h = createHash("sha256").update(body.replace(/\s+/g," ").trim()).digest("hex");
  if (seen.has(h)) continue;
  seen.add(h); uniq.push(d);
}
console.log(`  ${files.length} messages -> ${uniq.length} unique after content-hash dedupe`);

let acc=0,quar=0; const quarReasons={};
let cls={plan:0,not_plan:0,defer:0};
let pubs=0,fails=0; const failKinds={};
for (const d of uniq) {
  const r = sender.verifySender({ ...route, envelopeSender:d.From, fromEmail:d.From,
    headers:d.Headers, body:d.TextBody });
  if (r.verdict==="accept") acc++; else { quar++; quarReasons[r.reason.slice(0,60)]=(quarReasons[r.reason.slice(0,60)]||0)+1; }

  const h = classify.heuristicClassify(d.Subject||"");
  if (h==="plan") cls.plan++; else if (h==="not_plan") cls.not_plan++; else cls.defer++;

  const p = parser.parseLevels(d.TextBody||"", d.Subject||"");
  const v = verify.verifyAgainstSource(p, d.TextBody||"");
  if (v.ok) pubs++; else { fails++; for (const i of v.issues) failKinds[i.kind]=(failKinds[i.kind]||0)+1; }
}
console.log(`\n  SENDER      accept ${acc}  quarantine ${quar}`);
for (const [k,n] of Object.entries(quarReasons)) console.log(`                ${n}x ${k}`);
console.log(`\n  CLASSIFY(heuristic only)  plan ${cls.plan}  not_plan ${cls.not_plan}  defer-to-LLM ${cls.defer}`);
console.log(`\n  REGEX PARSE + SOURCE VERIFY  would publish ${pubs}  blocked ${fails}`);
for (const [k,n] of Object.entries(failKinds)) console.log(`                ${n}x ${k}`);
