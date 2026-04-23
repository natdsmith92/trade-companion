"use client";

import { useMemo, useState, useEffect } from "react";
import { Level } from "@/lib/types";
import { FbSetup } from "@/lib/tldr-types";

interface Props {
  bullTargets: number[];
  bearTargets: number[];
  triggers: string[];
  supports: Level[];
  currentPrice: number;
  sessionDate: string;
}

function extractPrices(text: string): number[] {
  const matches = text.match(/\b\d{4,5}\b/g);
  return matches ? matches.map(Number) : [];
}

function isTriggerActive(text: string, currentPrice: number, threshold = 15): boolean {
  if (currentPrice <= 0) return false;
  const prices = extractPrices(text);
  return prices.some((p) => Math.abs(p - currentPrice) <= threshold);
}

function isFbActive(level: number, currentPrice: number, threshold = 15): boolean {
  if (currentPrice <= 0) return false;
  return Math.abs(level - currentPrice) <= threshold;
}

const qualityColors: Record<string, string> = {
  "A+": "var(--bull)",
  "A": "var(--gold)",
  "B": "var(--text-3)",
  "Watch": "var(--bear)",
};

const qualityLabels: Record<string, string> = {
  "A+": "\u2605 A+ SETUP",
  "A": "\u2605 A SETUP",
  "B": "B SETUP",
  "Watch": "\uD83D\uDC41 WATCH",
};

export default function GamePlan({
  bullTargets, bearTargets, triggers, supports, currentPrice, sessionDate,
}: Props) {
  const [fbSetups, setFbSetups] = useState<FbSetup[] | null>(null);
  const [fbLoading, setFbLoading] = useState(false);

  useEffect(() => {
    if (!sessionDate || triggers.length === 0) return;
    setFbLoading(true);
    fetch(`/api/tldr?date=${sessionDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.fbSetups && Array.isArray(data.fbSetups) && data.fbSetups.length > 0) {
          setFbSetups(data.fbSetups);
        } else {
          setFbSetups(null);
        }
      })
      .catch(() => setFbSetups(null))
      .finally(() => setFbLoading(false));
  }, [sessionDate, triggers.length]);

  const empty =
    bullTargets.length === 0 && bearTargets.length === 0 &&
    triggers.length === 0 && supports.length === 0;

  const activeTriggers = useMemo(() => {
    if (currentPrice <= 0) return new Set<number>();
    return new Set(
      triggers.map((t, i) => (isTriggerActive(t, currentPrice) ? i : -1)).filter((i) => i >= 0)
    );
  }, [triggers, currentPrice]);

  if (empty) {
    return (
      <div className="empty-card">
        Paste a Mancini email to load today&apos;s game plan.
      </div>
    );
  }

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
              const isNext = !hit && currentPrice > 0 && i > 0 && currentPrice >= bullTargets[i - 1];
              const isLast = i === bullTargets.length - 1;
              return (
                <li key={target} className={`si${hit ? " hit" : ""}${isNext ? " next-target" : ""}`}>
                  <div className="bul" />
                  <div>
                    {i === 0 ? "Target " : "Then "}
                    <span className="p">{target}</span>
                    {!isLast && " \u2192"}
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
              const isNext = !hit && currentPrice > 0 && i > 0 && currentPrice <= bearTargets[i - 1];
              const isLast = i === bearTargets.length - 1;
              return (
                <li key={target} className={`si${hit ? " hit" : ""}${isNext ? " next-target" : ""}`}>
                  <div className="bul" />
                  <div>
                    {i === 0 ? "Down to " : "Then "}
                    <span className="p">{target}</span>
                    {!isLast && " \u2192"}
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
          {fbSetups && <span className="fb-ai-badge">AI</span>}
          {fbLoading && <span className="fb-loading">analyzing\u2026</span>}
        </div>
        {triggers.length === 0 ? (
          <div className="nt">No setups parsed from email</div>
        ) : fbSetups && fbSetups.length > 0 ? (
          <div className="fb-setups">
            {fbSetups.map((setup, i) => {
              const active = isFbActive(setup.level, currentPrice);
              return (
                <div key={i} className={`fb-card${active ? " ti-active" : ""}`}>
                  <div className="fb-header">
                    <span className="fb-level">{setup.level}</span>
                    <span className="fb-quality" style={{ color: qualityColors[setup.quality] || "var(--text-3)" }}>
                      {qualityLabels[setup.quality] || setup.quality}
                    </span>
                  </div>
                  <div className="fb-action" dangerouslySetInnerHTML={{ __html: setup.action }} />
                  <div className="fb-context" dangerouslySetInnerHTML={{ __html: setup.context }} />
                  {setup.invalidation && (
                    <div className="fb-invalidation">
                      &#x2715; <span dangerouslySetInnerHTML={{ __html: setup.invalidation }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          triggers.map((t, i) => (
            <div key={i} className={`ti${activeTriggers.has(i) ? " ti-active" : ""}`}>
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
      <span key={i} className="hl">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
