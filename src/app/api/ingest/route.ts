import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { parseLevels } from "@/lib/parser";
import { generateTldr } from "@/lib/generate-tldr";

// Webhook endpoint — called by Zapier, not by a logged-in user
// Uses admin client to bypass RLS
// Requires user_id in the payload so the plan is assigned to the right user
export async function POST(req: NextRequest) {
  try {
    const { date, subject, body, user_id } = await req.json();

    if (!body) {
      return NextResponse.json({ error: "Missing email body" }, { status: 400 });
    }

    if (!user_id) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }

    const parsed = parseLevels(body, subject);
    const session_date = parsed.sessionDate;
    const supabase = createAdminSupabase();

    const { data, error } = await supabase
      .from("plans")
      .upsert(
        {
          user_id,
          session_date,
          email_date: date || new Date().toISOString(),
          subject: subject || "Trade Plan",
          body,
          tldr: null, // Clear stale TL;DR so it regenerates
        },
        { onConflict: "user_id,session_date" }
      )
      .select()
      .single();

    if (error) {
      console.error("Supabase upsert error:", error);
      return NextResponse.json({ error: "Failed to store plan" }, { status: 500 });
    }

    console.log(`[${new Date().toISOString()}] Ingested plan for user ${user_id}, session ${session_date}`);

    // Fire-and-forget TL;DR generation — don't block the webhook response
    generateTldr(data.id, body).catch(console.error);

    return NextResponse.json({ status: "ok", id: data.id, session_date });
  } catch (err) {
    console.error("Ingest error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
