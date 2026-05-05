import { NextRequest, NextResponse } from "next/server";
import {
  createAdminSupabase,
  createServerSupabase,
} from "@/lib/supabase-server";
import { parseLevels } from "@/lib/parser";
import { generateTldr } from "@/lib/generate-tldr";

// Authenticated manual-paste endpoint. The user_id comes from the session
// cookie, never the request body — that closes the F2 hole where any caller
// could write into another user's history. The Resend webhook path (Phase 4)
// will live at /api/inbound-email with its own signature-based auth.
export async function POST(req: NextRequest) {
  try {
    // user_id is intentionally read from auth, not the body. We still parse
    // the body but ignore any user_id it contains.
    const { date, subject, body } = await req.json();

    if (!body) {
      return NextResponse.json({ error: "Missing email body" }, { status: 400 });
    }

    const authClient = await createServerSupabase();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const parsed = parseLevels(body, subject);
    const session_date = parsed.sessionDate;

    // Admin client for the upsert: avoids needing an extra UPDATE RLS policy
    // for the (user_id, session_date) on-conflict path. user_id is fixed to
    // the authenticated user.
    const adminClient = createAdminSupabase();
    const { data, error } = await adminClient
      .from("plans")
      .upsert(
        {
          user_id: user.id,
          session_date,
          email_date: date || new Date().toISOString(),
          subject: subject || "Trade Plan",
          body,
          tldr: null, // Clear stale TL;DR so it regenerates
        },
        { onConflict: "user_id,session_date" },
      )
      .select()
      .single();

    if (error) {
      console.error("Supabase upsert error:", error);
      return NextResponse.json({ error: "Failed to store plan" }, { status: 500 });
    }

    console.log(
      `[${new Date().toISOString()}] Ingested plan for user ${user.id}, session ${session_date}`,
    );

    // Fire-and-forget TL;DR generation — don't block the response
    generateTldr(data.id, body).catch(console.error);

    return NextResponse.json({ status: "ok", id: data.id, session_date });
  } catch (err) {
    console.error("Ingest error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
