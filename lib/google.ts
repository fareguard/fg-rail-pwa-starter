import { SupabaseClient } from "@supabase/supabase-js";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

export async function getFreshAccessToken(
  supa: SupabaseClient,
  row: { id: string; access_token: string | null; refresh_token: string | null; expires_at: string | null }
): Promise<string> {
  let { access_token, refresh_token, expires_at } = row;

  const expMs = expires_at ? new Date(expires_at).getTime() : 0;
  const aboutToExpire = !access_token || Date.now() > (expMs - 60_000);

  if (aboutToExpire) {
    if (!refresh_token) throw new Error("No refresh_token to renew Gmail access.");
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
    const data = await res.json();
    if (!res.ok) throw new Error("Refresh failed: " + JSON.stringify(data));

    access_token = data.access_token;
    const newExpires = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();

    await supa.from("oauth_staging").update({
      access_token,
      expires_at: newExpires
    }).eq("id", row.id);
  }

  return access_token!;
}
