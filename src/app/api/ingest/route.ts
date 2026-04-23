import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { parseLevels } from "@/lib/parser";

export async function POST(req: NextRequest) {
  try {
    const { date, subject, body } = await req.json();

    if (!body) {
      return NextResponse.json({ error: "Missing email body" }, { status: 400 });
    }

    // Extract the session date from the subject/body
    const parsed = parseLevels(body, subject);

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plans")
      .insert({
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

    console.log(`[${new Date().toISOString()}] Ingested plan for session ${parsed.sessionDate}: "${subject}"`);
    return NextResponse.json({ status: "ok", id: data.id, session_date: parsed.sessionDate });
  } catch (err) {
    console.error("Ingest error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
