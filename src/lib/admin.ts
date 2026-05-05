// Admin auth helper. Reads ADMIN_USER_IDS env var (comma-separated UUIDs)
// and checks against the current session's user. Used by /admin/* routes.
//
// F12 will add tokenized share URLs that bypass admin status (so Mancini
// can open a deep link to the pitch pack without an account); for now,
// only admin-authenticated users see /admin/pitch.

import { createServerSupabase } from "./supabase-server";

function adminUserIds(): string[] {
  const raw = process.env.ADMIN_USER_IDS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isAdminId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return adminUserIds().includes(userId);
}

// Server-side admin check via Supabase session cookie. Returns the
// authenticated user if admin, null otherwise. The 404-vs-403 decision
// is the caller's — this function only reports admin status.
export async function getAdminUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (!isAdminId(user.id)) return null;
  return { id: user.id, email: user.email ?? null };
}
