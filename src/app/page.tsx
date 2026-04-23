"use client";

import { useState, useEffect } from "react";
import { parseLevels } from "@/lib/parser";
import { ParsedPlan, Level, Trade } from "@/lib/types";
import LevelLadder from "@/components/LevelLadder";
import GamePlan from "@/components/GamePlan";
import TradeLog from "@/components/TradeLog";
import PasteModal from "@/components/PasteModal";

const TABS = ["Levels", "Game Plan", "Trade Log"] as const;
type Tab = (typeof TABS)[number];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("Levels");
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string>("");
  const [showPaste, setShowPaste] = useState(false);
  const [planDate, setPlanDate] = useState<string>("");
  const [trades, setTrades] = useState<Trade[]>([]);

  // Load latest plan from Supabase on mount
  useEffect(() => {
    fetch("/api/latest-plan")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.body) {
          const result = parseLevels(data.body);
          setParsed(result);
          setPlanDate(data.email_date || data.created_at);
        }
      })
      .catch(() => {});

    // Load trades
    fetch("/api/trades")
      .then((r) => (r.ok ? r.json() : []))
      .then(setTrades)
      .catch(() => {});
  }, []);

  function handlePaste(text: string) {
    const result = parseLevels(text);
    setParsed(result);
    setPlanDate(new Date().toLocaleDateString());
    setShowPaste(false);

    // Also store in Supabase
    fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: new Date().toISOString(),
        subject: "Manual Paste",
        body: text,
      }),
    }).catch(() => {});
  }

  function handleClearDay() {
    setParsed(null);
    setCurrentPrice("");
    setPlanDate("");
  }

  const price = parseFloat(currentPrice) || 0;

  // Calculate today's P&L from trades
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayPnL = trades
    .filter((t) => new Date(t.created_at) >= todayStart && t.pnl !== null)
    .reduce((sum, t) => sum + (t.pnl || 0), 0);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* HEADER */}
      <header className="flex items-center gap-5 px-6 py-3 border-b" style={{ background: "var(--bg-1)", borderColor: "var(--border-light)" }}>
        <div className="pr-4 border-r" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs font-extrabold tracking-[3px] uppercase" style={{ color: "var(--text-3)" }}>
            TradeLadder
          </div>
        </div>

        {planDate && (
          <div className="px-4 py-2 rounded-lg text-center" style={{ background: "var(--gold-bg)", border: "1px solid rgba(251,191,36,.2)" }}>
            <div className="text-[10px] font-bold uppercase tracking-[2px]" style={{ color: "var(--gold)" }}>
              Plan Date
            </div>
            <div className="text-sm font-extrabold mt-0.5">{planDate}</div>
          </div>
        )}

        {parsed?.lean && (
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[2px] mb-0.5" style={{ color: "var(--gold)" }}>
              Lean
            </div>
            <div className="text-sm font-medium truncate">{parsed.lean}</div>
          </div>
        )}

        {/* Current Price Input */}
        <div
          className="flex items-baseline gap-2 rounded-lg px-3 py-2 transition-all"
          style={{ background: "var(--bg-2)", border: "2px solid var(--border-light)" }}
        >
          <span className="text-sm font-bold" style={{ color: "var(--text-3)" }}>ES</span>
          <input
            type="number"
            value={currentPrice}
            onChange={(e) => setCurrentPrice(e.target.value)}
            placeholder="0000"
            className="mono text-2xl font-extrabold bg-transparent border-none outline-none w-24 text-right"
            style={{ color: "var(--blue-bright)" }}
          />
        </div>

        {/* P&L */}
        <div className="text-right min-w-[120px] pl-4 border-l" style={{ borderColor: "var(--border)" }}>
          <div
            className="mono text-2xl font-extrabold leading-none"
            style={{ color: todayPnL > 0 ? "var(--bull)" : todayPnL < 0 ? "var(--bear)" : "var(--text-3)" }}
          >
            {todayPnL >= 0 ? "+" : ""}${todayPnL.toLocaleString()}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>Today P&L</div>
        </div>
      </header>

      {/* TABS + ACTIONS */}
      <div className="flex items-center border-b px-4" style={{ background: "var(--bg-1)", borderColor: "var(--border-light)" }}>
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-5 py-3 text-xs font-bold tracking-[2px] uppercase border-b-[3px] transition-all"
              style={{
                color: activeTab === tab ? "var(--text-1)" : "var(--text-3)",
                borderBottomColor: activeTab === tab ? "var(--gold)" : "transparent",
                background: "none",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex gap-2">
          <button
            onClick={() => setShowPaste(true)}
            className="px-4 py-2 text-xs font-bold rounded-lg border-2 transition-all hover:opacity-80"
            style={{ borderColor: "var(--blue)", color: "var(--blue)" }}
          >
            📋 Paste Email
          </button>
          <button
            onClick={handleClearDay}
            className="px-4 py-2 text-xs font-bold rounded-lg border-2 transition-all hover:opacity-80"
            style={{ borderColor: "var(--bear)", color: "var(--bear)" }}
          >
            Clear Day
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <main className="flex-1 overflow-y-auto p-5" style={{ background: "var(--bg-0)" }}>
        {activeTab === "Levels" && (
          <LevelLadder
            supports={parsed?.supports || []}
            resistances={parsed?.resistances || []}
            currentPrice={price}
          />
        )}
        {activeTab === "Game Plan" && (
          <GamePlan
            bullTargets={parsed?.bullTargets || []}
            bearTargets={parsed?.bearTargets || []}
            triggers={parsed?.triggers || []}
            currentPrice={price}
          />
        )}
        {activeTab === "Trade Log" && (
          <TradeLog trades={trades} setTrades={setTrades} />
        )}
      </main>

      {/* PASTE MODAL */}
      {showPaste && (
        <PasteModal
          onSubmit={handlePaste}
          onClose={() => setShowPaste(false)}
        />
      )}
    </div>
  );
}
