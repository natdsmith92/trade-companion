"use client";

import { useEffect, useState } from "react";

// The strip at the top of the dashboard that says what is going on with
// today's plan.
//
// This component exists because of a specific failure the design review
// caught: with only "plan" and "no plan" states, a 6am email that failed to
// parse looked identical to an email that had not arrived yet. The screen
// would keep promising "today's usually arrives by ~7:15" until the 8am
// watchdog fired — roughly two hours of the app actively misinforming someone
// who is about to trade. Whatever else changes here, the `failed` state must
// never be rendered as `waiting`.

export type SessionState = "waiting" | "failed" | "published";

interface SessionStatus {
  state: SessionState;
  date: string;
  marketClosed?: boolean;
  holidayName?: string | null;
  earlyClose?: boolean;
  inFlight?: boolean;
  previousSessionDate?: string | null;
  reason?: string | null;
  emailStatus?: string;
  receivedAt?: string;
  publishedAt?: string;
}

interface Props {
  sessionDate: string;
  onPaste: () => void;
  /** Bumped by the parent after a paste so the banner re-resolves. */
  refreshKey?: number;
}

function formatDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function timeOnly(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default function SessionBanner({ sessionDate, onPaste, refreshKey }: Props) {
  const [status, setStatus] = useState<SessionStatus | null>(null);

  useEffect(() => {
    if (!sessionDate) return;
    let cancelled = false;

    fetch(`/api/session-status?date=${sessionDate}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && !d.error) setStatus(d);
      })
      .catch(() => {
        // A status fetch failure must not blank the dashboard. Staying silent
        // is correct here: the ladder below still renders whatever it has.
        if (!cancelled) setStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionDate, refreshKey]);

  if (!status) return null;

  // Market closed outranks everything: a missing plan on Christmas is not a
  // problem, and showing an alarm would train the user to ignore alarms.
  if (status.marketClosed && status.state !== "published") {
    return (
      <div className="session-banner session-banner--closed">
        <strong>Market closed</strong>
        <span>
          {status.holidayName ? `${status.holidayName} — ` : ""}
          no plan expected today.
        </span>
      </div>
    );
  }

  if (status.state === "published") {
    return status.earlyClose ? (
      <div className="session-banner session-banner--info">
        <strong>Early close today</strong>
        <span>Shortened session — plan published{status.publishedAt ? ` at ${timeOnly(status.publishedAt)} ET` : ""}.</span>
      </div>
    ) : null; // Nothing to say when everything worked.
  }

  if (status.state === "failed") {
    const quarantined = status.emailStatus === "quarantined";
    return (
      <div className="session-banner session-banner--error">
        <strong>{quarantined ? "Email needs review" : "Today's plan did not import"}</strong>
        <span>
          {quarantined
            ? "An email arrived but could not be verified as today's plan."
            : "An email arrived but could not be read into a plan."}
          {status.receivedAt ? ` Received ${timeOnly(status.receivedAt)} ET.` : ""}
        </span>
        <button type="button" onClick={onPaste} className="session-banner__action">
          Paste it manually
        </button>
      </div>
    );
  }

  // waiting
  return (
    <div className="session-banner session-banner--waiting">
      <strong>Waiting for today&apos;s plan</strong>
      <span>
        {status.inFlight
          ? "An email just arrived and is being processed."
          : "Usually arrives by ~7:15 AM ET."}
        {status.previousSessionDate
          ? ` Showing ${formatDate(status.previousSessionDate)} below.`
          : ""}
      </span>
      <button type="button" onClick={onPaste} className="session-banner__action">
        Paste manually
      </button>
    </div>
  );
}
