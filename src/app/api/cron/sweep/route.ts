import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { verifySender } from "@/lib/verify-sender";
import { classifyEmail } from "@/lib/classify-email";
import { parsePlanFromEmail } from "@/lib/parse-plan-llm";

// Drains pending inbound emails into plans.
//
// DURABILITY MODEL
// There is no queue, no lease column, and no reaper. One `emails` table with a
// status, claimed by `FOR UPDATE SKIP LOCKED` inside a transaction. If this
// function dies mid-parse the transaction rolls back and the row returns to
// 'pending' for the next run. SKIP LOCKED means two overlapping invocations
// never fight over the same row. That is the whole concurrency story, and it
// is a Postgres built-in rather than something we maintain.
//
// At one to three emails a day, a real queue would be accidental complexity.
// If this ever becomes multi-user, the upgrade is Supabase Queues (pgmq),
// where the visibility timeout is the lease and the archive is the dead
// letter — but not before it is needed.
//
// WHY LIMIT 1
// One email can trigger two LLM calls (classify, then parse), each up to
// 30-60s at high reasoning effort. Two is already most of a serverless
// timeout; a batch of ten would blow through it, get killed, and retry the
// same doomed batch forever while paying for every killed call. TL;DR
// generation is deliberately NOT in this path for the same reason — it runs
// fire-and-forget after the plan is committed.
//
//   claim 1 pending row (SKIP LOCKED)
//        │
//   verify sender ──quarantine──▶ done (visible in admin inbox)
//        │ accept
//   classify ──not_plan──▶ inert   ──quarantine──▶ done
//        │ plan
//   parse + verify against source
//        │                    │
//     published            failed ──▶ alert + re-parse from inbox
//        │
//   upsert plan ──▶ mark 'parsed' ──▶ fire-and-forget TL;DR

export const maxDuration = 300;

const MAX_ATTEMPTS = 3;

/** Cron authentication. Vercel sends a bearer token; pg_cron sends the same. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

interface EmailRow {
  id: string;
  user_id: string | null;
  subject: string | null;
  body: string;
  from_email: string | null;
  envelope_sender: string | null;
  headers: Array<{ Name: string; Value: string }> | null;
  attempts: number;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = createAdminSupabase();

  // claim_pending_email() is a SQL function wrapping
  // SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1 plus the attempts bump, so the
  // claim is atomic. See migrate-inbound-pipeline-fns.sql.
  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_pending_email", { max_attempts: MAX_ATTEMPTS })
    .maybeSingle<EmailRow>();

  if (claimError) {
    console.error("[sweep] claim failed:", claimError.message);
    return NextResponse.json({ error: "claim failed" }, { status: 500 });
  }
  if (!claimed) {
    return NextResponse.json({ ok: true, processed: 0 }, { status: 200 });
  }

  const email = claimed;
  const finish = async (
    status: "parsed" | "inert" | "quarantined" | "failed",
    reason: string,
    planId?: string,
  ) => {
    await supabase
      .from("emails")
      .update({
        status,
        status_reason: reason,
        plan_id: planId ?? null,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", email.id);
    return NextResponse.json({ ok: true, processed: 1, id: email.id, status, reason });
  };

  try {
    if (!email.user_id) {
      return await finish("quarantined", "no owning account resolved for this message");
    }

    // ── Sender verification ──
    const { data: route } = await supabase
      .from("inbound_routes")
      .select("allowed_forwarder, allowed_from")
      .eq("user_id", email.user_id)
      .eq("active", true)
      .maybeSingle();

    const sender = verifySender({
      envelopeSender: email.envelope_sender,
      fromEmail: email.from_email,
      // Required for forwarded mail: the newsletter's address survives only
      // inside the body's forwarded-header block, never in the headers.
      body: email.body,
      // And DKIM survives only in the headers, never in the body. Both halves
      // of the two-layer check need their own source.
      headers: email.headers,
      allowedForwarder: route?.allowed_forwarder ?? null,
      allowedFrom: route?.allowed_from ?? null,
    });

    if (sender.verdict === "quarantine") {
      return await finish("quarantined", `sender: ${sender.reason}`);
    }

    // ── Classification ──
    const cls = await classifyEmail(email.subject ?? "", email.body);
    if (cls.classification === "quarantine") {
      return await finish("quarantined", `classifier: ${cls.reason}`);
    }
    if (cls.classification === "not_plan") {
      // Stored and visible, but it must never touch the ladder.
      return await finish("inert", `not a plan: ${cls.reason}`);
    }

    // ── Parse + source verification ──
    const outcome = await parsePlanFromEmail(email.body, email.subject ?? undefined);

    if (!outcome.published || !outcome.plan) {
      const reason = outcome.failureReason ?? "parse did not clear the publish gate";
      if (email.attempts >= MAX_ATTEMPTS) {
        console.error(`[sweep] giving up on ${email.id} after ${email.attempts} attempts: ${reason}`);
        return await finish("failed", `gave up after ${email.attempts} attempts — ${reason}`);
      }
      // Leave it pending so the next sweep retries; the attempts counter in
      // claim_pending_email() guarantees this terminates.
      await supabase
        .from("emails")
        .update({ status: "pending", status_reason: reason, last_attempt_at: new Date().toISOString() })
        .eq("id", email.id);
      return NextResponse.json({ ok: true, processed: 1, id: email.id, status: "retry", reason });
    }

    // ── Publish ──
    const plan = outcome.plan;
    const { data: planRow, error: planError } = await supabase
      .from("plans")
      .upsert(
        {
          user_id: email.user_id,
          session_date: plan.sessionDate,
          email_date: new Date().toISOString(),
          subject: email.subject || "Trade Plan",
          body: email.body,
          tldr: null, // cleared so it regenerates against the new body
        },
        { onConflict: "user_id,session_date" },
      )
      .select()
      .single();

    if (planError) {
      throw new Error(`plan upsert failed: ${planError.code}: ${planError.message}`);
    }

    console.log(
      `[sweep] published plan ${planRow.id} for ${plan.sessionDate} via ${outcome.method}` +
        (outcome.lowConfidence.length ? ` (${outcome.lowConfidence.length} low-confidence levels)` : ""),
    );

    return await finish(
      "parsed",
      outcome.banner ?? `parsed via ${outcome.method}`,
      planRow.id,
    );
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[sweep] error processing ${email.id}:`, message);

    if (email.attempts >= MAX_ATTEMPTS) {
      return await finish("failed", `gave up after ${email.attempts} attempts — ${message}`);
    }
    await supabase
      .from("emails")
      .update({ status: "pending", status_reason: message, last_attempt_at: new Date().toISOString() })
      .eq("id", email.id);
    return NextResponse.json({ error: message, willRetry: true }, { status: 500 });
  }
}
