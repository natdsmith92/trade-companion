import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { createAdminSupabase } from "@/lib/supabase-server";

// Ingest inbox API. Backs /admin/emails.
//
// This is an operator tool, not a user-facing feature. It exists because
// newsletter formats drift, and when they do the difference between a
// 30-second fix and an hour of SQL archaeology during market hours is having
// somewhere to look. It is also where quarantined mail gets approved and where
// Gmail's forwarding-confirmation code shows up during setup.
//
// GET  ?status=&limit=   list messages
// POST { id, action }    action: "reparse" | "approve" | "reject"
//
// Gated by ADMIN_USER_IDS, matching /admin/pitch. Non-admins get 404 rather
// than 403 so the route's existence is not advertised.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });

  const status = req.nextUrl.searchParams.get("status");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50), 200);

  const supabase = createAdminSupabase();
  let query = supabase
    .from("emails")
    .select("id, subject, from_email, envelope_sender, status, status_reason, received_at, attempts, plan_id, user_id")
    .order("received_at", { ascending: false })
    .limit(limit);

  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    console.error("[admin/emails] list failed:", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  // Counts per status drive the filter chips, and make "3 quarantined" visible
  // without clicking into anything.
  const { data: all } = await supabase.from("emails").select("status");
  const counts = (all ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ emails: data ?? [], counts });
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });

  let payload: { id?: string; action?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { id, action } = payload;
  if (!id || !action) {
    return NextResponse.json({ error: "id and action are required" }, { status: 400 });
  }

  const supabase = createAdminSupabase();

  switch (action) {
    // Put the row back in the queue. The sweep picks it up within 5 minutes.
    // attempts resets so a fixed prompt or a corrected route gets a clean run
    // rather than inheriting a spent budget.
    case "reparse":
    // Approving a quarantined message is the same mechanic: hand it back to
    // the pipeline. The operator is vouching for provenance, not bypassing
    // parsing — the parse and its source verification still have to pass.
    case "approve": {
      const { error } = await supabase
        .from("emails")
        .update({
          status: "pending",
          attempts: 0,
          status_reason: `${action} by admin ${admin.id} at ${new Date().toISOString()}`,
        })
        .eq("id", id);
      if (error) {
        console.error(`[admin/emails] ${action} failed:`, error.message);
        return NextResponse.json({ error: `${action} failed` }, { status: 500 });
      }
      return NextResponse.json({ ok: true, status: "pending" });
    }

    // Explicitly not a plan. Kept, never parsed, out of the way.
    case "reject": {
      const { error } = await supabase
        .from("emails")
        .update({
          status: "inert",
          status_reason: `rejected by admin ${admin.id} at ${new Date().toISOString()}`,
        })
        .eq("id", id);
      if (error) {
        console.error("[admin/emails] reject failed:", error.message);
        return NextResponse.json({ error: "reject failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, status: "inert" });
    }

    default:
      return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  }
}
