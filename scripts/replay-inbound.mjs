#!/usr/bin/env node
// Replays already-received Postmark messages into the live /api/inbound.
//
// WHY THIS IS NEEDED
// Postmark holds inbound mail that arrived before a webhook was configured in
// status "scheduled", and neither /retry nor /bypass applies to that state —
// both return 422 ErrorCode 701. Configuring the hook afterwards does not
// drain the backlog either. So the backlog has to be pushed in deliberately.
//
// This POSTs the real stored payloads at the real endpoint with the real
// credential, which means it exercises the entire production path — auth,
// routing, dedupe, insert — rather than simulating it. Messages that arrive
// from now on are delivered by Postmark directly and do not need this.
//
//   node scripts/replay-inbound.mjs [--limit N] [--url https://...]
//
// Safe to re-run: the route dedupes on provider MessageID and content hash,
// so a second pass reports duplicates instead of creating rows.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z_][A-Z0-9_]*)=['"]?(.*?)['"]?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const URL_ = args.includes("--url")
  ? args[args.indexOf("--url") + 1]
  : "https://tradeladder.io/api/inbound";

const basic = env.INBOUND_WEBHOOK_BASIC;
if (!basic) throw new Error("INBOUND_WEBHOOK_BASIC missing from .env.local");

const DIR = join(ROOT, "evals", "corpus");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");

let ok = 0, dup = 0, quarantined = 0, failed = 0;

for (const f of files.slice(0, LIMIT)) {
  const d = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${basic}` },
    body: JSON.stringify(d),
  });
  const body = await res.json().catch(() => ({}));
  const subj = (d.Subject || "").replace(/^Fwd:\s*/, "").slice(0, 46);

  if (body.duplicate) { dup++; console.log(`  dup   ${subj}`); }
  else if (body.quarantined) { quarantined++; console.log(`  QUAR  ${subj}  (${body.quarantined})`); }
  else if (res.ok) { ok++; console.log(`  ok    ${subj}`); }
  else { failed++; console.log(`  FAIL  ${res.status} ${subj}  ${JSON.stringify(body).slice(0, 90)}`); }
}

console.log(`\n  accepted ${ok}   duplicate ${dup}   quarantined ${quarantined}   failed ${failed}`);
