"use client";

import { Level } from "@/lib/types";

interface Props {
  bullTargets: number[];
  bearTargets: number[];
  triggers: string[];
  supports: Level[];
  currentPrice: number;
}

export default function GamePlan({
  bullTargets,
  bearTargets,
  triggers,
  supports,
  currentPrice,
}: Props) {
  const empty =
    bullTargets.length === 0 &&
    bearTargets.length === 0 &&
    triggers.length === 0 &&
    supports.length === 0;

  if (empty) {
    return (
      <div className="empty-card">
        Paste a Mancini email to load today&apos;s game plan.
      </div>
    );
  }

  // Bid shortlist: major supports below current price (or all if no price set).
  const bids = supports
    .filter((s) => s.major && (currentPrice === 0 || s.price <= currentPrice))
    .sort((a, b) => b.price - a.price)
    .slice(0, 6);

  return (
    <div className="gpg">
      {/* Bull case */}
      <div className="card c-bu">
        <div className="ch">
          <div className="dot" />
          BULL CASE
        </div>
        {bullTargets.length === 0 ? (
          <div className="nt">No bull targets parsed</div>
        ) : (
          <ul className="sl">
            {bullTargets.map((target, i) => {
              const hit = currentPrice > 0 && currentPrice >= target;
              const isLast = i === bullTargets.length - 1;
              return (
                <li key={target} className={`si${hit ? " hit" : ""}`}>
                  <div className="bul" />
                  <div>
                    {i === 0 ? "Target " : "Then "}
                    <span className="p">{target}</span>
                    {!isLast && " →"}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Bear case */}
      <div className="card c-be">
        <div className="ch">
          <div className="dot" />
          BEAR CASE
        </div>
        {bearTargets.length === 0 ? (
          <div className="nt">No bear targets parsed</div>
        ) : (
          <ul className="sl">
            {bearTargets.map((target, i) => {
              const hit = currentPrice > 0 && currentPrice <= target;
              const isLast = i === bearTargets.length - 1;
              return (
                <li key={target} className={`si${hit ? " hit" : ""}`}>
                  <div className="bul" />
                  <div>
                    {i === 0 ? "Down to " : "Then "}
                    <span className="p">{target}</span>
                    {!isLast && " →"}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Failed Breakdown / triggers */}
      <div className="card c-go gpf">
        <div className="ch">
          <div className="dot" />
          FAILED BREAKDOWN SETUPS
        </div>
        {triggers.length === 0 ? (
          <div className="nt">No setups parsed from email</div>
        ) : (
          triggers.map((t, i) => (
            <div key={i} className="ti">
              {highlightNumbers(t)}
            </div>
          ))
        )}
      </div>

      {/* Bid shortlist */}
      <div className="card c-bl gpf">
        <div className="ch">
          <div className="dot" />
          LEVELS I&apos;D BID
        </div>
        {bids.length === 0 ? (
          <div className="nt">No major supports below current price</div>
        ) : (
          <div className="bg">
            {bids.map((b) => (
              <div key={b.price} className="bc">
                <div className="bc-p">{b.price}</div>
                <div className="bc-n">Major support</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function highlightNumbers(text: string) {
  const parts = text.split(/(\b\d{4,5}\b)/g);
  return parts.map((part, i) =>
    /^\d{4,5}$/.test(part) ? (
      <span key={i} className="hl">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
