import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BATCH = parseInt(process.env.CLAIM_CHECK_BATCH || "200", 10);
const SLEEP_MS = parseInt(process.env.CLAIM_CHECK_SLEEP_MS || "30000", 10);

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceKey);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tick() {
  // Calls the DB function you created
  const { data, error } = await db.rpc("claims_check_batch", { p_limit: BATCH });
  if (error) throw error;

  const updated = Array.isArray(data) ? data?.[0] : data; // supabase can wrap
  console.log(
    JSON.stringify({
      ok: true,
      worker: "claim-checker",
      updated: updated ?? data,
      batch: BATCH,
      ts: new Date().toISOString(),
    })
  );
}

async function main() {
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error(JSON.stringify({ ok: false, worker: "claim-checker", error: e?.message || String(e) }));
    }
    await sleep(SLEEP_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
