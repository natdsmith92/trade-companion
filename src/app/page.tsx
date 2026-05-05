"use client";

import { useState } from "react";
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
import Header from "@/components/Header";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useAuth } from "@/hooks/useAuth";
import { useSessions } from "@/hooks/useSessions";
import { useParsedPlan } from "@/hooks/useParsedPlan";
import { useTrades } from "@/hooks/useTrades";
import { useESPrice } from "@/hooks/useESPrice";
import { useManualPrice } from "@/hooks/useManualPrice";
import { computePnL } from "@/lib/pnl";

const TABS = ["plan", "trades", "tldr"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  plan: "Game Plan",
  trades: "Trade Log",
  tldr: "TL;DR",
};

export default function Dashboard() {
  const { userEmail, userId, signOut } = useAuth();

  const {
    sessions,
    sessionDate,
    setSessionDate,
    navigate,
    canGoNewer,
    canGoOlder,
    refreshSessions,
  } = useSessions();

  const { parsed, headline, ingestPaste } = useParsedPlan({
    sessionDate,
    userId,
    onSessionChanged: setSessionDate,
    onAfterIngest: refreshSessions,
  });

  const { trades, createTrade, updateTrade, deleteTrade } = useTrades(sessionDate);

  const esPrice = useESPrice();
  const price = useManualPrice(esPrice);
  const pnl = computePnL(trades, price.currentPrice);

  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [showPaste, setShowPaste] = useState(false);
  const [showNewTrade, setShowNewTrade] = useState(false);
  const [editTradeId, setEditTradeId] = useState<string | null>(null);
  const editTrade = trades.find((t) => t.id === editTradeId) || null;

  const planLabel = sessionDate
    ? new Date(sessionDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "—";

  function handlePaste(text: string) {
    ingestPaste(text);
    setShowPaste(false);
  }

  return (
    <div className="app">
      <Header
        planLabel={planLabel}
        canGoNewer={canGoNewer}
        canGoOlder={canGoOlder}
        onNavigate={navigate}
        headline={headline}
        lean={parsed?.lean}
        manualPriceStr={price.manualPriceStr}
        manualOverride={price.manualOverride}
        currentPrice={price.currentPrice}
        priceSource={price.priceSource}
        isStale={esPrice.isStale}
        onPriceChange={price.onChange}
        onPriceFocus={price.onFocus}
        onClearOverride={price.clear}
        pnl={pnl}
        tradesCount={trades.length}
        userEmail={userEmail}
        onSignOut={signOut}
      />

      <div className="main">
        <ErrorBoundary label="Level Ladder">
          <LevelLadder
            supports={parsed?.supports || []}
            resistances={parsed?.resistances || []}
            currentPrice={price.currentPrice}
            priceSource={price.priceSource}
            onPaste={() => setShowPaste(true)}
          />
        </ErrorBoundary>

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
              <ErrorBoundary label="Game Plan">
                <GamePlan
                  bullTargets={parsed?.bullTargets || []}
                  bearTargets={parsed?.bearTargets || []}
                  triggers={parsed?.triggers || []}
                  supports={parsed?.supports || []}
                  currentPrice={price.currentPrice}
                  sessionDate={sessionDate}
                />
              </ErrorBoundary>
            )}
            {activeTab === "trades" && (
              <ErrorBoundary label="Trade Stats">
                <TradeStats trades={trades} currentPrice={price.currentPrice} />
              </ErrorBoundary>
            )}
            {activeTab === "tldr" && (
              <ErrorBoundary label="TL;DR">
                <TldrTab sessionDate={sessionDate} />
              </ErrorBoundary>
            )}
          </div>
        </section>
      </div>

      <TradeBar
        trades={trades}
        currentPrice={price.currentPrice}
        onNew={() => setShowNewTrade(true)}
        onEdit={(id) => setEditTradeId(id)}
        onDelete={deleteTrade}
      />

      {showPaste && (
        <PasteModal onSubmit={handlePaste} onClose={() => setShowPaste(false)} />
      )}
      {showNewTrade && (
        <NewTradeModal
          sessionDate={sessionDate}
          onClose={() => setShowNewTrade(false)}
          onCreated={createTrade}
        />
      )}
      {editTrade && (
        <EditTradeModal
          trade={editTrade}
          onClose={() => setEditTradeId(null)}
          onUpdated={updateTrade}
        />
      )}
    </div>
  );
}
