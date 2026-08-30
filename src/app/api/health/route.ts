import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { envStatus } from "@/lib/env";

interface CheckResult {
  ok: boolean;
  ms?: number;
  detail?: string;
}

// Useful health endpoint. UptimeRobot (F8a) hits this every 5 min and
// pages on non-200. Keeps the response shape stable so the monitor doesn't
// need updates as we add more checks.
export async function GET() {
  const checks: Record<string, CheckResult> = {};
  let overallOk = true;

  // Env presence (no values, just booleans).
  const envs = envStatus();
  const envOk = Object.values(envs).every(Boolean);
  checks.env = { ok: envOk, detail: envOk ? "all required keys present" : `missing: ${Object.entries(envs).filter(([, v]) => !v).map(([k]) => k).join(", ")}` };
  if (!envOk) overallOk = false;

  // Supabase round-trip.
  const t1 = Date.now();
  try {
    const supabase = createAdminSupabase();
    const { error } = await supabase.from("plans").select("id").limit(1);
    if (error) throw error;
    checks.supabase = { ok: true, ms: Date.now() - t1 };
  } catch (err) {
    checks.supabase = { ok: false, ms: Date.now() - t1, detail: (err as Error).message };
    overallOk = false;
  }

  // ES price cache freshness — soft check; stale data isn't fatal but
  // a 24+ hour silence means F8b's pre-warmer is broken.
  try {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from("es_price_cache")
      .select("updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (!data) {
      checks.esPriceCache = { ok: false, detail: "cache row missing — run migrate-es-price-cache.sql" };
    } else {
      const age = Date.now() - new Date(data.updated_at).getTime();
      const ageMin = Math.round(age / 60_000);
      // 5 min threshold during market hours, anything older suggests Yahoo
      // stalled or F8b's pre-warmer is broken.
      checks.esPriceCache = {
        ok: age < 5 * 60_000,
        ms: age,
        detail: `${ageMin}m old`,
      };
    }
  } catch (err) {
    checks.esPriceCache = { ok: false, detail: (err as Error).message };
  }

  return NextResponse.json(
    { ok: overallOk, checks },
    { status: overallOk ? 200 : 503 },
  );
}
