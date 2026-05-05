"use client";

import { useCallback, useEffect, useState } from "react";
import { parseLevels } from "@/lib/parser";
import { ParsedPlan } from "@/lib/types";

export interface ParsedPlanState {
  parsed: ParsedPlan | null;
  headline: string;
  ingestPaste: (text: string) => void;
}

interface UseParsedPlanArgs {
  sessionDate: string;
  userId: string;
  onSessionChanged: (newDate: string) => void;
  onAfterIngest: () => Promise<void> | void;
}

export function useParsedPlan({
  sessionDate,
  userId,
  onSessionChanged,
  onAfterIngest,
}: UseParsedPlanArgs): ParsedPlanState {
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [headline, setHeadline] = useState<string>("");

  const loadForDate = useCallback((date: string) => {
    if (!date) return;

    fetch(`/api/latest-plan?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.body) setParsed(parseLevels(data.body, data.subject));
        else setParsed(null);
      })
      .catch(() => setParsed(null));

    fetch(`/api/tldr?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setHeadline(data?.headline || "");
      })
      .catch(() => setHeadline(""));
  }, []);

  useEffect(() => {
    if (sessionDate) loadForDate(sessionDate);
  }, [sessionDate, loadForDate]);

  function ingestPaste(text: string) {
    const result = parseLevels(text);
    setParsed(result);
    onSessionChanged(result.sessionDate);

    fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: new Date().toISOString(),
        subject: "Manual Paste",
        body: text,
        user_id: userId,
      }),
    })
      .then((r) => r.json())
      .then(async (data) => {
        if (data.session_date) {
          onSessionChanged(data.session_date);
          await onAfterIngest();
        }
      })
      .catch(() => {});
  }

  return { parsed, headline, ingestPaste };
}
