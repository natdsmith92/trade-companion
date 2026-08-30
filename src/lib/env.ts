// Validated server-side env. Validation runs lazily — calling assertEnv()
// at server startup (instrumentation.ts) crashes the process if anything is
// missing, but the file's mere import does not. This lets `next build`
// succeed without env vars present.

interface ServerEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY: string;
  OPENAI_API_KEY: string;
}

const REQUIRED: (keyof ServerEnv)[] = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_KEY",
  "OPENAI_API_KEY",
];

// Throws if any required key is missing. Called by instrumentation.ts.
export function assertEnv(): ServerEnv {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env: ${missing.join(", ")}. ` +
        `See .env.example for the full list. The server cannot start without these.`,
    );
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  };
}

// Health-endpoint helper: returns booleans, no values. Safe at build time
// (won't throw on missing keys — that's the whole point of /api/health).
export function envStatus(): Record<keyof ServerEnv, boolean> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  };
}
