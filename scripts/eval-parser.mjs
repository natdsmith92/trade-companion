#!/usr/bin/env node
// Parser eval harness.
//
// WHY THIS IS A PLAIN SCRIPT AND NOT A TEST FRAMEWORK
// This repo has no vitest/jest/playwright and is scheduled to be archived once
// the MakerKit port lands. Installing a framework into it would be setup work
// thrown away twice. A standalone Node script runs identically here and in the
// new repo, ports by copying one file, and becomes a CI step with one line.
//
// WHAT IT MEASURES
// Per-field precision and recall on the fields that matter, NOT a single
// email-level pass rate. With a small corpus a pass-rate gate is noise: one
// miss out of fifteen is 93.3%, so a "95%" threshold flips on a single email.
// Precision and recall over individual levels degrade smoothly and tell you
// which direction the parser is wrong in:
//
//   precision low  ──▶ inventing levels that are not there   (dangerous)
//   recall low     ──▶ missing levels that are there         (annoying)
//
// Precision failures are the dangerous ones: a fabricated support level is a
// number someone might trade against. The default gate weights them harder.
//
// USAGE
//   node scripts/eval-parser.mjs                  # regex parser, all fixtures
//   node scripts/eval-parser.mjs --held-out       # held-out set only
//   node scripts/eval-parser.mjs --json           # machine-readable
//
// FIXTURES
// evals/fixtures/*.json, each: { "name", "heldOut": bool, "subject", "body",
// "expected": { "sessionDate", "supports": [n], "resistances": [n] } }
// Build the corpus from the plans.body rows already in Supabase — that is the
// only source of real labeled emails.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "evals", "fixtures");

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const HELD_OUT_ONLY = args.has("--held-out");

// Thresholds. Precision is held higher than recall on purpose: inventing a
// level is worse than missing one, because the user trades off what is shown.
const MIN_PRECISION = Number(process.env.EVAL_MIN_PRECISION ?? 0.98);
const MIN_RECALL = Number(process.env.EVAL_MIN_RECALL ?? 0.9);
const MIN_DATE_ACCURACY = Number(process.env.EVAL_MIN_DATE_ACCURACY ?? 0.95);

function loadFixtures() {
  if (!existsSync(FIXTURE_DIR)) return [];
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")) }))
    .filter((f) => (HELD_OUT_ONLY ? f.heldOut === true : true));
}

/** Set arithmetic over level prices. */
function score(expected, actual) {
  const exp = new Set(expected ?? []);
  const act = new Set(actual ?? []);
  let tp = 0;
  for (const v of act) if (exp.has(v)) tp++;
  const fp = act.size - tp;
  const fn = exp.size - tp;
  return { tp, fp, fn };
}

function ratio(num, den) {
  return den === 0 ? 1 : num / den;
}

async function loadParser() {
  const { loadLib } = await import("./_load-ts.mjs");
  return (await loadLib("parser")).parseLevels;
}

async function main() {
  const fixtures = loadFixtures();

  if (fixtures.length === 0) {
    const msg =
      `No fixtures found in evals/fixtures/.\n\n` +
      `Build the corpus first (plan Phase 0.3): export historical Mancini emails\n` +
      `from the plans.body column in Supabase, label the expected levels, and write\n` +
      `one JSON file per email. Aim for well above 15 emails — a corpus that small\n` +
      `makes the gate noisier than no gate at all.`;
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok: false, error: "no_fixtures", fixtures: 0 }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(2);
  }

  const parseLevels = await loadParser();

  let tp = 0, fp = 0, fn = 0, dateOk = 0;
  const rows = [];

  for (const fx of fixtures) {
    const parsed = parseLevels(fx.body, fx.subject);
    const actualSup = parsed.supports.map((l) => l.price);
    const actualRes = parsed.resistances.map((l) => l.price);

    const s = score(fx.expected?.supports, actualSup);
    const r = score(fx.expected?.resistances, actualRes);

    tp += s.tp + r.tp;
    fp += s.fp + r.fp;
    fn += s.fn + r.fn;

    const dateMatch = parsed.sessionDate === fx.expected?.sessionDate;
    if (dateMatch) dateOk++;

    rows.push({
      name: fx.name ?? fx.file,
      heldOut: !!fx.heldOut,
      tp: s.tp + r.tp,
      fp: s.fp + r.fp,
      fn: s.fn + r.fn,
      dateMatch,
      expectedDate: fx.expected?.sessionDate,
      actualDate: parsed.sessionDate,
    });
  }

  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const dateAccuracy = ratio(dateOk, fixtures.length);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const pass =
    precision >= MIN_PRECISION && recall >= MIN_RECALL && dateAccuracy >= MIN_DATE_ACCURACY;

  if (JSON_OUT) {
    console.log(JSON.stringify(
      { ok: pass, fixtures: fixtures.length, precision, recall, f1, dateAccuracy,
        thresholds: { MIN_PRECISION, MIN_RECALL, MIN_DATE_ACCURACY }, rows },
      null, 2,
    ));
  } else {
    console.log(`\nParser eval — ${fixtures.length} fixture(s)${HELD_OUT_ONLY ? " (held-out only)" : ""}\n`);
    for (const r of rows) {
      const flag = r.fp > 0 ? "FP" : r.fn > 0 ? "fn" : r.dateMatch ? "ok" : "DT";
      console.log(
        `  [${flag}] ${r.name}${r.heldOut ? " (held-out)" : ""}  ` +
          `tp=${r.tp} fp=${r.fp} fn=${r.fn}` +
          (r.dateMatch ? "" : `  date: expected ${r.expectedDate}, got ${r.actualDate}`),
      );
    }
    console.log(
      `\n  precision     ${(precision * 100).toFixed(1)}%  (min ${(MIN_PRECISION * 100).toFixed(0)}%)  invented levels` +
      `\n  recall        ${(recall * 100).toFixed(1)}%  (min ${(MIN_RECALL * 100).toFixed(0)}%)  missed levels` +
      `\n  F1            ${(f1 * 100).toFixed(1)}%` +
      `\n  date accuracy ${(dateAccuracy * 100).toFixed(1)}%  (min ${(MIN_DATE_ACCURACY * 100).toFixed(0)}%)` +
      `\n\n  ${pass ? "PASS" : "FAIL"}\n`,
    );
  }

  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("eval harness error:", e);
  process.exit(3);
});
