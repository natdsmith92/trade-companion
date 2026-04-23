"use client";

import { useEffect, useRef, useMemo } from "react";
import { Level } from "@/lib/types";

interface Props {
  supports: Level[];
  resistances: Level[];
  currentPrice: number;
  priceSource: "live" | "manual" | "none";
  onPaste: () => void;
}

export default function LevelLadder({
  supports,
  resistances,
  currentPrice,
  priceSource,
  onPaste,
}: Props) {
  const priceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allLevels = useMemo(() => {
    return [
      ...supports.map((l) => ({ ...l, t: "S" as const })),
      ...resistances.map((l) => ({ ...l, t: "R" as const })),
    ].sort((a, b) => b.price - a.price);
  }, [supports, resistances]);

  // Find the nearest level to current price for highlighting
  const nearestPrice = useMemo(() => {
    if (currentPrice <= 0 || allLevels.length === 0) return null;
    let closest = allLevels[0].price;
    let minDist = Math.abs(allLevels[0].price - currentPrice);
    for (const l of allLevels) {
      const dist = Math.abs(l.price - currentPrice);
      if (dist < minDist) {
        minDist = dist;
        closest = l.price;
      }
    }
    return closest;
  }, [allLevels, currentPrice]);

  // Auto-scroll to keep price zone visible
  useEffect(() => {
    if (!priceRef.current || !scrollRef.current) return;
    priceRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [supports, resistances, currentPrice]);

  // Above current price: show closest 22
  const above =
    currentPrice > 0
      ? allLevels.filter((l) => l.price > currentPrice).slice(-22)
      : allLevels.slice(0, Math.floor(allLevels.length / 2));

  const below =
    currentPrice > 0
      ? allLevels.filter((l) => l.price <= currentPrice).slice(0, 35)
      : allLevels.slice(Math.floor(allLevels.length / 2));

  const empty = supports.length === 0 && resistances.length === 0;

  return (
    <aside className="lw">
      <div className="lb">
        <div className="lb-t">Price Ladder</div>
        <button className="btn b-w b-sm" onClick={onPaste}>
          📋 Paste Email
        </button>
      </div>

      <div className="ls" ref={scrollRef}>
        {empty ? (
          <div className="lad-empty">
            No levels loaded.
            <br />
            Paste a Mancini email to populate.
          </div>
        ) : (
          <>
            {above.map((l, i) => (
              <Row
                key={`a-${l.price}-${l.t}-${i}`}
                level={l}
                isNearest={l.price === nearestPrice}
              />
            ))}

            <div className="pbw" ref={priceRef}>
              {currentPrice > 0 ? (
                <div className={`pb${priceSource === "live" ? " pulse" : ""}`}>
                  ES&nbsp;&nbsp;{currentPrice}
                  {priceSource === "live" && (
                    <span className="pb-live-dot" />
                  )}
                </div>
              ) : (
                <div className="pb empty">Enter ES price ↑</div>
              )}
            </div>

            {below.map((l, i) => (
              <Row
                key={`b-${l.price}-${l.t}-${i}`}
                level={l}
                isNearest={l.price === nearestPrice}
              />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function Row({
  level,
  isNearest,
}: {
  level: Level & { t: "S" | "R" };
  isNearest: boolean;
}) {
  const { major, t, price } = level;
  const cls = [
    "lr",
    major ? "mj" : "",
    isNearest ? "bd" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      {t === "S" ? (
        <div className={`st${major ? "" : " d"}`}>{major ? "S ★" : "S"}</div>
      ) : (
        <div className="st" />
      )}
      <div className="lv">{price}</div>
      {t === "R" ? (
        <div className={`rt${major ? "" : " d"}`}>{major ? "R ★" : "R"}</div>
      ) : (
        <div className="rt" />
      )}
    </div>
  );
}
