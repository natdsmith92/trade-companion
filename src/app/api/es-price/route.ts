import yahooFinance from "yahoo-finance2";

interface PriceCache {
  price: number;
  change: number;
  changePercent: number;
  marketState: string;
  timestamp: number;
  stale?: boolean;
}

let cache: PriceCache = {
  price: 0,
  change: 0,
  changePercent: 0,
  marketState: "CLOSED",
  timestamp: 0,
};

const CACHE_TTL = 10_000; // 10 seconds

export async function GET() {
  const now = Date.now();

  // Return cached price if fresh
  if (cache.price > 0 && now - cache.timestamp < CACHE_TTL) {
    return Response.json(cache);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote: any = await yahooFinance.quote("ES=F");
    cache = {
      price: quote.regularMarketPrice ?? 0,
      change: quote.regularMarketChange ?? 0,
      changePercent: quote.regularMarketChangePercent ?? 0,
      marketState: quote.marketState ?? "CLOSED",
      timestamp: now,
    };
    return Response.json(cache);
  } catch (err) {
    console.error("Yahoo Finance fetch error:", err);
    // Return stale cache on error
    if (cache.price > 0) {
      return Response.json({ ...cache, stale: true });
    }
    return Response.json(
      { price: 0, change: 0, changePercent: 0, marketState: "CLOSED", timestamp: now, stale: true },
      { status: 502 }
    );
  }
}
