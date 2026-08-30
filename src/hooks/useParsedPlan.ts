"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseLevels } from "@/lib/parser";
import { ParsedPlan } from "@/lib/types";

export interface ParsedPlanState {
  parsed: ParsedPlan | null;
  headline: string;
  ingestPaste: (text: string) => void;
}

interface UseParsedPlanArgs {
  sessionDate: string;
  onSessionChanged: (newDate: string) => void;
  onAfterIngest: () => Promise<void> | void;
}

export function useParsedPlan({
  sessionDate,
  onSessionChanged,
  onAfterIngest,
}: UseParsedPlanArgs): ParsedPlanState {
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
  const [headline, setHeadline] = useState<string>("");

  // When paste sets parsed locally and bumps sessionDate, we don't want the
  // useEffect-driven /api/latest-plan fetch to overwrite it with null
  // (the row hasn't been inserted yet — that's a race the user sees as
  // "screen clears, paste again"). Mark which date was just pasted; skip
  // the next fetch only for that date.
  const justPastedDateRef = useRef<string | null>(null);

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
    if (!sessionDate) return;
    if (justPastedDateRef.current === sessionDate) {
      // We already have the parsed plan locally from ingestPaste.
      // Clear the marker so genuine future navigation back to this date
      // (after the row is in the DB) does fetch.
      justPastedDateRef.current = null;
      return;
    }
    loadForDate(sessionDate);
  }, [sessionDate, loadForDate]);

  function ingestPaste(text: string) {
    const result = parseLevels(text);
    setParsed(result);
    // Tell the effect to skip the upcoming fetch for this date.
    justPastedDateRef.current = result.sessionDate;
    onSessionChanged(result.sessionDate);

    // user_id derived server-side from the session cookie (F2).
    fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: new Date().toISOString(),
        subject: "Manual Paste",
        body: text,
      }),
    })
      .then((r) => r.json())
      .then(async (data) => {
        if (data.session_date) {
          // Server's parsed session_date takes precedence; refresh sessions list.
          if (data.session_date !== result.sessionDate) {
            justPastedDateRef.current = data.session_date;
            onSessionChanged(data.session_date);
          }
          await onAfterIngest();
          // Pull the freshly-stored TL;DR headline once the row exists.
          // Server-side generateTldr is fire-and-forget, so the headline may
          // not be ready immediately. Retry briefly.
          pollTldr(data.session_date);
        }
      })
      .catch(() => {});
  }

  // generateTldr runs async on the server after ingest; poll briefly for the
  // headline so the header populates without a manual refresh.
  function pollTldr(date: string, attempt = 0) {
    if (attempt > 6) return; // ~30s total at 5s spacing
    setTimeout(() => {
      fetch(`/api/tldr?date=${date}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.headline) {
            setHeadline(data.headline);
          } else {
            pollTldr(date, attempt + 1);
          }
        })
        .catch(() => pollTldr(date, attempt + 1));
    }, 5000);
  }

  return { parsed, headline, ingestPaste };
}
