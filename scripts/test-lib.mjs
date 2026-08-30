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
// Shapes below are taken from REAL payloads in Postmark, not invented. The
// live mail is a manual Gmail forward: outer From is the forwarder, DKIM is
// d=gmail.com, and the newsletter address exists only inside the body.
{
  const route = {
    allowedForwarder: "theoverstockshop@gmail.com",
    allowedFrom: "tradecompanion@substack.com",
  };
  const gmailDkim = [{ Name: "DKIM-Signature", Value: "v=1; a=rsa-sha256; c=relaxed/relaxed; d=gmail.com; s=20251104" }];
  const fwdBody = [
    "---------- Forwarded message ---------",
    "From: Adam Mancini from Adam Mancini's S&P 500 (SPX/ES Futures) Trade",
    "Companion <tradecompanion@substack.com>",
    "Date: Sun, Aug 30, 2026 at 8:57 AM",
    "Subject: Can Bulls Keep The Push Going Into September? August 31st Plan",
    "To: <theoverstockshop@gmail.com>",
    "",
    "Supports are: 7373, 7382 (major).",
  ].join("\n");

  // The display name wraps across a line break in real Gmail forwards, which
  // is exactly what broke a naive single-line From regex.
  eq("extracts original sender across a wrapped display name",
    sender.forwardedOriginalSender(fwdBody), "tradecompanion@substack.com");
  check("non-forward body yields no inner sender",
    sender.forwardedOriginalSender("Supports are: 7373.") === null);

  let r = sender.verifySender({
    ...route, envelopeSender: "theoverstockshop@gmail.com",
    fromEmail: "theoverstockshop@gmail.com", headers: gmailDkim, body: fwdBody,
  });
  check("real forwarded newsletter is accepted", r.verdict === "accept", r.reason);

  // Dad forwarding something that is NOT the newsletter must not publish.
  const otherBody = fwdBody.replace("tradecompanion@substack.com", "spam@elsewhere.com");
  r = sender.verifySender({
    ...route, envelopeSender: "theoverstockshop@gmail.com",
    fromEmail: "theoverstockshop@gmail.com", headers: gmailDkim, body: otherBody,
  });
  check("forward of a different sender is quarantined", r.verdict === "quarantine", r.reason);

  // Someone else forwarding the real newsletter must not publish either.
  r = sender.verifySender({
    ...route, envelopeSender: "stranger@evil.com",
    fromEmail: "stranger@evil.com", headers: gmailDkim, body: fwdBody,
  });
  check("forward from an unexpected mailbox is quarantined", r.verdict === "quarantine", r.reason);

  // Outer hop unproven: right mailbox claimed, but nothing signed for it.
  r = sender.verifySender({
    ...route, envelopeSender: "theoverstockshop@gmail.com",
    fromEmail: "theoverstockshop@gmail.com", headers: [], body: fwdBody,
  });
  check("forward with no DKIM over the forwarder domain is quarantined",
    r.verdict === "quarantine", r.reason);

  eq("dkimDomain extracts d=", sender.dkimDomain(gmailDkim), "gmail.com");
  check("dkimDomain tolerates absent header", sender.dkimDomain([]) === null);

  // Direct (non-forward) path, for a future Gmail filter or MX routing.
  const substackDkim = [{ Name: "DKIM-Signature", Value: "v=1; d=substack.com; s=x" }];
  r = sender.verifySender({
    ...route, envelopeSender: "bounce@substack.com",
    fromEmail: "tradecompanion@substack.com", headers: substackDkim, body: "Supports are: 7373.",
  });
  check("direct newsletter with its own DKIM is accepted", r.verdict === "accept", r.reason);

  r = sender.verifySender({
    ...route, envelopeSender: "attacker@evil.com",
    fromEmail: "attacker@evil.com", headers: [], body: "Supports are: 7373.",
  });
  check("direct mail from a stranger is quarantined", r.verdict === "quarantine");
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

  // Real subjects pulled from Postmark. Every one must classify without an
  // LLM call — this runs on the morning path where latency costs the most.
  for (const real of [
    "Fwd: Are Bulls Running Out Of Steam In SPX? July 14 Plan",
    "Fwd: Can Bulls Keep The Push Going Into September? August 31st Plan",
    "Fwd: [RE-SEND] Nvidia Earnings Incoming. Will It Move SPX? Aug 27 Plan",
    "Fwd: Will Todays Dip Get Bought Next Week In SPX? July 3rd/6th Plan",
    "Fwd: Bulls Bought The FOMC Dip In SPX. Will The Rally Continue? June 19/22",
    "Fwd: Is The Bottom In For SPX? August 28th Plan.",
  ]) {
    check(`real subject classifies as plan: ${real.slice(5, 40)}...`, h(real) === "plan");
  }
  // A recap that also carries a date must NOT short-circuit to plan.
  check("dated recap still defers", h("Fwd: Weekly Recap. July 14 Plan") === null);
}

// ───────────────────────── report ─────────────────────────
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length) { console.log(); process.exit(1); }
console.log("  All library tests passed.\n");
