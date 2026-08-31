import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase-server";

// Postmark inbound webhook.
//
// THE ONE RULE THIS ROUTE EXISTS TO ENFORCE
// Persist first, respond 200 second. Postmark retries a non-200 roughly ten
// times over about six hours, but the moment we return 200 those retries stop
// forever. So the 200 is a promise that the message is durably stored. Any
// work beyond storage — sender checks, classification, parsing — happens later
// in the sweep, reading from the row this route wrote.
//
// This is also why there is no `after()` / `waitUntil()` here. Vercel kills
// that work at the function timeout, which would produce a successful webhook
// followed by silent disappearance: exactly the failure this pipeline exists
// to prevent.
//
//   POSTMARK ──▶ auth ──▶ dedupe ──▶ INSERT(status='pending') ──▶ 200
//                 │         │              │
//                403       200            500 ──▶ Postmark retries
//              (no retry) (no-op)
//
// STATUS CODE CONTRACT
//   403 — authentication failed. Deliberately kills retries: a wrong
//         credential will still be wrong in six hours, so retrying only
//         generates noise.
//   200 — stored, or a duplicate we already have.
//   500 — genuine transient failure. We WANT Postmark to retry these.

export const maxDuration = 30;

interface PostmarkAttachment {
  Name: string;
  ContentType: string;
}

interface PostmarkInbound {
  MessageID?: string;
  From?: string;
  FromFull?: { Email?: string; Name?: string };
  OriginalRecipient?: string;
  ToFull?: Array<{ Email?: string; MailboxHash?: string }>;
  MailboxHash?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Date?: string;
  Headers?: Array<{ Name: string; Value: string }>;
  Attachments?: PostmarkAttachment[];
}

/** Constant-time compare so the credential cannot be probed by timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Postmark does not HMAC-sign inbound webhooks the way svix does, so the gate
 * is HTTP Basic auth on the webhook URL plus (optionally) an IP allowlist.
 * The credential goes in the Authorization header rather than the URL path
 * because paths leak into logs, referrers, and error reports.
 */
function authenticate(req: NextRequest): { ok: boolean; reason?: string } {
  const expected = process.env.INBOUND_WEBHOOK_BASIC;
  if (!expected) {
    return { ok: false, reason: "INBOUND_WEBHOOK_BASIC is not configured" };
  }

  const header = req.headers.get("authorization") ?? "";
  const provided = header.replace(/^Basic\s+/i, "");
  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, reason: "bad or missing Basic credential" };
  }

  // Optional defence in depth. Postmark publishes its outbound ranges; when
  // INBOUND_ALLOWED_IPS is set we additionally require a match.
  const allowlist = process.env.INBOUND_ALLOWED_IPS;
  if (allowlist) {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "";
    const permitted = allowlist.split(",").map((s) => s.trim()).filter(Boolean);
    if (!permitted.some((p) => ip === p || ip.startsWith(p))) {
      return { ok: false, reason: `source IP ${ip || "(unknown)"} not in allowlist` };
    }
  }

  return { ok: true };
}

/**
 * Stable hash of the message body. This is the dedupe key Postmark's MessageID
 * cannot provide: a re-forward (the filter re-triggering, a second forwarding
 * rule, a shadow-mode replay) arrives with a FRESH MessageID but identical
 * content. Without this, that duplicate becomes a spurious new plan version
 * and a false "plan updated" banner mid-session.
 */
function contentHash(body: string): string {
  return createHash("sha256").update(body.replace(/\s+/g, " ").trim()).digest("hex");
}

export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if (!auth.ok) {
    console.error("[inbound] auth rejected:", auth.reason);
    // 403 stops Postmark retrying a credential that will not improve.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let payload: PostmarkInbound;
  try {
    payload = (await req.json()) as PostmarkInbound;
  } catch (e) {
    console.error("[inbound] unparseable JSON body:", (e as Error).message);
    // Malformed input will not become valid on retry.
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const body = payload.TextBody?.trim() || payload.HtmlBody?.trim() || "";
  if (!body) {
    console.error("[inbound] message had no text or html body; storing nothing");
    return NextResponse.json({ ok: true, skipped: "empty body" }, { status: 200 });
  }

  const mailboxHash = payload.MailboxHash || payload.ToFull?.[0]?.MailboxHash || null;
  const recipient = payload.OriginalRecipient || payload.ToFull?.[0]?.Email || null;

  try {
    const supabase = createAdminSupabase();

    // Resolve which account this message belongs to. A public webhook carries
    // no session, so the routing map is the authority for row ownership —
    // never a caller-supplied id.
    let route = null;
    if (mailboxHash) {
      const { data } = await supabase
        .from("inbound_routes")
        .select("*")
        .eq("mailbox_hash", mailboxHash)
        .eq("active", true)
        .maybeSingle();
      route = data;
    }
    if (!route && recipient) {
      const { data } = await supabase
        .from("inbound_routes")
        .select("*")
        .eq("recipient", recipient)
        .eq("active", true)
        .maybeSingle();
      route = data;
    }

    if (!route) {
      // Unroutable mail is stored with no owner so it is visible in the admin
      // inbox and can be investigated, rather than silently dropped.
      console.error("[inbound] no route for recipient:", recipient, "hash:", mailboxHash);
      await supabase.from("emails").insert({
        user_id: null,
        postmark_message_id: payload.MessageID ?? null,
        content_hash: contentHash(body),
        from_email: payload.FromFull?.Email ?? payload.From ?? null,
        envelope_sender: payload.From ?? null,
        subject: payload.Subject ?? null,
        body,
        status: "quarantined",
        status_reason: `no active inbound route for recipient=${recipient ?? "?"} hash=${mailboxHash ?? "?"}`,
      });
      return NextResponse.json({ ok: true, quarantined: "unroutable" }, { status: 200 });
    }

    const { error } = await supabase.from("emails").insert({
      user_id: route.user_id,
      postmark_message_id: payload.MessageID ?? null,
      content_hash: contentHash(body),
      from_email: payload.FromFull?.Email ?? payload.From ?? null,
      // Postmark's From on a forwarded message is the forwarding mailbox,
      // which is precisely the envelope identity the sender check needs.
      envelope_sender: payload.From ?? null,
      subject: payload.Subject ?? null,
      body,
      // Kept because sender verification runs later, in the sweep, and DKIM
      // exists only here. Dropping it made every genuine forward quarantine.
      headers: payload.Headers ?? null,
      status: "pending",
    });

    if (error) {
      // 23505 = unique violation. Either the same Postmark MessageID (exact
      // redelivery) or the same content hash (a re-forward). Both are
      // successfully-handled duplicates, so 200 and stop the retries.
      if (error.code === "23505") {
        return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
      }
      throw new Error(`${error.code}: ${error.message}`);
    }

    // Only now, with the row committed, is it safe to end Postmark's retries.
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("[inbound] storage failed, asking Postmark to retry:", (e as Error).message);
    return NextResponse.json({ error: "storage failed" }, { status: 500 });
  }
}
