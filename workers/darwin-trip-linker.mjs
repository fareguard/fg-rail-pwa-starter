import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BATCH = Number(process.env.TRIP_LINK_BATCH ?? "50");
const SLEEP_MS = Number(process.env.TRIP_LINK_SLEEP_MS ?? "5000");

// strict-but-not-brittle defaults
const MAX_SCORE_SECONDS = BigInt(process.env.TRIP_LINK_MAX_SCORE_SECONDS ?? "3600"); // 60m combined
const MIN_MARGIN_SECONDS = BigInt(process.env.TRIP_LINK_MIN_MARGIN_SECONDS ?? "900"); // 15m lead

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTripIds() {
  // only trips likely to have Darwin coverage and enough info to match
  const { data, error } = await db
    .from("trips")
    .select("id")
    .is("darwin_rid", null)
    .not("depart_planned", "is", null)
    .not("arrive_planned", "is", null)
    .gte("depart_planned", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .lte("depart_planned", new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString())
    .order("depart_planned", { ascending: false })
    .limit(BATCH);

  if (error) throw new Error("fetchTripIds: " + error.message);
  return (data ?? []).map((r) => r.id);
}

async function linkOne(tripId) {
  // call the SQL function with named args
  const { data, error } = await db.rpc("link_trip_to_darwin", {
    p_trip_id: tripId,
    max_score_seconds: Number(MAX_SCORE_SECONDS),   // pg bigint
    min_margin_seconds: Number(MIN_MARGIN_SECONDS), // pg bigint
  });

  if (error) throw new Error(`linkOne(${tripId}): ` + error.message);
  return data === true;
}

async function loop() {
  for (;;) {
    const t0 = Date.now();
    let ids = [];
    try {
      ids = await fetchTripIds();
    } catch (e) {
      console.error("[trip-link] fetch error", e.message || e);
      await sleep(SLEEP_MS);
      continue;
    }

    if (!ids.length) {
      console.log("[trip-link] no eligible trips; sleeping");
      await sleep(SLEEP_MS);
      continue;
    }

    let linked = 0;
    let attempted = 0;

    for (const id of ids) {
      attempted++;
      try {
        const ok = await linkOne(id);
        if (ok) linked++;
      } catch (e) {
        console.error("[trip-link] link error", e.message || e);
      }
      // tiny yield to avoid bursty RPC pressure
      await sleep(50);
    }

    console.log(
      `[trip-link] attempted=${attempted} linked=${linked} batch=${ids.length} ms=${Date.now() - t0}`
    );

    await sleep(SLEEP_MS);
  }
}

loop().catch((e) => {
  console.error("[trip-link] fatal", e);
  process.exit(1);
});
