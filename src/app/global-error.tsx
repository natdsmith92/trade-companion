"use client";

// Next.js App Router last-resort error boundary. Catches errors in the root
// layout itself — must declare its own <html> + <body> because the layout has
// already failed to render.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0a0a",
            color: "#e0e0e0",
            fontFamily: "system-ui, sans-serif",
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <h2 style={{ marginTop: 0 }}>TradeLadder is offline.</h2>
            <p style={{ color: "#999" }}>
              {error.message || "The application failed to start."}
            </p>
            {error.digest && (
              <p style={{ color: "#666", fontFamily: "monospace", fontSize: 12 }}>
                Ref: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{
                marginTop: 12,
                padding: "8px 16px",
                background: "#1a1a1a",
                color: "#e0e0e0",
                border: "1px solid #333",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
