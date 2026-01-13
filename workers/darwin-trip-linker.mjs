import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BATCH = Number(process.env.DARWIN_LINK_BATCH ?? "200");
const SLEEP_MS = Number(process.env.DARWIN_LINK_SLEEP_MS ?? "2500");
const MAX_SCORE_SECONDS = Number(process.env.DARWIN_LINK_MAX_SCORE_SECONDS ?? "5400"); // 90 mins

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tick() {
  // Pull a small batch of candidate trips (needs index trips_need_rid_idx)
  const { data: trips, error: qErr } = await db
    .from("trips")
    .select("id")
    .is("darwin_rid", null)
    .not("depart_planned", "is", null)
    .order("depart_planned", { ascending: false })
    .limit(BATCH);

  if (qErr) throw new Error("trips query failed: " + qErr.message);
  if (!trips?.length) return { scanned: 0, linked: 0 };

  let linked = 0;

  for (const t of trips) {
    // Call your DB function; strict threshold enforced in SQL function too
    const { data, error } = await db.rpc("link_trip_to_darwin", {
      p_trip_id: t.id,
      max_score_seconds: MAX_SCORE_SECONDS,
    });

    if (error) {
      // don't crash the whole worker for one bad row
      console.error("link_trip_to_darwin error", t.id, error.message);
      continue;
    }
    if (data === true) linked++;
  }

  return { scanned: trips.length, linked };
}

async function main() {
  console.log("darwin-trip-linker up", {
    BATCH,
    SLEEP_MS,
    MAX_SCORE_SECONDS,
  });

  while (true) {
    try {
      const res = await tick();
      console.log("tick", res);
    } catch (e) {
      console.error("tick failed", e?.message || e);
    }
    await sleep(SLEEP_MS);
  }
}

main();
