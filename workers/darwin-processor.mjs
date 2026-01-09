// workers/darwin-processor.mjs
import { createClient } from "@supabase/supabase-js";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ===== REQUIRED ENV =====
const SUPABASE_URL = must("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = must("SUPABASE_SERVICE_ROLE_KEY");

// ===== OPTIONAL ENV (safe defaults) =====
const MAX_MESSAGES = Number(process.env.DARWIN_PROCESS_MAX_MESSAGES ?? "200"); // per loop
const MAX_MS = Number(process.env.DARWIN_PROCESS_MAX_MS ?? "15000"); // timebox per loop
const SLEEP_MS = Number(process.env.DARWIN_PROCESS_SLEEP_MS ?? "2000"); // pause between loops
const LOG_EVERY = Number(process.env.DARWIN_PROCESS_LOG_EVERY ?? "1"); // log every N loops

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ===== JSON utils =====
function mustParseJsonString(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Darwin time fields: "20:55" or "21:01:30"
function parseDarwinTime(t) {
  if (!t || typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
  return { h: hh, m: mm, s: ss };
}

// Build ISO timestamp from ssd + time, with a simple cross-midnight rollover heuristic.
// Many schedules roll past midnight; Darwin still uses ssd as service-start date.
// If times go 23:xx then 00:xx, we bump day by +1 for the 00:xx onwards.
function toIsoWithRollover(ssd, timeStr, lastHourRef) {
  if (!ssd || !timeStr) return { iso: null, hour: lastHourRef ?? null };

  const tt = parseDarwinTime(timeStr);
  if (!tt) return { iso: null, hour: lastHourRef ?? null };

  const base = new Date(`${ssd}T00:00:00.000Z`);
  if (isNaN(base.getTime())) return { iso: null, hour: lastHourRef ?? null };

  let dayOffset = 0;
  if (typeof lastHourRef === "number") {
    // rollover heuristic: 23 -> 0/1/2/3 means next day
    if (lastHourRef >= 21 && tt.h <= 3) dayOffset = 1;
    // also if sequence already rolled and stays low, keep dayOffset at 1 by updating lastHourRef below
  }

  base.setUTCDate(base.getUTCDate() + dayOffset);
  base.setUTCHours(tt.h, tt.m, tt.s, 0);

  return { iso: base.toISOString(), hour: tt.h };
}

function minutesDiffIso(lateIso, earlyIso) {
  if (!lateIso || !earlyIso) return null;
  const a = new Date(lateIso);
  const b = new Date(earlyIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Only keep messages that are actually TS schedule updates we can parse into locations.
// Also allow TS.Location to be array OR object (some messages have object).
function extractTS(decoded) {
  const TS = decoded?.uR?.TS;
  if (!TS) return null;

  const ssd = TS.ssd ?? null;
  const rid = TS.rid ?? null;
  const uid = TS.uid ?? null;

  let locs = TS.Location;
  if (Array.isArray(locs)) {
    // ok
  } else if (locs && typeof locs === "object") {
    // single location object -> normalize to array of 1
    locs = [locs];
  } else {
    locs = [];
  }

  if (!ssd || !locs.length) return null;

  return { ssd, rid, uid, locs };
}

// Optional CRS enrichment via tiploc_crs table.
// Assumes Darwin TIPLOCs are uppercase and match your tiploc_crs content.
async function fetchCrsMap(tiplocs) {
  if (!tiplocs.length) return new Map();

  // De-dupe and cap to avoid massive IN lists
  const uniq = Array.from(new Set(tiplocs)).slice(0, 500);
  const { data, error } = await sb
    .from("tiploc_crs")
    .select("tiploc,crs")
    .in("tiploc", uniq);

  if (error) {
    console.error("[processor] tiploc_crs lookup error:", error.message);
    return new Map();
  }

  const map = new Map();
  for (const r of data ?? []) {
    if (r?.tiploc && r?.crs) map.set(String(r.tiploc).trim().toUpperCase(), String(r.crs).trim().toUpperCase());
  }
  return map;
}

async function processOnce() {
  const started = Date.now();

  // Production-grade query: newest-first, no JSON-path filters.
  const { data: msgs, error } = await sb
    .from("darwin_messages")
    .select("id,received_at,topic,payload")
    .is("processed_at", null)
    .order("received_at", { ascending: false })
    .limit(MAX_MESSAGES);

  if (error) throw new Error(`darwin_messages select failed: ${error.message}`);

  let examined = 0;
  let eventsInserted = 0;
  let messagesMarked = 0;

  const skipped = {
    no_bytes: 0,
    bad_json: 0,
    no_ts: 0,
    no_locations: 0,
    insert_error: 0,
    mark_error: 0,
    timebox: 0,
    not_schedule: 0,
  };

  for (const m of msgs ?? []) {
    if (Date.now() - started > MAX_MS) {
      skipped.timebox++;
      break;
    }

    examined++;

    const bytes = m?.payload?.bytes;
    if (!bytes) {
      skipped.no_bytes++;
      const { error: me } = await sb.from("darwin_messages").update({ processed_at: new Date().toISOString() }).eq("id", m.id);
      if (!me) messagesMarked++;
      else skipped.mark_error++;
      continue;
    }

    const decoded = mustParseJsonString(bytes);
    if (!decoded) {
      skipped.bad_json++;
      const { error: me } = await sb.from("darwin_messages").update({ processed_at: new Date().toISOString() }).eq("id", m.id);
      if (!me) messagesMarked++;
      else skipped.mark_error++;
      continue;
    }

    const tsBlock = extractTS(decoded);
    if (!tsBlock) {
      skipped.not_schedule++;
      // mark processed so it doesn't clog the queue
      const { error: me } = await sb.from("darwin_messages").update({ processed_at: new Date().toISOString() }).eq("id", m.id);
      if (!me) messagesMarked++;
      else skipped.mark_error++;
      continue;
    }

    const { ssd, rid, uid, locs } = tsBlock;

    // collect tiplocs for CRS mapping
    const tiplocs = locs
      .map((loc) => (loc?.tpl ? String(loc.tpl).trim().toUpperCase() : null))
      .filter(Boolean);

    const crsMap = await fetchCrsMap(tiplocs);

    // Build events for this message
    const rows = [];
    let lastHour = null;

    for (const loc of locs) {
      const tiploc = loc?.tpl ? String(loc.tpl).trim().toUpperCase() : null;
      const crs = tiploc ? (crsMap.get(tiploc) ?? null) : null;

      // scheduled times
      const pta = loc?.pta ?? null;
      const ptd = loc?.ptd ?? null;

      // actual/estimated times: Darwin may use et / at depending on origin
      const arrT = loc?.arr?.at ?? loc?.arr?.et ?? null;
      const depT = loc?.dep?.at ?? loc?.dep?.et ?? null;

      // ARR
      const plannedArrRes = toIsoWithRollover(ssd, pta, lastHour);
      const plannedArr = plannedArrRes.iso;
      lastHour = plannedArrRes.hour ?? lastHour;

      const actualArrRes = toIsoWithRollover(ssd, arrT, lastHour);
      const actualArr = actualArrRes.iso;
      lastHour = actualArrRes.hour ?? lastHour;

      const lateArr = minutesDiffIso(actualArr, plannedArr);

      if (pta || arrT) {
        rows.push({
          received_at: m.received_at,
          tiploc,
          crs,
          rid,
          uid,
          event_type: "ARR",
          planned_time: plannedArr,
          actual_time: actualArr,
          late_minutes: lateArr,
          raw: loc,
        });
      }

      // DEP
      const plannedDepRes = toIsoWithRollover(ssd, ptd, lastHour);
      const plannedDep = plannedDepRes.iso;
      lastHour = plannedDepRes.hour ?? lastHour;

      const actualDepRes = toIsoWithRollover(ssd, depT, lastHour);
      const actualDep = actualDepRes.iso;
      lastHour = actualDepRes.hour ?? lastHour;

      const lateDep = minutesDiffIso(actualDep, plannedDep);

      if (ptd || depT) {
        rows.push({
          received_at: m.received_at,
          tiploc,
          crs,
          rid,
          uid,
          event_type: "DEP",
          planned_time: plannedDep,
          actual_time: actualDep,
          late_minutes: lateDep,
          raw: loc,
        });
      }
    }

    if (!rows.length) {
      skipped.no_locations++;
      const { error: me } = await sb.from("darwin_messages").update({ processed_at: new Date().toISOString() }).eq("id", m.id);
      if (!me) messagesMarked++;
      else skipped.mark_error++;
      continue;
    }

    const { error: insErr } = await sb.from("darwin_events").insert(rows);
    if (insErr) {
      skipped.insert_error++;
      // do not mark processed; allow retry
      continue;
    }
    eventsInserted += rows.length;

    const { error: markErr } = await sb.from("darwin_messages").update({ processed_at: new Date().toISOString() }).eq("id", m.id);
    if (markErr) skipped.mark_error++;
    else messagesMarked++;
  }

  return { ok: true, examined, eventsInserted, messagesMarked, skipped, config: { MAX_MESSAGES, MAX_MS } };
}

async function main() {
  console.log("[processor] starting", { MAX_MESSAGES, MAX_MS, SLEEP_MS });

  let loop = 0;
  while (true) {
    loop++;
    try {
      const r = await processOnce();
      if (loop % LOG_EVERY === 0) {
        console.log("[processor]", r);
      }

      // If we processed nothing, back off a bit longer
      const didWork = (r.eventsInserted ?? 0) > 0 || (r.messagesMarked ?? 0) > 0;
      await sleep(didWork ? SLEEP_MS : Math.min(10000, SLEEP_MS * 2));
    } catch (e) {
      console.error("[processor] crash", e?.message || e);
      // backoff on errors
      await sleep(5000);
    }
  }
}

main().catch((e) => {
  console.error("[processor] fatal", e?.message || e);
  process.exit(1);
});
