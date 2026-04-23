"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { parseLevels } from "@/lib/parser";
import { createBrowserSupabase } from "@/lib/supabase";
import { ParsedPlan, Trade, Session } from "@/lib/types";
import LevelLadder from "@/components/LevelLadder";
import GamePlan from "@/components/GamePlan";
import TradeLog from "@/components/TradeLog";
import PasteModal from "@/components/PasteModal";

const TABS = ["Levels", "Game Plan", "Trade Log"] as const;
type Tab = (typeof TABS)[number];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("Levels");
  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string>("");
  const [showPaste, setShowPaste] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);

  // Session management
  const [sessionDate, setSessionDate] = useState<string>("");
  const [sessions, setSessions] = useState<Session[]>([]);

  // Load user info on mount
  useEffect(() => {
    const supabase = createBrowserSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserEmail(user.email || "");
        setUserId(user.id);
      }
    });
  }, []);

  async function handleSignOut() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Load all available sessions on mount
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Session[]) => {
        setSessions(data);
        // Load the most recent session by default
        if (data.length > 0) {
          setSessionDate(data[0].session_date);
        }
      })
      .catch(() => {});
  }, []);

  // Load plan + trades whenever sessionDate changes
  const loadSession = useCallback((date: string) => {
    if (!date) return;

    // Fetch plan for this session
    fetch(`/api/latest-plan?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.body) {
          const result = parseLevels(data.body, data.subject);
          setParsed(result);
        } else {
          setParsed(null);
        }
      })
      .catch(() => setParsed(null));

    // Fetch trades for this session
    fetch(`/api/trades?date=${date}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setTrades)
      .catch(() => setTrades([]));
  }, []);

  useEffect(() => {
    if (sessionDate) loadSession(sessionDate);
  }, [sessionDate, loadSession]);

  // Navigate sessions
  function navigateSession(direction: -1 | 1) {
    const currentIdx = sessions.findIndex((s) => s.session_date === sessionDate);
    // Sessions are sorted newest first, so -1 = newer, +1 = older
    const newIdx = currentIdx - direction;
    if (newIdx >= 0 && newIdx < sessions.length) {
      setSessionDate(sessions[newIdx].session_date);
    }
  }

  function handlePaste(text: string) {
    const result = parseLevels(text);
    setParsed(result);
    setSessionDate(result.sessionDate);
    setShowPaste(false);

    // Store in Supabase with user_id
    fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: new Date().toISOString(),
        subject: "Manual Paste",
        body: text,
        user_id: userId,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.session_date) {
          setSessionDate(data.session_date);
          // Refresh sessions list
          fetch("/api/sessions")
            .then((r) => (r.ok ? r.json() : []))
            .then(setSessions)
            .catch(() => {});
        }
      })
      .catch(() => {});
  }

  const price = parseFloat(currentPrice) || 0;

  // Calculate session P&L
  const sessionPnL = trades
    .filter((t) => t.pnl !== null)
    .reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Format session date for display
  const displayDate = sessionDate
    ? new Date(sessionDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No session loaded";

  const currentIdx = sessions.findIndex((s) => s.session_date === sessionDate);
  const canGoNewer = currentIdx > 0;
  const canGoOlder = currentIdx < sessions.length - 1;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* HEADER */}
      <header
        className="flex items-center gap-5 px-6 py-3 border-b"
        style={{ background: "var(--bg-1)", borderColor: "var(--border-light)" }}
      >
        <div className="pr-4 border-r" style={{ borderColor: "var(--border)" }}>
          <div
            className="text-xs font-extrabold tracking-[3px] uppercase"
            style={{ color: "var(--text-3)" }}
          >
            TradeLadder
          </div>
        </div>

        {/* Date Navigator */}
        <div
          className="flex items-center gap-1 px-3 py-2 rounded-lg"
          style={{ background: "var(--gold-bg)", border: "1px solid rgba(251,191,36,.2)" }}
        >
          <button
            onClick={() => navigateSession(1)}
            disabled={!canGoOlder}
            className="px-2 py-0.5 rounded text-lg font-bold transition-opacity"
            style={{
              color: "var(--gold)",
              opacity: canGoOlder ? 1 : 0.2,
              background: "none",
              border: "none",
              cursor: canGoOlder ? "pointer" : "default",
            }}
          >
            ◄
          </button>
          <div className="text-center min-w-[180px]">
            <div
              className="text-[10px] font-bold uppercase tracking-[2px]"
              style={{ color: "var(--gold)" }}
            >
              Session
            </div>
            <div className="text-sm font-extrabold mt-0.5">{displayDate}</div>
          </div>
          <button
            onClick={() => navigateSession(-1)}
            disabled={!canGoNewer}
            className="px-2 py-0.5 rounded text-lg font-bold transition-opacity"
            style={{
              color: "var(--gold)",
              opacity: canGoNewer ? 1 : 0.2,
              background: "none",
              border: "none",
              cursor: canGoNewer ? "pointer" : "default",
            }}
          >
            ►
          </button>
        </div>

        {/* Lean */}
        {parsed?.lean && (
          <div className="flex-1 min-w-0">
            <div
              className="text-[10px] font-bold uppercase tracking-[2px] mb-0.5"
              style={{ color: "var(--gold)" }}
            >
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
          <span className="text-sm font-bold" style={{ color: "var(--text-3)" }}>
            ES
          </span>
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
        <div
          className="text-right min-w-[120px] pl-4 border-l"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="mono text-2xl font-extrabold leading-none"
            style={{
              color:
                sessionPnL > 0
                  ? "var(--bull)"
                  : sessionPnL < 0
                  ? "var(--bear)"
                  : "var(--text-3)",
            }}
          >
            {sessionPnL >= 0 ? "+" : ""}${sessionPnL.toLocaleString()}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
            Session P&L
          </div>
        </div>

        {/* User */}
        <div className="pl-4 border-l flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs truncate max-w-[120px]" style={{ color: "var(--text-4)" }}>
            {userEmail}
          </div>
          <button
            onClick={handleSignOut}
            className="text-xs px-3 py-1 rounded border hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-4)" }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* TABS + ACTIONS */}
      <div
        className="flex items-center border-b px-4"
        style={{ background: "var(--bg-1)", borderColor: "var(--border-light)" }}
      >
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-5 py-3 text-xs font-bold tracking-[2px] uppercase border-b-[3px] transition-all"
              style={{
                color: activeTab === tab ? "var(--text-1)" : "var(--text-3)",
                borderBottomColor:
                  activeTab === tab ? "var(--gold)" : "transparent",
                background: "none",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex gap-2 items-center">
          {/* Session count */}
          <span className="text-xs mr-2" style={{ color: "var(--text-4)" }}>
            {sessions.length} sessions
          </span>
          <button
            onClick={() => setShowPaste(true)}
            className="px-4 py-2 text-xs font-bold rounded-lg border-2 transition-all hover:opacity-80"
            style={{ borderColor: "var(--blue)", color: "var(--blue)" }}
          >
            📋 Paste Email
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
          <TradeLog
            trades={trades}
            setTrades={setTrades}
            sessionDate={sessionDate}
          />
        )}
      </main>

      {/* PASTE MODAL */}
      {showPaste && (
        <PasteModal onSubmit={handlePaste} onClose={() => setShowPaste(false)} />
      )}
    </div>
  );
}
