"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface ESPriceData {
  price: number;
  change: number;
  changePercent: number;
  marketState: string;
  isLive: boolean;
  isStale: boolean;
  lastUpdate: number;
}

const POLL_INTERVAL = 15_000; // 15 seconds

export function useESPrice(): ESPriceData {
  const [data, setData] = useState<ESPriceData>({
    price: 0,
    change: 0,
    changePercent: 0,
    marketState: "CLOSED",
    isLive: false,
    isStale: false,
    lastUpdate: 0,
  });

  const prevPriceRef = useRef(0);

  const fetchPrice = useCallback(async () => {
    try {
      const res = await fetch("/api/es-price");
      if (!res.ok) return;
      const json = await res.json();

      if (json.price > 0) {
        prevPriceRef.current = json.price;
        setData({
          price: json.price,
          change: json.change ?? 0,
          changePercent: json.changePercent ?? 0,
          marketState: json.marketState ?? "CLOSED",
          isLive: !json.stale,
          isStale: !!json.stale,
          lastUpdate: Date.now(),
        });
      }
    } catch {
      // Mark as stale on network errors but keep last known price
      if (prevPriceRef.current > 0) {
        setData((prev) => ({ ...prev, isLive: false, isStale: true }));
      }
    }
  }, []);

  useEffect(() => {
    fetchPrice(); // Initial fetch
    const interval = setInterval(fetchPrice, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchPrice]);

  return data;
}
