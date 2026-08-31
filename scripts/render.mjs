#!/usr/bin/env node
// Render control via the REST API.
//
// WHY NOT THE RENDER CLI
// Render's official CLI is a downloaded binary whose `render login` is an
// interactive browser OAuth flow — it cannot be completed from a
// non-interactive shell. The REST API needs only a bearer token, so it is the
// automatable path. Base URL verified live: an unauthenticated
// GET https://api.render.com/v1/services returns 401, not 404.
//
//   node scripts/render.mjs status              list services and their state
//   node scripts/render.mjs env <serviceId>     show env var KEYS (never values)
//   node scripts/render.mjs push-env <serviceId>  sync required vars from .env.local
//   node scripts/render.mjs deploy <serviceId>  trigger a deploy and follow it
//
// Reads RENDER_API_KEY from .env.local. Nothing here runs without it.
//
// SAFETY
// push-env and deploy both change a running service, so both refuse unless
// --yes is passed. Values are never printed — only key names and whether each
// is set — because this output ends up in terminals and transcripts.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.render.com/v1";

function env() {
  const out = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=['"]?(.*?)['"]?$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const E = env();
const KEY = E.RENDER_API_KEY || process.env.RENDER_API_KEY;
if (!KEY) {
  console.error(
    "RENDER_API_KEY not found.\n\n" +
      "Create one at Render -> Account Settings -> API Keys, then add to .env.local:\n" +
      "  RENDER_API_KEY=rnd_...\n",
  );
  process.exit(2);
}

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

// Env vars the inbound pipeline needs in the deploy environment. Local-only
// values (the database URL, the Postmark token) are deliberately absent: the
// running app does not use them, and shipping a secret somewhere it is not
// needed is how secrets leak.
const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_KEY",
  "ANTHROPIC_API_KEY",
  "INBOUND_WEBHOOK_BASIC",
  "CRON_SECRET",
];

const [cmd, arg] = process.argv.slice(2);
const YES = process.argv.includes("--yes");

async function status() {
  const list = await api("/services?limit=50");
  const services = (Array.isArray(list) ? list : []).map((r) => r.service ?? r);
  if (!services.length) {
    console.log("No services found on this account.");
    return;
  }
  console.log(`${services.length} service(s):\n`);
  for (const s of services) {
    console.log(`  ${s.name}`);
    console.log(`    id      : ${s.id}`);
    console.log(`    type    : ${s.type}   suspended: ${s.suspended}`);
    console.log(`    repo    : ${s.repo ?? "-"}   branch: ${s.branch ?? "-"}`);
    console.log(`    url     : ${s.serviceDetails?.url ?? "-"}`);
    console.log(`    autoDeploy: ${s.autoDeploy ?? "-"}`);
    console.log();
  }
}

async function showEnv(id) {
  const vars = await api(`/services/${id}/env-vars?limit=100`);
  const keys = (Array.isArray(vars) ? vars : []).map((r) => (r.envVar ?? r).key);
  console.log(`${keys.length} env var(s) set on ${id}:\n`);
  for (const k of keys.sort()) console.log(`  ${k}`);
  console.log("\nRequired by the inbound pipeline:");
  for (const k of REQUIRED) {
    const there = keys.includes(k);
    const local = !!E[k];
    console.log(
      `  ${there ? "OK  " : "MISS"} ${k}` +
        (there ? "" : local ? "   (present locally, can be pushed)" : "   (NOT in .env.local either)"),
    );
  }
  if (keys.includes("OPENAI_API_KEY")) {
    console.log("\n  NOTE: OPENAI_API_KEY is still set. Unused since the move to Claude.");
  }
}

async function pushEnv(id) {
  const missingLocally = REQUIRED.filter((k) => !E[k]);
  if (missingLocally.length) {
    console.error(`Cannot push — missing from .env.local: ${missingLocally.join(", ")}`);
    process.exit(1);
  }
  if (!YES) {
    console.log(`Would set ${REQUIRED.length} env var(s) on ${id}: ${REQUIRED.join(", ")}`);
    console.log("\nThis triggers a restart. Re-run with --yes to apply.");
    return;
  }
  // Add-or-update one at a time rather than PUT-replacing the whole set:
  // a replace would silently delete any var set in the dashboard that is not
  // in this list.
  for (const k of REQUIRED) {
    await api(`/services/${id}/env-vars/${k}`, {
      method: "PUT",
      body: JSON.stringify({ value: E[k] }),
    });
    console.log(`  set ${k}`);
  }
  console.log("\nDone. Render restarts the service on env change.");
}

async function deploy(id) {
  if (!YES) {
    console.log(`Would trigger a deploy of ${id}. Re-run with --yes to apply.`);
    return;
  }
  const d = await api(`/services/${id}/deploys`, {
    method: "POST",
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  });
  const deployId = d.id ?? d.deploy?.id;
  console.log(`deploy ${deployId} started`);

  const TERMINAL = ["live", "build_failed", "update_failed", "canceled", "deactivated"];
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const cur = await api(`/services/${id}/deploys/${deployId}`);
    const st = cur.status ?? cur.deploy?.status;
    process.stdout.write(`\r  status: ${st}${" ".repeat(20)}`);
    if (TERMINAL.includes(st)) {
      console.log();
      if (st !== "live") process.exit(1);
      return;
    }
  }
  console.log("\n  still building after 10 minutes — check the Render dashboard");
}

try {
  if (cmd === "status") await status();
  else if (cmd === "env" && arg) await showEnv(arg);
  else if (cmd === "push-env" && arg) await pushEnv(arg);
  else if (cmd === "deploy" && arg) await deploy(arg);
  else {
    console.log(
      "usage:\n" +
        "  node scripts/render.mjs status\n" +
        "  node scripts/render.mjs env <serviceId>\n" +
        "  node scripts/render.mjs push-env <serviceId> [--yes]\n" +
        "  node scripts/render.mjs deploy <serviceId> [--yes]\n",
    );
  }
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
