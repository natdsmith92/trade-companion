import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("trades")
      .update(body)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Failed to update trade" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Trade update error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { error } = await supabase
      .from("trades")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: "Failed to delete trade" }, { status: 500 });
    }

    return NextResponse.json({ status: "deleted" });
  } catch (err) {
    console.error("Trade delete error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
