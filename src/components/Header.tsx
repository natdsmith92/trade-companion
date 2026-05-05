"use client";

import { PnLBreakdown } from "@/lib/pnl";
import { PriceSource } from "@/hooks/useManualPrice";

interface HeaderProps {
  // Date navigation
  planLabel: string;
  canGoNewer: boolean;
  canGoOlder: boolean;
  onNavigate: (direction: -1 | 1) => void;

  // Thesis
  headline: string;
  lean: string | undefined;

  // Price
  manualPriceStr: string;
  manualOverride: boolean;
  currentPrice: number;
  priceSource: PriceSource;
  isStale: boolean;
  onPriceChange: (value: string) => void;
  onPriceFocus: () => void;
  onClearOverride: () => void;

  // P&L
  pnl: PnLBreakdown;
  tradesCount: number;

  // User
  userEmail: string;
  onSignOut: () => void;
}

export default function Header(props: HeaderProps) {
  const {
    planLabel,
    canGoNewer,
    canGoOlder,
    onNavigate,
    headline,
    lean,
    manualPriceStr,
    manualOverride,
    currentPrice,
    priceSource,
    isStale,
    onPriceChange,
    onPriceFocus,
    onClearOverride,
    pnl,
    tradesCount,
    userEmail,
    onSignOut,
  } = props;

  return (
    <header className="hdr">
      <div className="hdr-br">
        <img src="/logo.png" alt="TradeLadder" className="hdr-logo" />
      </div>

      <div className="hdr-plan-date">
        <button
          className="hdr-plan-nav"
          onClick={() => onNavigate(1)}
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
          onClick={() => onNavigate(-1)}
          disabled={!canGoNewer}
          title="Newer session"
        >
          ►
        </button>
      </div>

      <div className="hdr-lean">
        <div className="hdr-lean-l">Today&apos;s Thesis</div>
        <div className="hdr-lean-t">
          {headline || lean || "Paste an email to load today's plan"}
        </div>
      </div>

      <div className="hdr-p">
        <div className="hdr-p-l">ES</div>
        <input
          type="number"
          className="hdr-p-i"
          value={
            manualOverride
              ? manualPriceStr
              : currentPrice > 0
                ? currentPrice.toString()
                : ""
          }
          onChange={(e) => onPriceChange(e.target.value)}
          onFocus={onPriceFocus}
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
              onClick={onClearOverride}
              title="Clear override, return to live feed"
            >
              ✕
            </button>
          </div>
        )}
        {isStale && priceSource === "live" && (
          <div className="hdr-p-badge stale">
            <span className="hdr-p-dot stale" />
            STALE
          </div>
        )}
      </div>

      <div className="hdr-pnl">
        <div
          className={`hdr-pnl-v ${
            pnl.total > 0 ? "pos" : pnl.total < 0 ? "neg" : "flat"
          }`}
        >
          {pnl.total >= 0 ? "+" : "-"}$
          {Math.abs(Math.round(pnl.total)).toLocaleString()}
        </div>
        <div className="hdr-pnl-l">
          {pnl.hasOpenTrades ? (
            <>
              <span className="hdr-pnl-real">
                {pnl.realized >= 0 ? "+" : "-"}$
                {Math.abs(Math.round(pnl.realized)).toLocaleString()} realized
              </span>
              {" · "}
              <span className={pnl.unrealized >= 0 ? "hdr-pnl-upos" : "hdr-pnl-uneg"}>
                {pnl.unrealized >= 0 ? "+" : "-"}$
                {Math.abs(Math.round(pnl.unrealized)).toLocaleString()} open
              </span>
            </>
          ) : (
            <>Day P&amp;L · {tradesCount} trade{tradesCount !== 1 ? "s" : ""}</>
          )}
        </div>
      </div>

      <div className="hdr-user">
        <div className="hdr-user-email">{userEmail}</div>
        <button className="btn b-d b-sm" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
