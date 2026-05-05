import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";

// /admin/pitch — gated by ADMIN_USER_IDS env var (F9). Non-admin (or
// unauthenticated) callers get a 404 to avoid leaking the route's
// existence. The actual pitch pack render lands in E6 — this is a
// placeholder so the auth pattern is in place and reviewable today.

export default async function AdminPitchPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg-1, #0a0a0a)",
        color: "var(--ink-1, #e0e0e0)",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <h1 style={{ marginTop: 0, fontSize: 24, color: "var(--gold, #fbbf24)" }}>
          Pitch Pack
        </h1>
        <p style={{ color: "var(--ink-2, #999)", lineHeight: 1.6 }}>
          You are signed in as <strong>{admin.email || admin.id}</strong> with admin
          privileges.
        </p>
        <p style={{ color: "var(--ink-2, #999)", lineHeight: 1.6 }}>
          Pitch pack rendering ships in <strong>E6</strong>: parser-accuracy stats,
          screenshot gallery, and a downloadable PDF. This page is a placeholder
          for the auth gate.
        </p>
        <p style={{ color: "var(--ink-3, #666)", fontSize: 12, marginTop: 32 }}>
          F12 will add tokenized share URLs so Mancini can open a deep link
          without an account.
        </p>
      </div>
    </div>
  );
}
