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
            {loading ? "Signing in..." : "Sign In"}
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
