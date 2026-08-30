"use client";

import { useRef, useState } from "react";
import { Trade } from "@/lib/types";
import { calculatePnL } from "@/lib/parser";

const SYMBOLS = [
  { name: "ES", pointValue: 50 },
  { name: "MES", pointValue: 5 },
  { name: "MNQ", pointValue: 2 },
  { name: "NQ", pointValue: 20 },
];

const SETUPS = ["Failed Breakdown", "Flag", "Trendline", "Other"] as const;

/* ──────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────── */

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")}${ampm}`;
}

// Realized + unrealized P&L for a single trade.
// stored `pnl` already includes any partial 75% exit. For an open runner
// we add an unrealized 25% leg using the current ES price.
// For a fully open trade (no exits), we show full unrealized P&L.
function liveTradePnL(t: Trade, currentPrice: number): { total: number; hasUnrealized: boolean } {
  let pnl = t.pnl ?? 0;
  let hasUnrealized = false;

  if (t.exit_75_price && !t.exit_runner_price && currentPrice > 0) {
    // Open runner
    const sign = t.direction === "long" ? 1 : -1;
    pnl +=
      (currentPrice - t.entry_price) *
      sign *
      t.contracts *
      0.25 *
      t.point_value;
    hasUnrealized = true;
  } else if (!t.exit_75_price && !t.exit_runner_price && currentPrice > 0) {
    // Fully open trade
    const sign = t.direction === "long" ? 1 : -1;
    pnl =
      (currentPrice - t.entry_price) *
      sign *
      t.contracts *
      t.point_value;
    hasUnrealized = true;
  }

  return { total: pnl, hasUnrealized };
}

/* ──────────────────────────────────────────────
   Bottom trade bar
   ────────────────────────────────────────────── */

interface TradeBarProps {
  trades: Trade[];
  currentPrice: number;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function TradeBar({
  trades,
  currentPrice,
  onNew,
  onEdit,
  onDelete,
}: TradeBarProps) {
  return (
    <div className="tb">
      <div className="tb-h">
        <div className="tb-t">Today&apos;s Trades ({trades.length})</div>
        <div className="bg2">
          <button className="btn b-p" onClick={onNew}>
            + New Trade
          </button>
        </div>
      </div>

      <div className="th tc2">
        <div>Time</div>
        <div>Side</div>
        <div>Entry</div>
        <div>75% Exit</div>
        <div>Runner</div>
        <div>Qty</div>
        <div>Setup</div>
        <div>P&amp;L</div>
        <div />
      </div>

      {trades.length === 0 ? (
        <div className="nt">
          No trades yet — click <strong>+ New Trade</strong>
        </div>
      ) : (
        trades.map((tr) => {
          const { total: pnl, hasUnrealized } = liveTradePnL(tr, currentPrice);
          const showPnl = tr.exit_75_price !== null || tr.exit_runner_price !== null || hasUnrealized;
          const pnlText = showPnl
            ? pnl >= 0
              ? `+$${Math.round(pnl).toLocaleString()}`
              : `-$${Math.abs(Math.round(pnl)).toLocaleString()}`
            : "—";

          return (
            <div key={tr.id} className="tr tc2">
              <div className="mv">{formatTime(tr.created_at)}</div>
              <div className={tr.direction === "long" ? "sl2" : "ss"}>
                {tr.direction === "long" ? "LONG" : "SHORT"}
              </div>
              <div className="mv">{tr.entry_price}</div>
              <div className="mv">{tr.exit_75_price ?? "—"}</div>
              <div>
                {tr.exit_runner_price ? (
                  <span className="mv">{tr.exit_runner_price}</span>
                ) : tr.exit_75_price ? (
                  <span className="rp2">running</span>
                ) : (
                  <span className="mv">—</span>
                )}
              </div>
              <div className="mv">{tr.contracts}</div>
              <div>
                <span className="sp">{tr.setup_type ?? "FB"}</span>
              </div>
              <div className={pnl >= 0 ? "pg" : "pr"}>
                {showPnl ? (
                  <span className={hasUnrealized ? "pnl-unreal" : ""}>
                    {pnlText}
                  </span>
                ) : (
                  <span style={{ color: "var(--t4)" }}>—</span>
                )}
              </div>
              <div>
                <button className="dx" onClick={() => onEdit(tr.id)} title="Update exits">
                  ✎
                </button>
                <button className="dx" onClick={() => onDelete(tr.id)} title="Delete">
                  ✕
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Trade Log tab — summary stats
   ────────────────────────────────────────────── */

export function TradeStats({
  trades,
  currentPrice,
}: {
  trades: Trade[];
  currentPrice: number;
}) {
  let total = 0;
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    const { total: pnl } = liveTradePnL(t, currentPrice);
    total += pnl;
    if (t.exit_75_price !== null || t.exit_runner_price !== null) {
      if (pnl >= 0) wins++;
      else losses++;
    }
  }
  const wr = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null;

  return (
    <div className="tldr-stat-row">
      <div className="tldr-stat">
        <div className="tldr-stat-label">Total P&amp;L</div>
        <div
          className="tldr-stat-val"
          style={{
            color:
              total > 0
                ? "var(--bull)"
                : total < 0
                ? "var(--bear)"
                : "var(--t3)",
          }}
        >
          {total >= 0 ? "+" : "-"}${Math.abs(Math.round(total)).toLocaleString()}
        </div>
        <div className="tldr-stat-sub">
          {trades.length} trade{trades.length !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="tldr-stat">
        <div className="tldr-stat-label">Wins / Losses</div>
        <div className="tldr-stat-val" style={{ color: "var(--t1)" }}>
          {wins} / {losses}
        </div>
        <div className="tldr-stat-sub">closed positions</div>
      </div>
      <div className="tldr-stat">
        <div className="tldr-stat-label">Win Rate</div>
        <div className="tldr-stat-val" style={{ color: "var(--gold)" }}>
          {wr === null ? "—" : `${wr}%`}
        </div>
        <div className="tldr-stat-sub">
          {wins + losses === 0 ? "no closed trades" : `${wins + losses} closed`}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   New trade modal
   ────────────────────────────────────────────── */

interface NewTradeProps {
  sessionDate: string;
  onClose: () => void;
  onCreated: (t: Trade) => void;
}

export function NewTradeModal({ sessionDate, onClose, onCreated }: NewTradeProps) {
  const [symbol, setSymbol] = useState("ES");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState("");
  const [contracts, setContracts] = useState("1");
  const [exit75, setExit75] = useState("");
  const [exitRunner, setExitRunner] = useState("");
  const [setup, setSetup] = useState<string>("Failed Breakdown");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  // F10: stable key generated once per modal open so a fast double-click,
  // a network retry, or a click that fires before saving=true settles
  // can't produce two rows. Server dedupes on (user_id, idempotency_key).
  const idempotencyKeyRef = useRef<string>("");
  if (!idempotencyKeyRef.current) {
    idempotencyKeyRef.current = crypto.randomUUID();
  }
  // Belt-and-braces: also block a second handleSave call before React
  // re-renders the disabled button.
  const inFlightRef = useRef(false);

  async function handleSave() {
    if (inFlightRef.current) return;
    const e = parseFloat(entry);
    if (!e) {
      setErr(true);
      return;
    }
    inFlightRef.current = true;
    setSaving(true);
    const pointValue = SYMBOLS.find((s) => s.name === symbol)?.pointValue || 50;
    const e75 = exit75 ? parseFloat(exit75) : null;
    const er = exitRunner ? parseFloat(exitRunner) : null;
    const trade = {
      session_date: sessionDate,
      symbol,
      direction,
      entry_price: e,
      contracts: parseInt(contracts) || 1,
      setup_type: setup,
      point_value: pointValue,
      exit_75_price: e75,
      exit_runner_price: er,
      pnl:
        e75 !== null || er !== null
          ? calculatePnL(direction, e, e75, er, parseInt(contracts) || 1, pointValue)
          : null,
      idempotency_key: idempotencyKeyRef.current,
    };

    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trade),
      });
      if (res.ok) {
        const saved = await res.json();
        onCreated(saved);
        onClose();
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>Log a Trade</h2>
      <div className="r2">
        <div>
          <label>Symbol</label>
          <select value={symbol} onChange={(ev) => setSymbol(ev.target.value)}>
            {SYMBOLS.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} — ${s.pointValue}/pt
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Side</label>
          <select
            value={direction}
            onChange={(ev) => setDirection(ev.target.value as "long" | "short")}
          >
            <option value="long">LONG</option>
            <option value="short">SHORT</option>
          </select>
        </div>
      </div>

      <div className="r2">
        <div>
          <label>Entry Price</label>
          <input
            type="number"
            value={entry}
            onChange={(ev) => {
              setEntry(ev.target.value);
              setErr(false);
            }}
            placeholder="e.g. 7120"
            style={err ? { borderColor: "var(--bear)" } : undefined}
          />
        </div>
        <div>
          <label>Contracts</label>
          <input
            type="number"
            value={contracts}
            onChange={(ev) => setContracts(ev.target.value)}
            min={1}
          />
        </div>
      </div>

      <div className="r2">
        <div>
          <label>75% Exit (optional)</label>
          <input
            type="number"
            value={exit75}
            onChange={(ev) => setExit75(ev.target.value)}
          />
        </div>
        <div>
          <label>Runner Exit (optional)</label>
          <input
            type="number"
            value={exitRunner}
            onChange={(ev) => setExitRunner(ev.target.value)}
          />
        </div>
      </div>

      <label>Setup</label>
      <select value={setup} onChange={(ev) => setSetup(ev.target.value)}>
        {SETUPS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div className="ac">
        <button className="btn b-d" onClick={onClose}>
          Cancel
        </button>
        <button className="btn b-s" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Trade"}
        </button>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────
   Edit (exit) modal
   ────────────────────────────────────────────── */

interface EditTradeProps {
  trade: Trade;
  onClose: () => void;
  onUpdated: (t: Trade) => void;
}

export function EditTradeModal({ trade, onClose, onUpdated }: EditTradeProps) {
  const [exit75, setExit75] = useState(
    trade.exit_75_price !== null ? String(trade.exit_75_price) : ""
  );
  const [exitRunner, setExitRunner] = useState(
    trade.exit_runner_price !== null ? String(trade.exit_runner_price) : ""
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const e75 = exit75 ? parseFloat(exit75) : null;
    const er = exitRunner ? parseFloat(exitRunner) : null;
    const pnl =
      e75 !== null || er !== null
        ? calculatePnL(
            trade.direction,
            trade.entry_price,
            e75,
            er,
            trade.contracts,
            trade.point_value
          )
        : null;

    const update: Record<string, unknown> = { pnl };
    update.exit_75_price = e75;
    update.exit_runner_price = er;

    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdated(updated);
        onClose();
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>Update Trade</h2>
      <div className="r2">
        <div>
          <label>75% Exit Price</label>
          <input
            type="number"
            value={exit75}
            onChange={(ev) => setExit75(ev.target.value)}
          />
        </div>
        <div>
          <label>Runner Exit Price</label>
          <input
            type="number"
            value={exitRunner}
            onChange={(ev) => setExitRunner(ev.target.value)}
          />
        </div>
      </div>

      <div className="ac">
        <button className="btn b-d" onClick={onClose}>
          Cancel
        </button>
        <button className="btn b-s" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Update"}
        </button>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────
   Modal shell
   ────────────────────────────────────────────── */

function Modal({
  children,
  onClose,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="mo" onClick={onClose}>
      <div className={`md${wide ? " w" : ""}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export { Modal };
