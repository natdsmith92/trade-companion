import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { parseLevels } from "@/lib/parser";

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
    const supabase = createAdminSupabase();

    const { data, error } = await supabase
      .from("plans")
      .insert({
        user_id,
        session_date: parsed.sessionDate,
        email_date: date || new Date().toISOString(),
        subject: subject || "Trade Plan",
        body: body,
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: "Failed to store plan" }, { status: 500 });
    }

    console.log(`[${new Date().toISOString()}] Ingested plan for user ${user_id}, session ${parsed.sessionDate}`);
    return NextResponse.json({ status: "ok", id: data.id, session_date: parsed.sessionDate });
  } catch (err) {
    console.error("Ingest error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
