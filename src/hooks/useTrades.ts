"use client";

import { useEffect, useState } from "react";
import { Trade } from "@/lib/types";

export interface TradesState {
  trades: Trade[];
  createTrade: (t: Trade) => void;
  updateTrade: (t: Trade) => void;
  deleteTrade: (id: string) => Promise<void>;
}

export function useTrades(sessionDate: string): TradesState {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    if (!sessionDate) {
      setTrades([]);
      return;
    }
    fetch(`/api/trades?date=${sessionDate}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setTrades)
      .catch(() => setTrades([]));
  }, [sessionDate]);

  function createTrade(t: Trade) {
    setTrades((prev) => [t, ...prev]);
  }

  function updateTrade(t: Trade) {
    setTrades((prev) => prev.map((x) => (x.id === t.id ? t : x)));
  }

  async function deleteTrade(id: string) {
    if (!confirm("Delete this trade?")) return;
    try {
      await fetch(`/api/trades/${id}`, { method: "DELETE" });
      setTrades((prev) => prev.filter((t) => t.id !== id));
    } catch {
      // silent
    }
  }

  return { trades, createTrade, updateTrade, deleteTrade };
}
