// Next.js calls register() once when the server boots. Calling assertEnv
// here crashes the process at start time if any required key is missing —
// instead of each route handler discovering it on first request. Skipped
// during `next build` because NEXT_RUNTIME isn't set there.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnv } = await import("./lib/env");
    assertEnv();
  }
}
