"use client";

import { Level } from "@/lib/types";

interface Props {
  supports: Level[];
  resistances: Level[];
  currentPrice: number;
}

export default function LevelLadder({ supports, resistances, currentPrice }: Props) {
  if (supports.length === 0 && resistances.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ color: "var(--text-4)" }}>
          <div className="text-6xl mb-4">📋</div>
          <div className="text-lg font-semibold mb-2">No levels loaded</div>
          <div className="text-sm">Click "Paste Email" to load today&apos;s plan</div>
        </div>
      </div>
    );
  }

  // Combine and sort all levels descending (highest at top)
  const allLevels = [...supports, ...resistances].sort((a, b) => b.price - a.price);

  // Find closest level to current price for highlighting
  const closestPrice = currentPrice > 0
    ? allLevels.reduce((prev, curr) =>
        Math.abs(curr.price - currentPrice) < Math.abs(prev.price - currentPrice) ? curr : prev
      ).price
    : 0;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Current price bar */}
      {currentPrice > 0 && (
        <div
          className="rounded-lg p-3 text-center mb-4 mono text-2xl font-extrabold tracking-[2px]"
          style={{
            background: "linear-gradient(135deg, #2563eb, #3b82f6)",
            color: "#fff",
            boxShadow: "0 0 20px rgba(96,165,250,.15)",
          }}
        >
          {currentPrice.toFixed(2)}
        </div>
      )}

      {/* Level ladder */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-1)", border: "1px solid var(--border)" }}>
        {allLevels.map((level, i) => {
          const isSupport = level.type === "support";
          const isNearPrice = currentPrice > 0 && Math.abs(level.price - currentPrice) < 3;

          return (
            <div
              key={`${level.price}-${level.type}-${i}`}
              className="grid items-center min-h-[42px] px-4 transition-colors"
              style={{
                gridTemplateColumns: "60px 1fr 60px",
                borderLeft: isNearPrice ? "4px solid var(--blue)" : "4px solid transparent",
                background: level.major
                  ? "var(--gold-bg)"
                  : isNearPrice
                  ? "var(--blue-bg)"
                  : "transparent",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {/* Support indicator */}
              <div
                className="text-sm font-semibold"
                style={{
                  color: isSupport
                    ? level.major ? "var(--bull)" : "var(--bull-dim)"
                    : "transparent",
                }}
              >
                {isSupport ? "S" : ""}
              </div>

              {/* Price */}
              <div
                className="mono text-center py-1"
                style={{
                  fontSize: level.major ? "21px" : "17px",
                  fontWeight: level.major ? 800 : 500,
                  color: level.major ? "var(--gold)" : "var(--text-2)",
                }}
              >
                {level.price}
              </div>

              {/* Resistance indicator */}
              <div
                className="text-sm font-semibold text-right"
                style={{
                  color: !isSupport
                    ? level.major ? "var(--bear)" : "var(--bear-dim)"
                    : "transparent",
                }}
              >
                {!isSupport ? "R" : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-[2px] mb-1" style={{ color: "var(--text-3)" }}>Supports</div>
          <div className="mono text-xl font-extrabold" style={{ color: "var(--bull)" }}>{supports.length}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-4)" }}>{supports.filter(s => s.major).length} major</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-[2px] mb-1" style={{ color: "var(--text-3)" }}>Resistances</div>
          <div className="mono text-xl font-extrabold" style={{ color: "var(--bear)" }}>{resistances.length}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-4)" }}>{resistances.filter(r => r.major).length} major</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
          <div className="text-[10px] uppercase tracking-[2px] mb-1" style={{ color: "var(--text-3)" }}>Total</div>
          <div className="mono text-xl font-extrabold">{allLevels.length}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-4)" }}>levels</div>
        </div>
      </div>
    </div>
  );
}
