"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

/* Decorative price levels that float in the background */
const LEVELS = [
  { price: 5847, y: 8,  x: 5,  major: true },
  { price: 5823, y: 15, x: 72, major: false },
  { price: 5801, y: 22, x: 18, major: false },
  { price: 5788, y: 30, x: 85, major: true },
  { price: 5764, y: 38, x: 8,  major: false },
  { price: 5752, y: 45, x: 68, major: true },
  { price: 5741, y: 52, x: 25, major: false },
  { price: 5729, y: 60, x: 78, major: false },
  { price: 5711, y: 67, x: 12, major: true },
  { price: 5698, y: 75, x: 82, major: false },
  { price: 5685, y: 82, x: 35, major: false },
  { price: 5663, y: 90, x: 62, major: true },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
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
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes drift {
          0%, 100% { transform: translateX(0); opacity: 0.35; }
          50%      { transform: translateX(8px); opacity: 0.6; }
        }
        @keyframes cardGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(251,191,36,0), 0 24px 80px -16px rgba(0,0,0,0.5); }
          50%      { box-shadow: 0 0 48px -8px rgba(251,191,36,0.04), 0 24px 80px -16px rgba(0,0,0,0.5); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .login-brand   { animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0s both; }
        .login-card     { animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both, cardGlow 6s ease-in-out infinite 1s; }
        .login-footer   { animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both; }

        .brand-shimmer {
          background: linear-gradient(90deg, #fbbf24 0%, #fcd34d 30%, #fbbf24 50%, #f59e0b 70%, #fbbf24 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 5s linear infinite;
        }
        .level-float {
          animation: drift var(--dur) ease-in-out infinite;
          animation-delay: var(--delay);
        }

        /* Input gold focus ring */
        .auth-input-wrap { position: relative; }
        .auth-input-wrap::after {
          content: '';
          position: absolute; inset: -1px;
          border-radius: 10px;
          pointer-events: none;
          border: 1px solid rgba(251,191,36,0.4);
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .auth-input-wrap.focused::after { opacity: 1; }

        .auth-google:hover { border-color: rgba(255,255,255,0.14) !important; background: #22232c !important; }
        .auth-google:active { transform: scale(0.985); }

        .auth-submit { position: relative; overflow: hidden; }
        .auth-submit::before {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
          transform: translateX(-100%);
          transition: transform 0.5s ease;
        }
        .auth-submit:not(:disabled):hover::before { transform: translateX(100%); }
      `}</style>

      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: `
            radial-gradient(ellipse 60% 50% at 50% 0%, rgba(251,191,36,0.03) 0%, transparent 70%),
            radial-gradient(ellipse 80% 60% at 20% 100%, rgba(45,212,160,0.015) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 80%, rgba(96,165,250,0.015) 0%, transparent 60%),
            var(--bg-0)
          `,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* ── Floating price levels ── */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
          {LEVELS.map((l, i) => (
            <div
              key={i}
              className="level-float"
              style={{
                position: "absolute",
                top: `${l.y}%`,
                left: `${l.x}%`,
                display: "flex",
                alignItems: "center",
                gap: "8px",
                ["--dur" as string]: `${6 + i * 0.7}s`,
                ["--delay" as string]: `${i * 0.3}s`,
              }}
            >
              <div style={{
                width: l.major ? "48px" : "28px",
                height: "1px",
                background: l.major ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.04)",
              }} />
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "10px",
                fontWeight: l.major ? 700 : 400,
                color: l.major ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.06)",
                letterSpacing: "1px",
              }}>
                {l.price}
              </span>
            </div>
          ))}

          {/* Subtle grid lines */}
          <div style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)
            `,
            backgroundSize: "80px 80px",
          }} />
        </div>

        {/* ── Brand mark ── */}
        <div className="login-brand" style={{ textAlign: "center", marginBottom: "32px", position: "relative", zIndex: 1 }}>
          <img
            src="/logo.png"
            alt="TradeLadder"
            style={{
              height: "52px",
              width: "auto",
              filter: "drop-shadow(0 0 12px rgba(251,191,36,0.15))",
            }}
          />
          <div style={{ fontSize: "12px", color: "var(--text-4)", marginTop: "10px", letterSpacing: "0.5px" }}>
            Your edge, organized
          </div>
        </div>

        {/* ── Card ── */}
        <div
          className="login-card"
          style={{
            width: "100%",
            maxWidth: "400px",
            borderRadius: "16px",
            padding: "36px",
            position: "relative",
            zIndex: 1,
            background: "linear-gradient(160deg, rgba(26,27,34,0.95), rgba(19,20,26,0.98))",
            border: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0, color: "var(--text-1)", letterSpacing: "-0.3px" }}>
              Welcome back
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-3)", marginTop: "6px" }}>
              Sign in to your dashboard
            </p>
          </div>

          {/* Google */}
          <button
            onClick={handleGoogleLogin}
            className="auth-google"
            style={{
              width: "100%",
              padding: "13px 16px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              cursor: "pointer",
              transition: "all 0.2s ease",
              background: "var(--bg-3)",
              border: "1px solid rgba(255,255,255,0.07)",
              color: "var(--text-1)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.16.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", margin: "24px 0" }}>
            <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.05)" }} />
            <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", color: "var(--text-4)", fontWeight: 500 }}>
              or
            </span>
            <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.05)" }} />
          </div>

          {/* Email / Password */}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{
                display: "block", fontSize: "10px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "1.5px",
                color: "var(--text-3)", marginBottom: "6px",
              }}>
                Email
              </label>
              <div className={`auth-input-wrap ${focusedField === "email" ? "focused" : ""}`}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedField("email")}
                  onBlur={() => setFocusedField(null)}
                  required
                  placeholder="you@example.com"
                  style={{
                    width: "100%",
                    borderRadius: "10px",
                    padding: "13px 16px",
                    fontSize: "13px",
                    outline: "none",
                    background: "rgba(34,35,44,0.6)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    color: "var(--text-1)",
                    transition: "all 0.2s ease",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{
                display: "block", fontSize: "10px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "1.5px",
                color: "var(--text-3)", marginBottom: "6px",
              }}>
                Password
              </label>
              <div className={`auth-input-wrap ${focusedField === "password" ? "focused" : ""}`}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  required
                  placeholder="••••••••"
                  style={{
                    width: "100%",
                    borderRadius: "10px",
                    padding: "13px 16px",
                    fontSize: "13px",
                    outline: "none",
                    background: "rgba(34,35,44,0.6)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    color: "var(--text-1)",
                    transition: "all 0.2s ease",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>

            {error && (
              <div style={{
                fontSize: "13px",
                padding: "10px 14px",
                borderRadius: "10px",
                background: "rgba(248,113,113,0.08)",
                color: "#f87171",
                border: "1px solid rgba(248,113,113,0.12)",
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="auth-submit"
              style={{
                width: "100%",
                padding: "13px 16px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: loading ? "default" : "pointer",
                background: loading
                  ? "rgba(251,191,36,0.4)"
                  : "linear-gradient(135deg, #fbbf24, #f59e0b)",
                color: "#0c0d10",
                border: "none",
                transition: "all 0.25s ease",
                opacity: loading ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                letterSpacing: "0.3px",
                marginTop: "4px",
              }}
            >
              {loading && (
                <div style={{
                  width: "14px", height: "14px",
                  border: "2px solid rgba(12,13,16,0.2)",
                  borderTopColor: "#0c0d10",
                  borderRadius: "50%",
                  animation: "spin 0.6s linear infinite",
                }} />
              )}
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        {/* ── Footer ── */}
        <div className="login-footer" style={{ marginTop: "28px", textAlign: "center", position: "relative", zIndex: 1 }}>
          <a
            href="/signup"
            style={{ fontSize: "13px", color: "var(--text-3)", textDecoration: "none", transition: "color 0.2s ease" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-3)")}
          >
            Don&apos;t have an account?{" "}
            <span style={{ color: "var(--gold)", fontWeight: 600 }}>Sign up</span>
          </a>
        </div>
      </div>
    </>
  );
}
