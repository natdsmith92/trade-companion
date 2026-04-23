"use client";

import { useState } from "react";
import { parseLevels } from "@/lib/parser";
import { ParsedPlan } from "@/lib/types";

interface Props {
  onSubmit: (text: string) => void;
  onClose: () => void;
}

export default function PasteModal({ onSubmit, onClose }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ParsedPlan | null>(null);

  function doPreview() {
    if (!text.trim()) return;
    setPreview(parseLevels(text));
  }

  function doApply() {
    if (!text.trim()) return;
    onSubmit(text.trim());
  }

  return (
    <div className="mo" onClick={onClose}>
      <div className="md w" onClick={(e) => e.stopPropagation()}>
        <h2>Paste Mancini Email</h2>
        <label>Paste the full email text below</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Copy Adam's email and paste here..."
          autoFocus
        />

        {preview && (
          <div className="pv">
            Found <b>{preview.supports.length}</b> supports (
            <b>{preview.supports.filter((s) => s.major).length}</b> major) ·{" "}
            <b>{preview.resistances.length}</b> resistances (
            <b>{preview.resistances.filter((r) => r.major).length}</b> major)
            {preview.sessionDate && (
              <>
                <br />
                Plan for: <b>{preview.sessionDate}</b>
              </>
            )}
            {preview.lean && (
              <>
                <br />
                Lean: {preview.lean}
              </>
            )}
          </div>
        )}

        <div className="ac">
          <button className="btn b-d" onClick={onClose}>
            Cancel
          </button>
          <button className="btn b-w" onClick={doPreview} disabled={!text.trim()}>
            Preview
          </button>
          <button className="btn b-s" onClick={doApply} disabled={!text.trim()}>
            Apply to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
