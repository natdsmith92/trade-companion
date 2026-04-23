"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleGoogleLogin() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--bg-0)" }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}
      >
        <div className="text-center mb-8">
          <div
            className="text-xs font-extrabold tracking-[4px] uppercase mb-2"
            style={{ color: "var(--gold)" }}
          >
            TradeLadder
          </div>
          <div className="text-2xl font-bold">Welcome back</div>
          <div className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
            Sign in to your dashboard
          </div>
        </div>

        {/* Google Sign In */}
        <button
          onClick={handleGoogleLogin}
          className="w-full py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-3 transition-all hover:opacity-90 mb-6"
          style={{
            background: "var(--bg-3)",
            border: "1px solid var(--border)",
            color: "var(--text-1)",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.16.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          Sign in with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
          <span className="text-xs uppercase tracking-[2px]" style={{ color: "var(--text-4)" }}>
            or
          </span>
          <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
        </div>

        {/* Email/Password Sign In */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              className="text-[10px] uppercase tracking-[1px] mb-1 block"
              style={{ color: "var(--text-3)" }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg px-4 py-3 text-sm outline-none"
              style={{
                background: "var(--bg-3)",
                border: "1px solid var(--border)",
                color: "var(--text-1)",
              }}
            />
          </div>
          <div>
            <label
              className="text-[10px] uppercase tracking-[1px] mb-1 block"
              style={{ color: "var(--text-3)" }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg px-4 py-3 text-sm outline-none"
              style={{
                background: "var(--bg-3)",
                border: "1px solid var(--border)",
                color: "var(--text-1)",
              }}
            />
          </div>

          {error && (
            <div
              className="text-sm px-3 py-2 rounded-lg"
              style={{ background: "var(--bear-bg)", color: "var(--bear)" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg text-sm font-bold transition-all"
            style={{
              background: "var(--blue)",
              color: "#fff",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "Signing in..." : "Sign In with Email"}
          </button>
        </form>

        <div className="text-center mt-6">
          <a
            href="/signup"
            className="text-sm hover:underline"
            style={{ color: "var(--blue)" }}
          >
            Don&apos;t have an account? Sign up
          </a>
        </div>
      </div>
    </div>
  );
}
