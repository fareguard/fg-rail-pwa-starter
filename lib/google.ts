// lib/google.ts
// Server-only helpers for Google OAuth tokens

import { getSupabaseAdmin } from "./supabase-admin";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type TokenRow = {
  id: string;
  user_email: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null; // unix seconds
  created_at?: string;
};

function isExpired(expires_at: number | null | undefined) {
  if (!expires_at) return true;
  // refresh 60s early to be safe
  const now = Math.floor(Date.now() / 1000);
  return now >= expires_at - 60;
}

/**
 * Returns a fresh Google access token for the given email.
 * Reads `oauth_staging` (provider='google'), refreshes if needed, updates row, and returns token.
 */
export async function getFreshAccessToken(userEmail: string): Promise<string> {
  if (!userEmail) throw new Error("userEmail required");

  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env vars");
  }

  const db = getSupabaseAdmin();

  // Get the most recent token row for this user
  const { data: row, error } = await db
    .from("oauth_staging")
    .select("*")
    .eq("provider", "google")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<TokenRow>();

  if (error) throw new Error(`supabase select failed: ${error.message}`);
  if (!row) throw new Error(`No Google OAuth row for ${userEmail}`);
  if (!row.access_token && !row.refresh_token) {
    throw new Error("No access/refresh token stored");
  }

  // If access token still valid, return it
  if (row.access_token && !isExpired(row.expires_at)) {
    return row.access_token;
  }

  // Need a refresh token to get a fresh access token
  if (!row.refresh_token) {
    throw new Error("Missing refresh_token; re-connect Google");
  }

  // Refresh
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Google refresh failed: ${res.status} ${JSON.stringify(json)}`
    );
  }

  const newAccess = json.access_token as string;
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const newExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;

  // Persist the new token values
  const { error: upErr } = await db
    .from("oauth_staging")
    .update({
      access_token: newAccess,
      // keep same refresh_token unless Google returns a new one
      refresh_token: (json.refresh_token as string | null) ?? row.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("id", row.id);

  if (upErr) {
    // Not fatal for returning the token, but log for visibility
    console.error("Failed to update oauth_staging:", upErr);
  }

  return newAccess;
}
