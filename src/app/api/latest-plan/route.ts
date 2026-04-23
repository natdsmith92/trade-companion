import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const dateParam = req.nextUrl.searchParams.get("date");

    let query = supabase.from("plans").select("*");

    if (dateParam) {
      // Fetch plan for a specific session date
      query = query.eq("session_date", dateParam);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "No plan found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Fetch error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
