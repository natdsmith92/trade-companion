"use client";

import { useState } from "react";

interface Props {
  onSubmit: (text: string) => void;
  onClose: () => void;
}

export default function PasteModal({ onSubmit, onClose }: Props) {
  const [text, setText] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.7)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl p-6"
        style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <div className="text-xs font-extrabold uppercase tracking-[3px]" style={{ color: "var(--gold)" }}>
            Paste Mancini Email
          </div>
          <button
            onClick={onClose}
            className="text-lg px-2 rounded hover:opacity-70"
            style={{ color: "var(--text-4)" }}
          >
            ✕
          </button>
        </div>

        <p className="text-sm mb-3" style={{ color: "var(--text-3)" }}>
          Paste the full text from today&apos;s Trade Companion email. The parser will extract
          supports, resistances, scenarios, and triggers.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Paste email text here...\n\nExample:\nSupports are: 6685 (major), 6676, 6663 (major)...\nResistances are: 6700 (major), 6716 (major)...'}
          rows={14}
          className="w-full rounded-lg p-4 text-sm outline-none resize-none"
          style={{
            background: "var(--bg-3)",
            border: "1px solid var(--border)",
            color: "var(--text-1)",
            fontFamily: "var(--m, monospace)",
          }}
          autoFocus
        />

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold rounded-lg border-2"
            style={{ borderColor: "var(--border)", color: "var(--text-3)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => text.trim() && onSubmit(text.trim())}
            disabled={!text.trim()}
            className="px-5 py-2 text-xs font-bold rounded-lg border-2 transition-all"
            style={{
              borderColor: text.trim() ? "var(--blue)" : "var(--border)",
              color: text.trim() ? "var(--blue)" : "var(--text-4)",
              opacity: text.trim() ? 1 : 0.5,
            }}
          >
            Parse & Load
          </button>
        </div>
      </div>
    </div>
  );
}
