// lib/google-tokens.ts
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const CID = process.env.GOOGLE_CLIENT_ID!;
const CSECRET = process.env.GOOGLE_CLIENT_SECRET!;

type OAuthRow = {
  user_email: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null; // unix seconds
  revoked: boolean | null;
};

export async function ensureValidAccessToken(user_email: string): Promise<{ ok: boolean; access_token?: string; error?: string }> {
  const db = getSupabaseAdmin();

  const { data: row, error } = await db
    .from("oauth_staging")
    .select("user_email, access_token, refresh_token, expires_at, revoked")
    .eq("provider", "google")
    .eq("user_email", user_email)
    .maybeSingle<OAuthRow>();

  if (error || !row) return { ok: false, error: error?.message || "no_oauth_row" };
  if (row.revoked) return { ok: false, error: "revoked" };

  const now = Math.floor(Date.now() / 1000);
  const exp = row.expires_at ?? 0;

  // still valid for 60s buffer?
  if (row.access_token && exp > now + 60) {
    return { ok: true, access_token: row.access_token };
  }

  // need refresh
  if (!row.refresh_token) {
    // nothing we can do; mark revoked so UI can prompt re-connect
    await db.from("oauth_staging")
      .update({ revoked: true, updated_at: new Date().toISOString() })
      .eq("provider", "google").eq("user_email", user_email);
    return { ok: false, error: "missing_refresh_token" };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CID,
      client_secret: CSECRET,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    // invalid_grant etc → mark revoked so we stop spamming
    await db.from("oauth_staging")
      .update({ revoked: true, updated_at: new Date().toISOString() })
      .eq("provider", "google").eq("user_email", user_email);

    return { ok: false, error: `refresh_failed: ${json?.error || "unknown"}` };
  }

  const newExp = typeof json.expires_in === "number"
    ? Math.floor(Date.now() / 1000) + json.expires_in
    : null;

  await db.from("oauth_staging")
    .update({
      access_token: json.access_token,
      expires_at: newExp,
      revoked: false,
      updated_at: new Date().toISOString(),
      // some tenants send a new refresh_token on refresh; keep it if present
      refresh_token: json.refresh_token ?? row.refresh_token,
    })
    .eq("provider", "google").eq("user_email", user_email);

  return { ok: true, access_token: json.access_token as string };
}
