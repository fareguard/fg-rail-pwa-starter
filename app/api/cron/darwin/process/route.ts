import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// ===== SECURITY GATE =====
const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

function isAuthorized(request: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  const hdr = request.headers.get("x-admin-key") || "";
  return hdr === ADMIN_KEY;
}

function json(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return json({ ok: false }, 404);

  const db = getSupabaseAdmin();

  // Pull a small sample so we can see real shapes in prod safely
  const { data, error } = await db
    .from("darwin_messages")
    .select("id, received_at, topic, partition, offset, message_key, payload")
    .order("id", { ascending: false })
    .limit(25);

  if (error) return json({ ok: false, error: error.message }, 500);

  // Return only “shape hints” (avoid huge payload spam)
  const shapes = (data || []).map((r: any) => {
    const p = r.payload;
    const keys = p && typeof p === "object" ? Object.keys(p).slice(0, 25) : [];
    return {
      id: r.id,
      topic: r.topic,
      offset: r.offset,
      key: r.message_key,
      topLevelKeys: keys,
    };
  });

  return json({
    ok: true,
    sample: shapes,
    note:
      "Next step: pick 2–3 real messages that correspond to one of your known trips, then we’ll implement the exact mapping from Darwin payload -> trip delay/cancel + eligibility.",
  });
}

export async function POST(req: Request) {
  return GET(req);
}
