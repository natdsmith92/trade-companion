#!/usr/bin/env node
// Pulls inbound messages out of Postmark into evals/corpus/ as raw payloads.
//
// WHY THIS EXISTS
// The plan assumed the eval corpus would have to be reconstructed from the
// plans.body column, and worried that ~15 emails made the accuracy gate
// noisier than no gate at all. Postmark turned out to be holding 237 real
// forwarded newsletters, which is a far better corpus and comes with the
// original headers attached.
//
// These are RAW payloads, not labeled fixtures. Labeling is a separate,
// human step: eval fixtures need a known-correct answer, and generating that
// answer with the same parser being evaluated would make the gate circular.
// Use scripts/eval-parser.mjs against evals/fixtures/ once labels exist.
//
//   node scripts/pull-postmark-corpus.mjs [--limit N]
//
// Reads POSTMARK_SERVER_TOKEN from .env.local. Writes one JSON file per
// message plus an index.json summary. Skips files already downloaded, so it
// is safe to re-run and resume.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "evals", "corpus");

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

function token() {
  const m = /^POSTMARK_SERVER_TOKEN='?([^'\n\r]+)'?/m.exec(
    readFileSync(join(ROOT, ".env.local"), "utf8"),
  );
  if (!m) throw new Error("POSTMARK_SERVER_TOKEN not found in .env.local");
  return m[1];
}

async function api(path, tok) {
  const res = await fetch("https://api.postmarkapp.com" + path, {
    headers: { "X-Postmark-Server-Token": tok, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Messages sit in "scheduled" while no inbound webhook is configured — that is
 * the state the whole 237 are in. Sweep the other statuses too so this keeps
 * working once a webhook exists and messages start landing as processed.
 */
const STATUSES = ["scheduled", "processed", "blocked", "failed", "queued"];

async function main() {
  const tok = token();
  mkdirSync(OUT, { recursive: true });
  const already = new Set(
    existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith(".json")) : [],
  );

  // Dedupe by MessageID across statuses AND pages. Both matter:
  // a message can be listed under more than one status, and Postmark's
  // TotalCount for a status query does not always agree with the number of
  // distinct messages it will actually return — an earlier version of this
  // trusted TotalCount for pagination and recorded 240 "messages" that turned
  // out to be 29 distinct ones listed over and over.
  const byId = new Map();
  for (const status of STATUSES) {
    let offset = 0;
    for (;;) {
      const page = await api(
        `/messages/inbound?count=500&offset=${offset}&status=${status}`,
        tok,
      );
      const msgs = page.InboundMessages ?? [];
      if (msgs.length === 0) break;

      const before = byId.size;
      for (const m of msgs) if (!byId.has(m.MessageID)) byId.set(m.MessageID, status);
      // A page that adds nothing new means we are looping over the same
      // results; stop rather than spin.
      if (byId.size === before) break;

      offset += msgs.length;
    }
  }

  const seen = [...byId].map(([id, status]) => ({ id, status }));
  console.log(`Postmark is holding ${seen.length} distinct inbound message(s).`);

  const index = [];
  let fetched = 0, skipped = 0;

  for (const { id, status } of seen.slice(0, LIMIT)) {
    const file = `${id}.json`;
    if (already.has(file)) {
      skipped++;
    } else {
      const d = await api(`/messages/inbound/${id}/details`, tok);
      writeFileSync(join(OUT, file), JSON.stringify(d, null, 2), "utf8");
      fetched++;
      if (fetched % 25 === 0) console.log(`  fetched ${fetched}...`);
    }
    const d = JSON.parse(readFileSync(join(OUT, file), "utf8"));
    index.push({
      id,
      status,
      date: d.Date,
      subject: d.Subject,
      from: d.From,
      to: d.To,
      bodyChars: (d.TextBody || "").length,
    });
  }

  index.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2), "utf8");

  // Duplicate subjects are expected and worth surfacing: several newsletters
  // were forwarded more than once, which is exactly the case content-hash
  // dedupe exists to absorb.
  const bySubject = new Map();
  for (const r of index) bySubject.set(r.subject, (bySubject.get(r.subject) ?? 0) + 1);
  const dupes = [...bySubject.entries()].filter(([, n]) => n > 1);

  console.log(`\n  downloaded ${fetched}, already had ${skipped}`);
  console.log(`  unique subjects: ${bySubject.size} of ${index.length} messages`);
  console.log(`  subjects appearing more than once: ${dupes.length}`);
  console.log(`  written to evals/corpus/ (index.json has the summary)`);
}

main().catch((e) => {
  console.error("corpus pull failed:", e.message);
  process.exit(1);
});
