import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Which senders to treat as ticket/booking emails
const RETAILERS = [
  "trainline.com",
  "avantiwestcoast.co.uk",
  "gwr.com",
  "lner.co.uk",
  "tpexpress.co.uk",
  "thameslinkrailway.com",
  "scotrail.co.uk",
  "crosscountrytrains.co.uk",
  "northernrailway.co.uk",
  "chilternrailways.co.uk",
  "greateranglia.co.uk",
  "southeasternrailway.co.uk",
  "southwesternrailway.com",
  "c2c-online.co.uk",
  "splitmyfare.co.uk",
  "railsmartr.co.uk"
];

function buildQuery() {
  // from:trainline.com OR from:lner.co.uk ...
  const fromParts = RETAILERS.map(domain => `from:${domain}`).join(" OR ");
  // limit to roughly last ~6 months
  return `(${fromParts}) newer_than:180d`;
}

// helper to call Gmail with a bearer token
async function gmailFetch<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gmail ${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

export async function GET() {
  try {
    // 1. Get the most recent gmail connection
    const supa = getSupabaseAdmin();
    const { data, error } = await supa
      .from("oauth_staging")
      .select("*")
      .eq("provider", "google")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No connected Gmail account yet." },
        { status: 400 }
      );
    }

    const row = data[0];
    const accessToken = row.access_token as string;
    const userEmail = row.user_email as string;

    // 2. Search for likely ticket emails
    const q = buildQuery();
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
      q
    )}&maxResults=10`;

    const list = await gmailFetch<{ messages?: { id: string }[] }>(
      accessToken,
      listUrl
    );

    const ids = (list.messages || []).map(m => m.id);
    if (!ids.length) {
      return NextResponse.json({
        ok: true,
        email: userEmail,
        matches: [],
      });
    }

    // 3. Pull details for each message
    const details = await Promise.all(
      ids.map(async (id) => {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
        const m = await gmailFetch<any>(accessToken, msgUrl);

        // grab high-signal headers
        const headers: Record<string, string> = {};
        for (const h of m.payload?.headers || []) {
          const name = (h.name || "").toLowerCase();
          if (["subject", "from", "to", "date"].includes(name)) {
            headers[name] = h.value || "";
          }
        }

        // message snippet (Google already gives a pre-digested preview)
        let snippet = m.snippet || "";
        if (snippet.length > 200) {
          snippet = snippet.slice(0, 197) + "...";
        }

        // naive booking ref guess from plain text part
        const part = (m.payload?.parts || []).find(
          (p: any) => (p.mimeType || "").startsWith("text/plain")
        );
        let plainText = "";
        if (part?.body?.data) {
          // Gmail returns body.data as base64url
          const b64 = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
          plainText = Buffer.from(b64, "base64").toString("utf-8");
        }

        const refGuess = plainText.match(/\b[A-Z0-9]{6,8}\b/);

        return {
          id,
          headers,
          snippet,
          booking_ref: refGuess ? refGuess[0] : null,
        };
      })
    );

    return NextResponse.json({
      ok: true,
      email: userEmail,
      matches: details,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "ingest_failed" },
      { status: 500 }
    );
  }
}
