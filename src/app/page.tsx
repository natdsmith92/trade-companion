"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { parseLevels } from "@/lib/parser";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { ParsedPlan, Trade, Session } from "@/lib/types";
import LevelLadder from "@/components/LevelLadder";
import GamePlan from "@/components/GamePlan";
import TldrTab from "@/components/TldrTab";
import PasteModal from "@/components/PasteModal";
import {
  TradeBar,
  TradeStats,
  NewTradeModal,
  EditTradeModal,
} from "@/components/TradeLog";
import { useESPrice } from "@/hooks/useESPrice";

const TABS = ["plan", "trades", "tldr"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  plan: "Game Plan",
  trades: "Trade Log",
  tldr: "TL;DR",
};

export default function Dashboard() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [manualPriceStr, setManualPriceStr] = useState<string>("");
  const [manualOverride, setManualOverride] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);

  // Live ES price feed
  const esPrice = useESPrice();

  const [sessionDate, setSessionDate] = useState<string>("");
  const [sessions, setSessions] = useState<Session[]>([]);

  const [showPaste, setShowPaste] = useState(false);
  const [showNewTrade, setShowNewTrade] = useState(false);
  const [editTradeId, setEditTradeId] = useState<string | null>(null);
  const [headline, setHeadline] = useState<string>("");

  // Auth
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

  // Load all sessions on mount
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Session[]) => {
        setSessions(data);
        if (data.length > 0) setSessionDate(data[0].session_date);
      })
      .catch(() => {});
  }, []);

  // Load plan + trades for current session
  const loadSession = useCallback((date: string) => {
    if (!date) return;

    fetch(`/api/latest-plan?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.body) setParsed(parseLevels(data.body, data.subject));
        else setParsed(null);
      })
      .catch(() => setParsed(null));

    fetch(`/api/trades?date=${date}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setTrades)
      .catch(() => setTrades([]));

    // Fetch AI-generated headline for the header
    fetch(`/api/tldr?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.headline) setHeadline(data.headline);
        else setHeadline("");
      })
      .catch(() => setHeadline(""));
  }, []);

  useEffect(() => {
    if (sessionDate) loadSession(sessionDate);
  }, [sessionDate, loadSession]);

  function navigateSession(direction: -1 | 1) {
    const idx = sessions.findIndex((s) => s.session_date === sessionDate);
    const newIdx = idx - direction;
    if (newIdx >= 0 && newIdx < sessions.length) {
      setSessionDate(sessions[newIdx].session_date);
    }
  }

  function handlePaste(text: string) {
    const result = parseLevels(text);
    setParsed(result);
    setSessionDate(result.sessionDate);
    setShowPaste(false);

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
          fetch("/api/sessions")
            .then((r) => (r.ok ? r.json() : []))
            .then(setSessions)
            .catch(() => {});
        }
      })
      .catch(() => {});
  }

  async function handleDeleteTrade(id: string) {
    if (!confirm("Delete this trade?")) return;
    try {
      await fetch(`/api/trades/${id}`, { method: "DELETE" });
      setTrades(trades.filter((t) => t.id !== id));
    } catch {
      // silent
    }
  }

  function handleTradeCreated(t: Trade) {
    setTrades([t, ...trades]);
  }

  function handleTradeUpdated(t: Trade) {
    setTrades(trades.map((x) => (x.id === t.id ? t : x)));
  }

  // Price priority: manual override > live feed > 0
  const manualPrice = parseFloat(manualPriceStr) || 0;
  const currentPrice = manualOverride && manualPrice > 0 ? manualPrice : esPrice.price;
  const priceSource: "live" | "manual" | "none" =
    manualOverride && manualPrice > 0 ? "manual" : esPrice.price > 0 ? "live" : "none";

  // Live P&L (realized + open runner unrealized)
  let realizedPnL = 0;
  let unrealizedPnL = 0;
  for (const t of trades) {
    realizedPnL += t.pnl ?? 0;
    // Unrealized for open runners (75% exited, runner still open)
    if (t.exit_75_price && !t.exit_runner_price && currentPrice > 0) {
      const sign = t.direction === "long" ? 1 : -1;
      unrealizedPnL +=
        (currentPrice - t.entry_price) *
        sign *
        t.contracts *
        0.25 *
        t.point_value;
    }
    // Unrealized for fully open trades (no exits at all)
    if (!t.exit_75_price && !t.exit_runner_price && currentPrice > 0) {
      const sign = t.direction === "long" ? 1 : -1;
      unrealizedPnL +=
        (currentPrice - t.entry_price) *
        sign *
        t.contracts *
        t.point_value;
    }
  }
  const sessionPnL = realizedPnL + unrealizedPnL;
  const hasOpenTrades = unrealizedPnL !== 0;

  const planLabel = sessionDate
    ? new Date(sessionDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "—";

  const idx = sessions.findIndex((s) => s.session_date === sessionDate);
  const canGoNewer = idx > 0;
  const canGoOlder = idx < sessions.length - 1 && idx >= 0;

  const editTrade = trades.find((t) => t.id === editTradeId) || null;

  return (
    <div className="app">
      {/* ─────── HEADER ─────── */}
      <header className="hdr">
        <div className="hdr-br">
          <img src="/logo.png" alt="TradeLadder" className="hdr-logo" />
        </div>

        <div className="hdr-plan-date">
          <button
            className="hdr-plan-nav"
            onClick={() => navigateSession(1)}
            disabled={!canGoOlder}
            title="Older session"
          >
            ◄
          </button>
          <div className="hdr-plan-block">
            <div className="hdr-plan-label">Plan For</div>
            <div className="hdr-plan-val">{planLabel}</div>
          </div>
          <button
            className="hdr-plan-nav"
            onClick={() => navigateSession(-1)}
            disabled={!canGoNewer}
            title="Newer session"
          >
            ►
          </button>
        </div>

        <div className="hdr-lean">
          <div className="hdr-lean-l">Today&apos;s Thesis</div>
          <div className="hdr-lean-t">
            {headline || parsed?.lean || "Paste an email to load today's plan"}
          </div>
        </div>

        <div className="hdr-p">
          <div className="hdr-p-l">ES</div>
          <input
            type="number"
            className="hdr-p-i"
            value={manualOverride ? manualPriceStr : currentPrice > 0 ? currentPrice.toString() : ""}
            onChange={(e) => {
              setManualPriceStr(e.target.value);
              setManualOverride(true);
            }}
            onFocus={() => {
              if (!manualOverride && currentPrice > 0) {
                setManualPriceStr(currentPrice.toString());
                setManualOverride(true);
              }
            }}
            placeholder="0000"
          />
          {priceSource === "live" && (
            <div className="hdr-p-badge live">
              <span className="hdr-p-dot live" />
              LIVE
            </div>
          )}
          {priceSource === "manual" && (
            <div className="hdr-p-badge manual">
              <span className="hdr-p-dot manual" />
              MANUAL
              <button
                className="hdr-p-clear"
                onClick={() => { setManualOverride(false); setManualPriceStr(""); }}
                title="Clear override, return to live feed"
              >
                ✕
              </button>
            </div>
          )}
          {esPrice.isStale && priceSource === "live" && (
            <div className="hdr-p-badge stale">
              <span className="hdr-p-dot stale" />
              STALE
            </div>
          )}
        </div>

        <div className="hdr-pnl">
          <div
            className={`hdr-pnl-v ${
              sessionPnL > 0 ? "pos" : sessionPnL < 0 ? "neg" : "flat"
            }`}
          >
            {sessionPnL >= 0 ? "+" : "-"}$
            {Math.abs(Math.round(sessionPnL)).toLocaleString()}
          </div>
          <div className="hdr-pnl-l">
            {hasOpenTrades ? (
              <>
                <span className="hdr-pnl-real">
                  {realizedPnL >= 0 ? "+" : "-"}${Math.abs(Math.round(realizedPnL)).toLocaleString()} realized
                </span>
                {" · "}
                <span className={unrealizedPnL >= 0 ? "hdr-pnl-upos" : "hdr-pnl-uneg"}>
                  {unrealizedPnL >= 0 ? "+" : "-"}${Math.abs(Math.round(unrealizedPnL)).toLocaleString()} open
                </span>
              </>
            ) : (
              <>Day P&amp;L · {trades.length} trade{trades.length !== 1 ? "s" : ""}</>
            )}
          </div>
        </div>

        <div className="hdr-user">
          <div className="hdr-user-email">{userEmail}</div>
          <button className="btn b-d b-sm" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {/* ─────── MAIN: ladder + right panel ─────── */}
      <div className="main">
        <LevelLadder
          supports={parsed?.supports || []}
          resistances={parsed?.resistances || []}
          currentPrice={currentPrice}
          priceSource={priceSource}
          onPaste={() => setShowPaste(true)}
        />

        <section className="rp">
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t}
                className={`tab${activeTab === t ? " on" : ""}`}
                onClick={() => setActiveTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <span className="hdr-user-email" style={{ marginRight: 12 }}>
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="tc">
            {activeTab === "plan" && (
              <GamePlan
                bullTargets={parsed?.bullTargets || []}
                bearTargets={parsed?.bearTargets || []}
                triggers={parsed?.triggers || []}
                supports={parsed?.supports || []}
                currentPrice={currentPrice}
                sessionDate={sessionDate}
              />
            )}
            {activeTab === "trades" && (
              <TradeStats trades={trades} currentPrice={currentPrice} />
            )}
            {activeTab === "tldr" && (
              <TldrTab sessionDate={sessionDate} />
            )}
          </div>
        </section>
      </div>

      {/* ─────── BOTTOM TRADE BAR ─────── */}
      <TradeBar
        trades={trades}
        currentPrice={currentPrice}
        onNew={() => setShowNewTrade(true)}
        onEdit={(id) => setEditTradeId(id)}
        onDelete={handleDeleteTrade}
      />

      {/* ─────── MODALS ─────── */}
      {showPaste && (
        <PasteModal onSubmit={handlePaste} onClose={() => setShowPaste(false)} />
      )}
      {showNewTrade && (
        <NewTradeModal
          sessionDate={sessionDate}
          onClose={() => setShowNewTrade(false)}
          onCreated={handleTradeCreated}
        />
      )}
      {editTrade && (
        <EditTradeModal
          trade={editTrade}
          onClose={() => setEditTradeId(null)}
          onUpdated={handleTradeUpdated}
        />
      )}
    </div>
  );
}
