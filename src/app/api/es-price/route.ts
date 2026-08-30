import YahooFinance from "yahoo-finance2";
import { createAdminSupabase } from "@/lib/supabase-server";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const CACHE_TTL_MS = 60_000; // 60s — F6, eng-review locked

interface CachedPrice {
  price: number;
  change: number;
  change_percent: number;
  market_state: string;
  updated_at: string;
}

interface PriceResponse {
  price: number;
  change: number;
  changePercent: number;
  marketState: string;
  timestamp: number;
  stale?: boolean;
}

function shape(row: CachedPrice, stale: boolean): PriceResponse {
  return {
    price: Number(row.price) || 0,
    change: Number(row.change) || 0,
    changePercent: Number(row.change_percent) || 0,
    marketState: row.market_state || "CLOSED",
    timestamp: new Date(row.updated_at).getTime(),
    ...(stale ? { stale: true } : {}),
  };
}

export async function GET() {
  const supabase = createAdminSupabase();

  // Read the singleton cache row (seeded by the migration).
  const { data: cached } = await supabase
    .from("es_price_cache")
    .select("price, change, change_percent, market_state, updated_at")
    .eq("id", 1)
    .maybeSingle();

  const cachedRow = cached as CachedPrice | null;
  const now = Date.now();
  const cachedAge =
    cachedRow ? now - new Date(cachedRow.updated_at).getTime() : Infinity;

  // Fresh cache hit → return it.
  if (cachedRow && cachedRow.price > 0 && cachedAge < CACHE_TTL_MS) {
    return Response.json(shape(cachedRow, false));
  }

  // Cache stale or empty → refresh from Yahoo.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yf.quote("ES=F");
    const fresh = {
      id: 1,
      price: quote.regularMarketPrice ?? 0,
      change: quote.regularMarketChange ?? 0,
      change_percent: quote.regularMarketChangePercent ?? 0,
      market_state: quote.marketState ?? "CLOSED",
      updated_at: new Date().toISOString(),
    };

    // Upsert. Don't block the response on a write hiccup.
    supabase
      .from("es_price_cache")
      .upsert(fresh)
      .then(({ error }) => {
        if (error) console.error("es_price_cache upsert error:", error);
      });

    return Response.json(shape(fresh, false));
  } catch (err) {
    console.error("Yahoo Finance fetch error:", err);
    // Yahoo failed (timeout, cookie wall, rate limit). Fall back to whatever
    // is in the cache, marked stale, so the UI keeps a recent frame.
    if (cachedRow && cachedRow.price > 0) {
      return Response.json(shape(cachedRow, true));
    }
    return Response.json(
      {
        price: 0,
        change: 0,
        changePercent: 0,
        marketState: "CLOSED",
        timestamp: now,
        stale: true,
      },
      { status: 502 },
    );
  }
}
