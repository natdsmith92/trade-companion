import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}
