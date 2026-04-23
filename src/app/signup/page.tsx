"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: "var(--bg-0)" }}
      >
        <div
          className="w-full max-w-sm rounded-xl p-8 text-center"
          style={{ background: "var(--bg-2)", border: "1px solid var(--border)" }}
        >
          <div className="text-4xl mb-4">📧</div>
          <div className="text-xl font-bold mb-2">Check your email</div>
          <div className="text-sm" style={{ color: "var(--text-3)" }}>
            We sent a confirmation link to <strong>{email}</strong>.
            Click the link to activate your account.
          </div>
          <a
            href="/login"
            className="inline-block mt-6 text-sm hover:underline"
            style={{ color: "var(--blue)" }}
          >
            Back to login
          </a>
        </div>
      </div>
    );
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
          <div className="text-2xl font-bold">Create account</div>
          <div className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
            Get started with your trade companion
          </div>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
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
              minLength={6}
              className="w-full rounded-lg px-4 py-3 text-sm outline-none"
              style={{
                background: "var(--bg-3)",
                border: "1px solid var(--border)",
                color: "var(--text-1)",
              }}
            />
            <div className="text-xs mt-1" style={{ color: "var(--text-4)" }}>
              Minimum 6 characters
            </div>
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
              background: "var(--bull)",
              color: "#000",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <div className="text-center mt-6">
          <a
            href="/login"
            className="text-sm hover:underline"
            style={{ color: "var(--blue)" }}
          >
            Already have an account? Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
