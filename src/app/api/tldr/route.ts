import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { generateTldr } from "@/lib/generate-tldr";

export async function GET(req: NextRequest) {
  try {
    const dateParam = req.nextUrl.searchParams.get("date");
    if (!dateParam) {
      return NextResponse.json({ error: "Missing date param" }, { status: 400 });
    }

    const supabase = await createServerSupabase();

    const { data: plan, error } = await supabase
      .from("plans")
      .select("id, body, tldr")
      .eq("session_date", dateParam)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !plan) {
      return NextResponse.json({ error: "No plan found for this date" }, { status: 404 });
    }

    // If cached, return immediately
    if (plan.tldr) {
      return NextResponse.json(plan.tldr);
    }

    // Fallback: generate synchronously if not cached yet
    const tldr = await generateTldr(plan.id, plan.body);
    if (tldr) {
      return NextResponse.json(tldr);
    }

    return NextResponse.json(
      { error: "TL;DR generation failed" },
      { status: 503 }
    );
  } catch (err) {
    console.error("TL;DR fetch error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
