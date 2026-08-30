#!/usr/bin/env node
// Unit tests for the pipeline's pure logic: source verification, sender
// verification, and classification heuristics.
//
// Same reasoning as eval-parser.mjs for why this is a script and not a test
// framework: the repo has none, and it is being archived after the MakerKit
// port. This runs anywhere Node runs and ports by copying one file.
//
// The verification tests matter more than the rest. verify-levels.ts is the
// only thing standing between a hallucinated price and a ladder someone trades
// against, and its rules were wrong twice during review — first requiring
// verbatim matches (which reject the newsletter's own range shorthand), then
// gating on the regex parser's level count (which blocks exactly the emails
// the LLM exists to rescue). These cases pin down both corrections.
//
//   node scripts/test-lib.mjs

import { loadLib } from "./_load-ts.mjs";

let passed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

const verify = await loadLib("verify-levels");
const sender = await loadLib("verify-sender");
const classify = await loadLib("classify-email");

// ───────────────────────── derivableNumbers ─────────────────────────
// These encode the newsletter's actual number formats. If parser.ts's
// extractLevels() changes how it expands ranges, these must change with it.
{
  const d = (t) => [...verify.derivableNumbers(t)].sort((a, b) => a - b);

  eq("plain level", d("Supports are: 6685"), [6685]);
  eq("short range 6778-82 yields both endpoints", d("6778-82"), [6778, 6782]);
  eq("full range 6820-6822 yields both endpoints", d("6820-6822"), [6820, 6822]);
  eq("slash shorthand 6120/22", d("6120/22"), [6120, 6122]);
  eq("thousands separator 6,120 normalizes", d("we saw 6,120 hold"), [6120]);

  // The endpoints are asserted by the source; the ticks between them are not.
  check(
    "range does not fabricate intermediate ticks",
    !verify.derivableNumbers("6778-82").has(6780),
    "6780 was derivable but the email never claims it",
  );

  eq("multiple levels in prose", d("6685 (major), 6676, 6663 (major)"), [6663, 6676, 6685]);
}

// ───────────────────────── verifyAgainstSource ─────────────────────────
{
  const body =
    "Supports are: 6685 (major), 6676, 6663. Resistances are: 6700, 6778-82. Plan for 9/15.";
  const mk = (sup, res, date = "2026-09-15") => ({
    supports: sup.map((p) => ({ price: p, type: "support", major: false })),
    resistances: res.map((p) => ({ price: p, type: "resistance", major: false })),
    lean: "", bullTargets: [], bearTargets: [], triggers: [], sessionDate: date,
  });

  let r = verify.verifyAgainstSource(mk([6685, 6676, 6663], [6700, 6778, 6782]), body);
  check("clean parse verifies", r.ok, JSON.stringify(r.issues));

  // THE regression this module exists for: a number the model made up.
  r = verify.verifyAgainstSource(mk([6685, 6676, 9999], [6700]), body);
  check("hallucinated level is caught", !r.ok && r.unsourced.includes(9999));
  check("hallucination is reported as unsourced_level",
    r.issues.some((i) => i.kind === "unsourced_level"));

  // The correction that mattered: range endpoints must NOT be rejected.
  r = verify.verifyAgainstSource(mk([6685, 6676, 6663], [6782]), body);
  check("range endpoint 6782 is accepted, not treated as invented", r.ok,
    JSON.stringify(r.issues));

  // fallbackNextTradingDay() inventing a date is the signature failure of the
  // regex parser, and it is what files a plan under the wrong session.
  r = verify.verifyAgainstSource(mk([6685, 6676, 6663], [6700], "2027-01-04"), body);
  check("invented session date is caught",
    !r.ok && r.issues.some((i) => i.kind === "unsourced_date"));

  // An empty ladder is not a publishable plan.
  r = verify.verifyAgainstSource(mk([], []), body);
  check("empty parse is rejected", !r.ok && r.issues.some((i) => i.kind === "no_levels"));

  // Date formats the newsletter actually uses.
  const dts = "Plan for September 15th. Supports are: 6685, 6676, 6663.";
  r = verify.verifyAgainstSource(mk([6685, 6676, 6663], []), dts);
  check("month-name date with ordinal is recognized", r.ok, JSON.stringify(r.issues));
}

// ───────────────────────── verifySender ─────────────────────────
{
  const route = { allowedForwarder: "dad@gmail.com", allowedFrom: "adam@mancini.substack.com" };
  const dkim = [{ Name: "DKIM-Signature", Value: "v=1; a=rsa-sha256; d=mancini.substack.com; s=x" }];

  let r = sender.verifySender({
    ...route, envelopeSender: "dad@gmail.com", fromEmail: "adam@mancini.substack.com",
  });
  check("expected forwarder + matching From accepts", r.verdict === "accept", r.reason);

  // The whole point: a forged From from a stranger must not reach the parser.
  r = sender.verifySender({
    ...route, envelopeSender: "attacker@evil.com", fromEmail: "attacker@evil.com",
  });
  check("stranger is quarantined", r.verdict === "quarantine");

  // From spoofed to look right, but forwarded by nobody we trust and no DKIM.
  r = sender.verifySender({
    ...route, envelopeSender: "attacker@evil.com", fromEmail: "adam@mancini.substack.com",
  });
  check("spoofed From without trusted forwarder or DKIM is quarantined",
    r.verdict === "quarantine", r.reason);

  // Surviving DKIM over the newsletter domain vouches for an odd forwarder.
  r = sender.verifySender({
    ...route, envelopeSender: "relay@somewhere.net",
    fromEmail: "adam@mancini.substack.com", headers: dkim,
  });
  check("surviving DKIM vouches for an unexpected forwarder",
    r.verdict === "accept" && r.signals.dkimPresent, r.reason);

  eq("dkimDomain extracts d=", sender.dkimDomain(dkim), "mancini.substack.com");
  check("dkimDomain tolerates absent header", sender.dkimDomain([]) === null);

  // Name <addr> form must normalize, or every real email quarantines.
  r = sender.verifySender({
    ...route, envelopeSender: "Dad <dad@gmail.com>",
    fromEmail: "Adam Mancini <adam@mancini.substack.com>",
  });
  check("display-name address form is normalized", r.verdict === "accept", r.reason);
}

// ───────────────────────── classification heuristics ─────────────────────────
{
  const h = classify.heuristicClassify;
  check("plain plan subject classifies as plan", h("ES Trade Plan for 9/15") === "plan");
  check("recap subject classifies as not_plan", h("Tuesday Recap: how we did") === "not_plan");
  check("intraday update classifies as not_plan", h("Midday update") === "not_plan");
  // Mixed signals must defer to the LLM rather than guessing.
  check("mixed signals defer to tie-break", h("Trade Plan Recap") === null);
  check("unknown subject defers to tie-break", h("Hello") === null);
  check("empty subject defers to tie-break", h("") === null);
}

// ───────────────────────── report ─────────────────────────
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length) { console.log(); process.exit(1); }
console.log("  All library tests passed.\n");
