import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  throw new Error("Missing SUPABASE env vars for worker (URL or SERVICE_ROLE_KEY).");
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

const LOOP_MS = Number(process.env.DARWIN_TRIP_LINK_LOOP_MS ?? "15000");
const BATCH_SIZE = Number(process.env.DARWIN_TRIP_LINK_BATCH ?? "50");
const MAX_SCORE_SECONDS = Number(process.env.DARWIN_TRIP_LINK_MAX_SCORE_S ?? "5400"); // 90 mins

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function linkBatch() {
  // Only consider trips in a sane time window:
  // - from 7 days ago to 24h in the future (covers late ingestion + upcoming journeys)
  const { data: trips, error } = await db
    .from("trips")
    .select("id")
    .is("darwin_rid", null)
    .not("depart_planned", "is", null)
    .gte("depart_planned", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .lte("depart_planned", new Date(Date.now() + 24 * 3600 * 1000).toISOString())
    .order("depart_planned", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) throw new Error("Trips select error: " + error.message);
  if (!trips?.length) return { examined: 0, linked: 0 };

  let linked = 0;

  for (const t of trips) {
    const { data, error: rpcErr } = await db.rpc("link_trip_to_darwin", {
      p_trip_id: t.id,
      max_score_seconds: MAX_SCORE_SECONDS,
    });

    if (rpcErr) {
      // don’t crash the loop on one bad trip
      console.error("link_trip_to_darwin rpc error", t.id, rpcErr.message);
      continue;
    }

    if (data === true) linked++;
  }

  return { examined: trips.length, linked };
}

async function main() {
  console.log("[darwin-trip-linker] starting", {
    LOOP_MS,
    BATCH_SIZE,
    MAX_SCORE_SECONDS,
  });

  while (true) {
    try {
      const r = await linkBatch();
      if (r.examined || r.linked) {
        console.log("[darwin-trip-linker] batch", r);
      }
    } catch (e) {
      console.error("[darwin-trip-linker] loop error", e?.message || e);
    }

    await sleep(LOOP_MS);
  }
}

main().catch((e) => {
  console.error("[darwin-trip-linker] fatal", e?.message || e);
  process.exit(1);
});
