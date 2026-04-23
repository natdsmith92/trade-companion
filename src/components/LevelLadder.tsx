"use client";

import { useEffect, useRef } from "react";
import { Level } from "@/lib/types";

interface Props {
  supports: Level[];
  resistances: Level[];
  currentPrice: number;
  onPaste: () => void;
}

export default function LevelLadder({ supports, resistances, currentPrice, onPaste }: Props) {
  const priceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Center the price bar after each render so the price stays visible.
  useEffect(() => {
    if (!priceRef.current || !scrollRef.current) return;
    priceRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [supports, resistances, currentPrice]);

  const allLevels = [
    ...supports.map((l) => ({ ...l, t: "S" as const })),
    ...resistances.map((l) => ({ ...l, t: "R" as const })),
  ].sort((a, b) => b.price - a.price);

  // Above current price: show closest 22 (closest to price first when sorted ascending).
  const above = currentPrice > 0
    ? allLevels.filter((l) => l.price > currentPrice).slice(-22)
    : allLevels.slice(0, Math.floor(allLevels.length / 2));

  const below = currentPrice > 0
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
              <Row key={`a-${l.price}-${l.t}-${i}`} level={l} />
            ))}

            <div className="pbw" ref={priceRef}>
              {currentPrice > 0 ? (
                <div className="pb">ES&nbsp;&nbsp;{currentPrice}</div>
              ) : (
                <div className="pb empty">Enter ES price ↑</div>
              )}
            </div>

            {below.map((l, i) => (
              <Row key={`b-${l.price}-${l.t}-${i}`} level={l} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function Row({ level }: { level: Level & { t: "S" | "R" } }) {
  const { major, t, price } = level;
  const cls = ["lr", major ? "mj" : ""].filter(Boolean).join(" ");

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
