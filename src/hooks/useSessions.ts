"use client";

import { useCallback, useEffect, useState } from "react";
import { Session } from "@/lib/types";

export interface SessionsState {
  sessions: Session[];
  sessionDate: string;
  setSessionDate: (date: string) => void;
  navigate: (direction: -1 | 1) => void;
  canGoNewer: boolean;
  canGoOlder: boolean;
  refreshSessions: () => Promise<void>;
}

export function useSessions(): SessionsState {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionDate, setSessionDate] = useState<string>("");

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data: Session[] = res.ok ? await res.json() : [];
      setSessions(data);
      // Only set initial sessionDate if not already set
      if (data.length > 0) {
        setSessionDate((curr) => curr || data[0].session_date);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const idx = sessions.findIndex((s) => s.session_date === sessionDate);
  const canGoNewer = idx > 0;
  const canGoOlder = idx < sessions.length - 1 && idx >= 0;

  function navigate(direction: -1 | 1) {
    const newIdx = idx - direction;
    if (newIdx >= 0 && newIdx < sessions.length) {
      setSessionDate(sessions[newIdx].session_date);
    }
  }

  return {
    sessions,
    sessionDate,
    setSessionDate,
    navigate,
    canGoNewer,
    canGoOlder,
    refreshSessions,
  };
}
