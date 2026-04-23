"use client";

import { ParsedPlan } from "@/lib/types";

interface Props {
  parsed: ParsedPlan | null;
  currentPrice: number;
}

export default function TldrTab({ parsed, currentPrice }: Props) {
  if (!parsed) {
    return (
      <div className="empty-card">
        Paste a Mancini email to generate a TL;DR for the day.
      </div>
    );
  }

  const majorSupports = parsed.supports.filter((s) => s.major);
  const majorResistances = parsed.resistances.filter((r) => r.major);
  const totalLevels = parsed.supports.length + parsed.resistances.length;

  // Closest major level above and below current price.
  const nearestSupport = currentPrice > 0
    ? majorSupports
        .filter((s) => s.price <= currentPrice)
        .sort((a, b) => b.price - a.price)[0]
    : majorSupports[0];

  const nearestResistance = currentPrice > 0
    ? majorResistances
        .filter((r) => r.price >= currentPrice)
        .sort((a, b) => a.price - b.price)[0]
    : majorResistances[majorResistances.length - 1];

  return (
    <div>
      <div className="tldr-stat-row">
        <div className="tldr-stat">
          <div className="tldr-stat-label">Levels Loaded</div>
          <div className="tldr-stat-val" style={{ color: "var(--gold)" }}>
            {totalLevels}
          </div>
          <div className="tldr-stat-sub">
            {parsed.supports.length} S · {parsed.resistances.length} R
          </div>
        </div>
        <div className="tldr-stat">
          <div className="tldr-stat-label">Major Supports</div>
          <div className="tldr-stat-val" style={{ color: "var(--bull)" }}>
            {majorSupports.length}
          </div>
          <div className="tldr-stat-sub">starred levels</div>
        </div>
        <div className="tldr-stat">
          <div className="tldr-stat-label">Major Resistances</div>
          <div className="tldr-stat-val" style={{ color: "var(--bear)" }}>
            {majorResistances.length}
          </div>
          <div className="tldr-stat-sub">starred levels</div>
        </div>
      </div>

      {parsed.lean && (
        <div className="tldr-section">
          <div className="tldr-section-title" style={{ color: "var(--gold)" }}>
            DIRECTIONAL LEAN
          </div>
          <div className="tldr-insight">
            <div className="tldr-tag context">Context</div>
            <div className="tldr-insight-text">{withNumberHighlight(parsed.lean)}</div>
          </div>
        </div>
      )}

      {(nearestSupport || nearestResistance) && (
        <div className="tldr-section">
          <div className="tldr-section-title" style={{ color: "var(--blue)" }}>
            🎯 KEY LEVELS RIGHT NOW
          </div>
          {nearestResistance && (
            <div className="tldr-insight">
              <div className="tldr-tag caution">Resistance</div>
              <div className="tldr-insight-text">
                Nearest major resistance overhead is{" "}
                <span className="num">{nearestResistance.price}</span>
                {currentPrice > 0 && (
                  <>
                    {" "}— <strong>{Math.abs(nearestResistance.price - currentPrice)} pts</strong> away.
                  </>
                )}
              </div>
            </div>
          )}
          {nearestSupport && (
            <div className="tldr-insight">
              <div className="tldr-tag opportunity">Support</div>
              <div className="tldr-insight-text">
                Nearest major support below is{" "}
                <span className="num">{nearestSupport.price}</span>
                {currentPrice > 0 && (
                  <>
                    {" "}— <strong>{Math.abs(currentPrice - nearestSupport.price)} pts</strong> away.
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {parsed.bullTargets.length > 0 && (
        <div className="tldr-section">
          <div className="tldr-section-title" style={{ color: "var(--bull)" }}>
            ★ BULL PATH
          </div>
          <div className="tldr-insight">
            <div className="tldr-tag opportunity">Upside</div>
            <div className="tldr-insight-text">
              Targets:{" "}
              {parsed.bullTargets.map((t, i) => (
                <span key={t}>
                  <span className="num">{t}</span>
                  {i < parsed.bullTargets.length - 1 && " → "}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {parsed.bearTargets.length > 0 && (
        <div className="tldr-section">
          <div className="tldr-section-title" style={{ color: "var(--bear)" }}>
            ⚠ BEAR PATH
          </div>
          <div className="tldr-insight">
            <div className="tldr-tag caution">Downside</div>
            <div className="tldr-insight-text">
              Targets:{" "}
              {parsed.bearTargets.map((t, i) => (
                <span key={t}>
                  <span className="num">{t}</span>
                  {i < parsed.bearTargets.length - 1 && " → "}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {parsed.triggers.length > 0 && (
        <div className="tldr-section">
          <div className="tldr-section-title" style={{ color: "var(--gold)" }}>
            📐 TRIGGERS TO WATCH
          </div>
          {parsed.triggers.slice(0, 4).map((t, i) => (
            <div key={i} className="tldr-insight">
              <div className="tldr-tag key">Setup</div>
              <div className="tldr-insight-text">{withNumberHighlight(t)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function withNumberHighlight(text: string) {
  const parts = text.split(/(\b\d{4,5}\b)/g);
  return parts.map((part, i) =>
    /^\d{4,5}$/.test(part) ? (
      <span key={i} className="num">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
