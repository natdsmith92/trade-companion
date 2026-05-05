import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const dateParam = req.nextUrl.searchParams.get("date");

    let query = supabase.from("trades").select("*");

    if (dateParam) {
      query = query.eq("session_date", dateParam);
    } else {
      const days = parseInt(req.nextUrl.searchParams.get("days") || "30");
      const since = new Date();
      since.setDate(since.getDate() - days);
      query = query.gte("created_at", since.toISOString());
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch trades" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Trades fetch error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = await createServerSupabase();

    // Get the authenticated user's ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // F10: idempotency. If the client supplied a key and a trade already exists
    // with that key for this user, return the existing row instead of inserting
    // a duplicate. Covers double-submit during a fast tap or a network retry.
    const idempotencyKey: string | undefined = body.idempotency_key;
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", user.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) return NextResponse.json(existing);
    }

    const { data, error } = await supabase
      .from("trades")
      .insert({ ...body, user_id: user.id })
      .select()
      .single();

    if (error) {
      console.error("Trade insert error:", error);
      return NextResponse.json({ error: "Failed to store trade" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Trade error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
