import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { date, subject, body } = await req.json();

    if (!body) {
      return NextResponse.json({ error: "Missing email body" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("plans")
      .insert({
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

    return NextResponse.json({ status: "ok", id: data.id });
  } catch (err) {
    console.error("Ingest error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
