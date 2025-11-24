// lib/google.ts
import { getSupabaseAdmin } from "@/lib/supabase";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

type OAuthRow = {
  id: string;
  provider: string;
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

export async function getFreshAccessToken(
  user_email: string
): Promise<string> {
  const supa = getSupabaseAdmin();

  const { data, error } = await supa
    .from("oauth_staging")
    .select("*")
    .eq("provider", "google")
    .eq("user_email", user_email)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data?.length) {
    throw new Error("No Google OAuth tokens found for this email");
  }

  const row = data[0] as OAuthRow;

  const now = Math.floor(Date.now() / 1000);
  if (row.access_token && row.expires_at && row.expires_at > now + 30) {
    return row.access_token;
  }

  if (!row.refresh_token) {
    throw new Error("Missing refresh_token; re-connect Gmail with consent");
  }

  const refreshed = await refreshWithGoogle(row.refresh_token);

  const newAccess = refreshed.access_token as string | undefined;
  const newExpiresIn =
    typeof refreshed.expires_in === "number" ? refreshed.expires_in : null;
  const newExpiresAt = newExpiresIn ? now + newExpiresIn : null;

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
    .eq("id", (row as any).id);

  if (!newAccess) throw new Error("Refresh returned no access_token");
  return newAccess;
}

// -------- NEW: code -> tokens + userinfo ------------------------------

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Google token exchange failed: ${res.status} ${JSON.stringify(json)}`
    );
  }
  return json;
}

export async function fetchGoogleUser(accessToken: string) {
  const res = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Google userinfo failed: ${res.status} ${JSON.stringify(json)}`
    );
  }
  return json as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
}
