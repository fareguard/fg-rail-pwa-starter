// lib/google.ts
import { getSupabaseAdmin } from "@/lib/supabase";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

type OAuthRow = {
  id: string;
  provider: string;
  user_id: string;
  user_email: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null; // unix seconds
  scope?: string | null;
  token_type?: string | null;
};

async function refreshWithGoogle(refresh_token: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Google refresh failed: ${res.status} ${JSON.stringify(json)}`
    );
  }
  return json;
}

/**
 * Get a fresh Gmail access token for a specific Supabase user.
 * Returns both the token and the Gmail address it’s tied to.
 */
export async function getFreshAccessToken(userId: string): Promise<{
  accessToken: string;
  user_email: string;
}> {
  const supa = getSupabaseAdmin();

  const { data, error } = await supa
    .from("oauth_staging")
    .select("*")
    .eq("provider", "google")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data?.length) {
    throw new Error("No Google OAuth tokens found for this user");
  }

  const row = data[0] as OAuthRow;
  const now = Math.floor(Date.now() / 1000);

  // If valid and not near expiry (30s buffer), use it
  if (row.access_token && row.expires_at && row.expires_at > now + 30) {
    return { accessToken: row.access_token, user_email: row.user_email };
  }

  if (!row.refresh_token) {
    throw new Error("Missing refresh_token; user must re-connect Gmail");
  }

  // Refresh with Google
  const refreshed = await refreshWithGoogle(row.refresh_token);

  const newAccess = refreshed.access_token as string | undefined;
  const newExpiresIn =
    typeof refreshed.expires_in === "number" ? refreshed.expires_in : null;
  const newExpiresAt = newExpiresIn ? now + newExpiresIn : null;

  // Google may rotate the refresh_token
  const rotatedRefresh =
    (refreshed.refresh_token as string | undefined) ?? row.refresh_token;

  await supa
    .from("oauth_staging")
    .update({
      access_token: newAccess ?? row.access_token,
      refresh_token: rotatedRefresh,
      expires_at: newExpiresAt,
      scope: refreshed.scope ?? row.scope ?? null,
      token_type: refreshed.token_type ?? row.token_type ?? "Bearer",
    })
    .eq("id", row.id);

  if (!newAccess) throw new Error("Refresh returned no access_token");

  return { accessToken: newAccess, user_email: row.user_email };
}
