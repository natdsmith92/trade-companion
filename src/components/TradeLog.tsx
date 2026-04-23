"use client";

import { useState } from "react";
import { Trade } from "@/lib/types";
import { calculatePnL } from "@/lib/parser";

const SYMBOLS = [
  { name: "ES", pointValue: 50 },
  { name: "MES", pointValue: 5 },
  { name: "MNQ", pointValue: 2 },
  { name: "NQ", pointValue: 20 },
];

const SETUPS = ["Failed Breakdown", "Flag", "Trendline", "Other"] as const;

interface Props {
  trades: Trade[];
  setTrades: (trades: Trade[]) => void;
}

export default function TradeLog({ trades, setTrades }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // New trade form state
  const [symbol, setSymbol] = useState("ES");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [contracts, setContracts] = useState("1");
  const [setupType, setSetupType] = useState<string>("Failed Breakdown");

  // Exit form state
  const [exit75, setExit75] = useState("");
  const [exitRunner, setExitRunner] = useState("");

  async function handleNewTrade() {
    if (!entryPrice) return;

    const pointValue = SYMBOLS.find((s) => s.name === symbol)?.pointValue || 50;
    const trade = {
      symbol,
      direction,
      entry_price: parseFloat(entryPrice),
      contracts: parseInt(contracts) || 1,
      setup_type: setupType,
      point_value: pointValue,
    };

    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trade),
      });
      if (res.ok) {
        const saved = await res.json();
        setTrades([saved, ...trades]);
        setShowNew(false);
        setEntryPrice("");
        setContracts("1");
      }
    } catch {
      // Silently fail — trade stays in form
    }
  }

  async function handleExit(tradeId: string) {
    const trade = trades.find((t) => t.id === tradeId);
    if (!trade) return;

    const exit75Val = exit75 ? parseFloat(exit75) : trade.exit_75_price;
    const exitRunnerVal = exitRunner ? parseFloat(exitRunner) : trade.exit_runner_price;

    const pnl = calculatePnL(
      trade.direction,
      trade.entry_price,
      exit75Val,
      exitRunnerVal,
      trade.contracts,
      trade.point_value
    );

    const update: Record<string, unknown> = { pnl };
    if (exit75) update.exit_75_price = parseFloat(exit75);
    if (exitRunner) update.exit_runner_price = parseFloat(exitRunner);

    try {
      const res = await fetch(`/api/trades/${tradeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (res.ok) {
        const updated = await res.json();
        setTrades(trades.map((t) => (t.id === tradeId ? updated : t)));
        setEditingId(null);
        setExit75("");
        setExitRunner("");
      }
    } catch {
      // Silently fail
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/trades/${id}`, { method: "DELETE" });
      setTrades(trades.filter((t) => t.id !== id));
    } catch {
      // Silently fail
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* New Trade Button */}
      <div className="flex justify-between items-center mb-4">
        <div className="text-xs font-bold uppercase tracking-[2px]" style={{ color: "var(--text-3)" }}>
          Trades ({trades.length})
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="px-4 py-2 text-xs font-bold rounded-lg border-2 transition-all hover:opacity-80"
          style={{ borderColor: "var(--bull)", color: "var(--bull)" }}
        >
          + New Trade
        </button>
      </div>

      {/* New Trade Form */}
      {showNew && (
        <div className="rounded-xl p-5 mb-4" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
          <div className="grid grid-cols-5 gap-3">
            {/* Symbol */}
            <div>
              <label className="text-[10px] uppercase tracking-[1px] mb-1 block" style={{ color: "var(--text-3)" }}>Symbol</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm font-bold outline-none"
                style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text-1)" }}
              >
                {SYMBOLS.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Direction */}
            <div>
              <label className="text-[10px] uppercase tracking-[1px] mb-1 block" style={{ color: "var(--text-3)" }}>Direction</label>
              <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <button
                  onClick={() => setDirection("long")}
                  className="flex-1 py-2 text-sm font-bold transition-all"
                  style={{
                    background: direction === "long" ? "var(--bull-bg)" : "var(--bg-3)",
                    color: direction === "long" ? "var(--bull)" : "var(--text-4)",
                  }}
                >
                  Long
                </button>
                <button
                  onClick={() => setDirection("short")}
                  className="flex-1 py-2 text-sm font-bold transition-all"
                  style={{
                    background: direction === "short" ? "var(--bear-bg)" : "var(--bg-3)",
                    color: direction === "short" ? "var(--bear)" : "var(--text-4)",
                  }}
                >
                  Short
                </button>
              </div>
            </div>

            {/* Entry Price */}
            <div>
              <label className="text-[10px] uppercase tracking-[1px] mb-1 block" style={{ color: "var(--text-3)" }}>Entry</label>
              <input
                type="number"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="6700"
                className="w-full mono rounded-lg px-3 py-2 text-sm font-bold outline-none"
                style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text-1)" }}
              />
            </div>

            {/* Contracts */}
            <div>
              <label className="text-[10px] uppercase tracking-[1px] mb-1 block" style={{ color: "var(--text-3)" }}>Contracts</label>
              <input
                type="number"
                value={contracts}
                onChange={(e) => setContracts(e.target.value)}
                className="w-full mono rounded-lg px-3 py-2 text-sm font-bold outline-none"
                style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text-1)" }}
              />
            </div>

            {/* Setup */}
            <div>
              <label className="text-[10px] uppercase tracking-[1px] mb-1 block" style={{ color: "var(--text-3)" }}>Setup</label>
              <select
                value={setupType}
                onChange={(e) => setSetupType(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm font-bold outline-none"
                style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text-1)" }}
              >
                {SETUPS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setShowNew(false)}
              className="px-4 py-2 text-xs font-bold rounded-lg border-2"
              style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleNewTrade}
              className="px-4 py-2 text-xs font-bold rounded-lg border-2"
              style={{ borderColor: "var(--bull)", color: "var(--bull)" }}
            >
              Log Trade
            </button>
          </div>
        </div>
      )}

      {/* Trade List */}
      {trades.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--text-4)" }}>
          <div className="text-4xl mb-3">📊</div>
          <div className="text-sm">No trades logged yet</div>
        </div>
      ) : (
        <div className="space-y-2">
          {trades.map((trade) => {
            const isOpen = trade.exit_75_price === null && trade.exit_runner_price === null;
            const isEditing = editingId === trade.id;

            return (
              <div
                key={trade.id}
                className="rounded-xl p-4"
                style={{
                  background: "var(--bg-2)",
                  border: `1px solid ${isOpen ? "var(--blue)" : "var(--border)"}`,
                }}
              >
                <div className="flex items-center gap-4">
                  {/* Direction + Symbol */}
                  <div
                    className="text-sm font-bold px-3 py-1 rounded-md"
                    style={{
                      background: trade.direction === "long" ? "var(--bull-bg)" : "var(--bear-bg)",
                      color: trade.direction === "long" ? "var(--bull)" : "var(--bear)",
                    }}
                  >
                    {trade.direction === "long" ? "▲" : "▼"} {trade.symbol}
                  </div>

                  {/* Entry */}
                  <div>
                    <div className="text-[10px] uppercase" style={{ color: "var(--text-4)" }}>Entry</div>
                    <div className="mono text-base font-semibold">{trade.entry_price}</div>
                  </div>

                  {/* Contracts */}
                  <div>
                    <div className="text-[10px] uppercase" style={{ color: "var(--text-4)" }}>Qty</div>
                    <div className="mono text-base font-semibold">{trade.contracts}</div>
                  </div>

                  {/* 75% Exit */}
                  <div>
                    <div className="text-[10px] uppercase" style={{ color: "var(--text-4)" }}>75% Exit</div>
                    <div className="mono text-base font-semibold">
                      {trade.exit_75_price || "—"}
                    </div>
                  </div>

                  {/* Runner Exit */}
                  <div>
                    <div className="text-[10px] uppercase" style={{ color: "var(--text-4)" }}>Runner</div>
                    <div className="mono text-base font-semibold">
                      {trade.exit_runner_price || "—"}
                    </div>
                  </div>

                  {/* Setup */}
                  {trade.setup_type && (
                    <div
                      className="text-[10px] font-bold px-2 py-1 rounded"
                      style={{ background: "var(--gold-bg)", color: "var(--gold)" }}
                    >
                      {trade.setup_type}
                    </div>
                  )}

                  <div className="flex-1" />

                  {/* P&L */}
                  {trade.pnl !== null && (
                    <div
                      className="mono text-xl font-extrabold"
                      style={{ color: trade.pnl >= 0 ? "var(--bull)" : "var(--bear)" }}
                    >
                      {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toLocaleString()}
                    </div>
                  )}

                  {/* Actions */}
                  <button
                    onClick={() => { setEditingId(isEditing ? null : trade.id); setExit75(""); setExitRunner(""); }}
                    className="text-xs px-2 py-1 rounded"
                    style={{ color: "var(--blue)", background: "var(--blue-bg)" }}
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => handleDelete(trade.id)}
                    className="text-xs px-2 py-1 rounded hover:opacity-70"
                    style={{ color: "var(--bear)", background: "var(--bear-bg)" }}
                  >
                    ✕
                  </button>
                </div>

                {/* Exit editing row */}
                {isEditing && (
                  <div className="flex items-end gap-3 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <label className="text-[10px] uppercase block mb-1" style={{ color: "var(--text-4)" }}>75% Exit Price</label>
                      <input
                        type="number"
                        value={exit75}
                        onChange={(e) => setExit75(e.target.value)}
                        placeholder={trade.exit_75_price?.toString() || "6716"}
                        className="mono rounded-lg px-3 py-2 text-sm font-bold outline-none w-32"
                        style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text-1)" }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase block mb-1" style={{ color: "var(--text-4)" }}>Runner Exit Price</label>
                      <input
                        type="number"
                        value={exitRunner}
                        onChange={(e) => setExitRunner(e.target.value)}
                        placeholder={trade.exit_runner_price?.toString() || "6738"}
                        className="mono rounded-lg px-3 py-2 text-sm font-bold outline-none w-32"
                        style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--text-1)" }}
                      />
                    </div>
                    <button
                      onClick={() => handleExit(trade.id)}
                      className="px-4 py-2 text-xs font-bold rounded-lg border-2"
                      style={{ borderColor: "var(--bull)", color: "var(--bull)" }}
                    >
                      Save Exit
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
