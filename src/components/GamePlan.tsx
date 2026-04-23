"use client";

interface Props {
  bullTargets: number[];
  bearTargets: number[];
  triggers: string[];
  currentPrice: number;
}

export default function GamePlan({ bullTargets, bearTargets, triggers, currentPrice }: Props) {
  if (bullTargets.length === 0 && bearTargets.length === 0 && triggers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ color: "var(--text-4)" }}>
          <div className="text-6xl mb-4">📝</div>
          <div className="text-lg font-semibold mb-2">No game plan loaded</div>
          <div className="text-sm">Paste today&apos;s email to populate bull/bear scenarios</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Bull / Bear columns */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        {/* Bull Case */}
        <div className="rounded-xl p-5" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 rounded-full" style={{ background: "var(--bull)" }} />
            <div className="text-xs font-extrabold uppercase tracking-[3px]" style={{ color: "var(--bull)" }}>
              Bull Path
            </div>
          </div>
          <div className="space-y-0">
            {bullTargets.map((target, i) => {
              const hit = currentPrice > 0 && currentPrice >= target;
              return (
                <div key={target} className="flex items-center gap-3 py-2 border-b" style={{ borderColor: "var(--border)", opacity: hit ? 0.3 : 1 }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--bull)" }} />
                  <span className="mono text-lg font-bold" style={{ color: "var(--bull)" }}>{target}</span>
                  {i < bullTargets.length - 1 && (
                    <span className="text-xs" style={{ color: "var(--text-4)" }}>→</span>
                  )}
                </div>
              );
            })}
            {bullTargets.length === 0 && (
              <div className="text-sm py-2" style={{ color: "var(--text-4)" }}>No bull targets parsed</div>
            )}
          </div>
        </div>

        {/* Bear Case */}
        <div className="rounded-xl p-5" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 rounded-full" style={{ background: "var(--bear)" }} />
            <div className="text-xs font-extrabold uppercase tracking-[3px]" style={{ color: "var(--bear)" }}>
              Bear Path
            </div>
          </div>
          <div className="space-y-0">
            {bearTargets.map((target, i) => {
              const hit = currentPrice > 0 && currentPrice <= target;
              return (
                <div key={target} className="flex items-center gap-3 py-2 border-b" style={{ borderColor: "var(--border)", opacity: hit ? 0.3 : 1 }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--bear)" }} />
                  <span className="mono text-lg font-bold" style={{ color: "var(--bear)" }}>{target}</span>
                  {i < bearTargets.length - 1 && (
                    <span className="text-xs" style={{ color: "var(--text-4)" }}>→</span>
                  )}
                </div>
              );
            })}
            {bearTargets.length === 0 && (
              <div className="text-sm py-2" style={{ color: "var(--text-4)" }}>No bear targets parsed</div>
            )}
          </div>
        </div>
      </div>

      {/* Triggers */}
      {triggers.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 rounded-full" style={{ background: "var(--gold)" }} />
            <div className="text-xs font-extrabold uppercase tracking-[3px]" style={{ color: "var(--gold)" }}>
              Key Triggers
            </div>
          </div>
          <div className="space-y-2">
            {triggers.map((trigger, i) => (
              <div
                key={i}
                className="text-[15px] leading-relaxed py-2 border-b"
                style={{ borderColor: "var(--border)", color: "var(--text-1)" }}
              >
                {highlightNumbers(trigger)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Highlight 4-5 digit numbers in trigger text with gold color
function highlightNumbers(text: string) {
  const parts = text.split(/(\b\d{4,5}\b)/g);
  return parts.map((part, i) =>
    /^\d{4,5}$/.test(part) ? (
      <span key={i} className="mono font-bold" style={{ color: "var(--gold)" }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
