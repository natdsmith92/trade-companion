import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("plans")
      .select("session_date, subject")
      .order("session_date", { ascending: false })
      .limit(90);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Sessions error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
