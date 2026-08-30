"use client";

import { useEffect } from "react";

// Next.js App Router route-level error boundary. Catches errors that escape
// the per-tab boundaries inside page.tsx — middleware, layout, and any
// unwrapped server-component renders.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="error-route">
      <div className="error-route-card">
        <h2>Something broke loading the dashboard.</h2>
        <p>{error.message || "Unknown error"}</p>
        {error.digest && <p className="error-route-digest">Ref: {error.digest}</p>}
        <button className="btn b-d" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
