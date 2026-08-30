import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

// Resolves which of the three morning states the dashboard should render.
//
// WHY THIS IS A SERVER ROUTE AND NOT UI LOGIC
// The states have to agree with what the pipeline actually knows. Deriving
// them client-side from "did /api/latest-plan return a row" cannot distinguish
// "today's email has not arrived" from "it arrived and failed to parse" — and
// that distinction is the entire point. Getting it wrong means the app tells
// the user to keep waiting for a plan it already knows will never appear, for
// the two hours until the watchdog fires.
//
//   waiting    no email for today yet. Show the most recent plan, muted, with
//              a date badge and the expected arrival time. Never dead.
//   failed     an email arrived and did not publish. Say so immediately and
//              offer manual paste. Do NOT say "arriving soon".
//   published  today's plan is live.
//
// THE FALLBACK RULE  ← this is the part that is easy to get wrong
// States derive from the `emails` row, but two kinds of plan have no `emails`
// row at all: one the user pasted by hand, and one carried over by the
// historical data migration. Without a fallback, pasting a plan after a failed
// auto-parse would leave the screen stuck on `failed` while a perfectly good
// plan sits in the database. So plan-row presence always wins over email
// status.

export const dynamic = "force-dynamic";

export type SessionState = "waiting" | "failed" | "published";

function todayInNewYork(): string {
  // en-CA renders as YYYY-MM-DD, which is what session_date stores.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const date = req.nextUrl.searchParams.get("date") || todayInNewYork();

    // Is the market even open? A holiday should read as "closed", not as a
    // scary empty state or a false alarm.
    const { data: holiday } = await supabase
      .from("market_holidays")
      .select("name, early_close")
      .eq("holiday_date", date)
      .maybeSingle();

    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const marketClosed = isWeekend || (!!holiday && !holiday.early_close);

    // Plan presence wins over email status — see THE FALLBACK RULE above.
    const { data: plan } = await supabase
      .from("plans")
      .select("id, session_date, created_at")
      .eq("session_date", date)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (plan) {
      return NextResponse.json({
        state: "published" satisfies SessionState,
        date,
        marketClosed,
        holidayName: holiday?.name ?? null,
        earlyClose: !!holiday?.early_close,
        planId: plan.id,
        publishedAt: plan.created_at,
      });
    }

    // No plan. Did an email arrive and fail, or has nothing arrived at all?
    const { data: emails } = await supabase
      .from("emails")
      .select("id, status, status_reason, received_at")
      .gte("received_at", `${date}T00:00:00Z`)
      .order("received_at", { ascending: false })
      .limit(5);

    const blocked = (emails ?? []).find((e) =>
      ["failed", "quarantined"].includes(e.status),
    );

    if (blocked) {
      return NextResponse.json({
        state: "failed" satisfies SessionState,
        date,
        marketClosed,
        holidayName: holiday?.name ?? null,
        earlyClose: !!holiday?.early_close,
        emailId: blocked.id,
        emailStatus: blocked.status,
        reason: blocked.status_reason,
        receivedAt: blocked.received_at,
      });
    }

    // Still in flight counts as waiting, not failed: it may yet succeed on the
    // next sweep, and saying "failed" prematurely would be its own small lie.
    const inFlight = (emails ?? []).some((e) => e.status === "pending");

    // The most recent plan, so the screen is never blank.
    const { data: previous } = await supabase
      .from("plans")
      .select("session_date")
      .lt("session_date", date)
      .order("session_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      state: "waiting" satisfies SessionState,
      date,
      marketClosed,
      holidayName: holiday?.name ?? null,
      earlyClose: !!holiday?.early_close,
      inFlight,
      previousSessionDate: previous?.session_date ?? null,
    });
  } catch (err) {
    console.error("session-status error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
