"use client";

import { useCallback, useEffect, useState } from "react";

// Client half of the ingest inbox. Server component handles the admin gate.
//
// Deliberately plain: a table, filter chips, and three buttons. This is a tool
// used while something is broken, so legibility beats polish. Status reasons
// are rendered in full rather than truncated, because the reason IS the
// diagnosis — "sender: From matched but forwarded by X" tells you exactly what
// to fix, and a clipped version does not.

interface EmailRow {
  id: string;
  subject: string | null;
  from_email: string | null;
  envelope_sender: string | null;
  status: string;
  status_reason: string | null;
  received_at: string;
  attempts: number;
  plan_id: string | null;
  user_id: string | null;
}

const STATUSES = ["all", "pending", "parsed", "quarantined", "failed", "inert"] as const;

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--gold, #fbbf24)",
  parsed: "var(--bull, #2dd4a0)",
  quarantined: "var(--gold, #fbbf24)",
  failed: "var(--bear, #f87171)",
  inert: "var(--t3, #7d7a72)",
};

export default function IngestInbox() {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/emails?status=${status}`);
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const data = await res.json();
      setEmails(data.emails ?? []);
      setCounts(data.counts ?? {});
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  async function act(id: string, action: "reparse" | "approve" | "reject") {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error(`${action} failed (${res.status})`);
      await load(filter);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="inbox">
      <header className="inbox__head">
        <h1>Ingest Inbox</h1>
        <p>
          Every message Postmark delivered, and what the pipeline decided about it.
          Approving hands a message back to the pipeline — it still has to pass
          parsing and source verification.
        </p>
      </header>

      <div className="inbox__filters">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`inbox__chip${filter === s ? " inbox__chip--on" : ""}`}
          >
            {s}
            {s !== "all" && counts[s] ? ` (${counts[s]})` : ""}
          </button>
        ))}
        <button type="button" onClick={() => load(filter)} className="inbox__chip">
          refresh
        </button>
      </div>

      {error && <div className="inbox__error">{error}</div>}

      {loading ? (
        <p className="inbox__empty">Loading…</p>
      ) : emails.length === 0 ? (
        <p className="inbox__empty">
          {filter === "all"
            ? "No messages yet. Once Gmail forwarding is verified, everything Postmark receives shows up here."
            : `No messages with status "${filter}".`}
        </p>
      ) : (
        <table className="inbox__table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Subject</th>
              <th>From</th>
              <th>Status</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => (
              <tr key={e.id}>
                <td className="inbox__mono">
                  {new Date(e.received_at).toLocaleString("en-US", {
                    month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit",
                    timeZone: "America/New_York",
                  })}
                </td>
                <td>{e.subject || <em>(no subject)</em>}</td>
                <td className="inbox__mono inbox__dim">
                  {e.from_email || "?"}
                  {e.envelope_sender && e.envelope_sender !== e.from_email && (
                    <div className="inbox__sub">via {e.envelope_sender}</div>
                  )}
                </td>
                <td>
                  <span style={{ color: STATUS_COLOR[e.status] ?? "inherit", fontWeight: 600 }}>
                    {e.status}
                  </span>
                  {e.attempts > 0 && <div className="inbox__sub">{e.attempts} attempt(s)</div>}
                </td>
                <td className="inbox__reason">{e.status_reason || "—"}</td>
                <td className="inbox__actions">
                  {(e.status === "failed" || e.status === "parsed") && (
                    <button disabled={busy === e.id} onClick={() => act(e.id, "reparse")}>
                      re-parse
                    </button>
                  )}
                  {e.status === "quarantined" && (
                    <>
                      <button disabled={busy === e.id} onClick={() => act(e.id, "approve")}>
                        approve
                      </button>
                      <button disabled={busy === e.id} onClick={() => act(e.id, "reject")}>
                        not a plan
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <style>{`
        .inbox { padding: 28px; max-width: 1200px; margin: 0 auto;
          color: var(--t1, #f0ede6); font-family: system-ui, sans-serif; }
        .inbox__head h1 { font-size: 22px; margin: 0 0 6px; }
        .inbox__head p { color: var(--t2, #b8b5ac); margin: 0 0 20px;
          font-size: 14px; line-height: 1.5; max-width: 70ch; }
        .inbox__filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
        .inbox__chip { background: var(--bg-2, #1a1b22); color: var(--t2, #b8b5ac);
          border: 1px solid var(--bs, #252630); border-radius: 6px;
          padding: 5px 11px; font-size: 13px; cursor: pointer; }
        .inbox__chip--on { background: var(--bg-4, #2c2d38); color: var(--t1, #f0ede6);
          border-color: var(--bx, #44455a); }
        .inbox__error { background: var(--bear-bg, rgba(248,113,113,.07));
          border: 1px solid var(--bear-d, #6b2020); color: var(--bear, #f87171);
          padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 14px; }
        .inbox__empty { color: var(--t3, #7d7a72); font-size: 14px; }
        .inbox__table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .inbox__table th { text-align: left; padding: 8px 10px;
          border-bottom: 1px solid var(--bm, #33343f); color: var(--t3, #7d7a72);
          font-weight: 500; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; }
        .inbox__table td { padding: 10px; border-bottom: 1px solid var(--bs, #252630);
          vertical-align: top; }
        .inbox__mono { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .inbox__dim { color: var(--t2, #b8b5ac); }
        .inbox__sub { color: var(--t3, #7d7a72); font-size: 11px; margin-top: 2px; }
        .inbox__reason { color: var(--t2, #b8b5ac); max-width: 40ch; line-height: 1.45; }
        .inbox__actions { white-space: nowrap; }
        .inbox__actions button { background: var(--bg-3, #22232c); color: var(--t1, #f0ede6);
          border: 1px solid var(--bm, #33343f); border-radius: 5px; padding: 4px 9px;
          font-size: 12px; cursor: pointer; margin-left: 6px; }
        .inbox__actions button:disabled { opacity: .5; cursor: default; }
        @media (max-width: 720px) {
          .inbox { padding: 16px; }
          .inbox__table, .inbox__table tbody, .inbox__table tr, .inbox__table td { display: block; width: 100%; }
          .inbox__table thead { display: none; }
          .inbox__table tr { border: 1px solid var(--bs, #252630); border-radius: 8px;
            margin-bottom: 10px; padding: 6px; }
          .inbox__table td { border: 0; padding: 5px 8px; }
        }
      `}</style>
    </div>
  );
}
