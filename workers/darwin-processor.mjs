// workers/darwin-processor.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/**
 * =========================
 * Production-grade Darwin processor
 * - Newest-first processing
 * - Filters in Node (no fragile JSON-path filters)
 * - Handles Location as array OR object
 * - Normalizes TIPLOC + CRS mapping
 * - Upserts darwin_events on unique key
 * - Upserts darwin_service_calls (rid+crs)
 * - Bulk marks processed
 * - Backoff + jitter to avoid thrash
 * =========================
 */

// ---- ENV ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Tuning
const LOOP_SLEEP_MS = Number(process.env.DARWIN_PROCESS_LOOP_SLEEP_MS ?? "750"); // small delay per loop
const MAX_MESSAGES = Number(process.env.DARWIN_PROCESS_MAX_MESSAGES ?? "200");
const MAX_RUN_MS = Number(process.env.DARWIN_PROCESS_MAX_MS ?? "15000"); // timebox per loop
const MARK_CHUNK = Number(process.env.DARWIN_MARK_CHUNK ?? "2000"); // update processed_at in chunks
const UPSERT_CHUNK = Number(process.env.DARWIN_UPSERT_CHUNK ?? "2000"); // upsert events in chunks

// Mapping cache refresh
const MAP_TTL_MS = Number(process.env.DARWIN_TIPLOC_MAP_TTL_MS ?? String(10 * 60 * 1000)); // 10 mins

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- tiny utils ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function safeJsonParse(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Cheap prefilter (avoid parsing heartbeats/failures/etc)
function looksLikeSchedule(bytes) {
  return (
    bytes.includes('"uR"') &&
    bytes.includes('"TS"') &&
    bytes.includes('"ssd":"') &&
    bytes.includes('"Location"')
  );
}

function normalizeLocations(loc) {
  if (!loc) return [];
  if (Array.isArray(loc)) return loc;
  if (typeof loc === "object") return [loc];
  return [];
}

function normalizeTiplocNorm(tiploc) {
  if (typeof tiploc !== "string") return null;
  const v = tiploc.trim().toUpperCase();
  return v ? v : null;
}

function pickFirstString(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// planned: prefer public pt* else working wt*
function plannedArrStr(loc) {
  return pickFirstString(loc?.pta, loc?.wta);
}
function plannedDepStr(loc) {
  return pickFirstString(loc?.ptd, loc?.wtd);
}

// actual: prefer at then et then wet
function actualArrStr(loc) {
  return pickFirstString(loc?.arr?.at, loc?.arr?.et, loc?.arr?.wet);
}
function actualDepStr(loc) {
  return pickFirstString(loc?.dep?.at, loc?.dep?.et, loc?.dep?.wet);
}

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

/**
 * Conservative midnight rollover:
 * if hh < 3, treat as next-day continuation (common in Darwin schedules)
 */
function toTs(ssd, timeStr) {
  if (!ssd || !timeStr) return null;
  const tt = parseDarwinTime(timeStr);
  if (!tt) return null;

  const base = new Date(`${ssd}T00:00:00.000Z`);
  if (isNaN(base.getTime())) return null;

  const d = new Date(base);
  d.setUTCHours(tt.h, tt.m, tt.s, 0);

  if (tt.h < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function minutesDiffIso(lateIso, earlyIso) {
  if (!lateIso || !earlyIso) return null;
  const a = new Date(lateIso);
  const b = new Date(earlyIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

// ---- TIPLOC->CRS map cache ----
let TIPLOC_TO_CRS = null;
let TIPLOC_TO_CRS_LOADED_AT = 0;

async function loadTiplocMap() {
  const now = Date.now();
  if (TIPLOC_TO_CRS && now - TIPLOC_TO_CRS_LOADED_AT < MAP_TTL_MS) {
    return TIPLOC_TO_CRS;
  }

  // Load minimal fields only
  const { data, error } = await db.from("tiploc_crs").select("tiploc, crs");
  if (error) throw new Error("Failed loading tiploc_crs: " + error.message);

  const m = new Map();
  for (const r of data || []) {
    const k = String(r.tiploc || "").trim().toUpperCase();
    const v = r.crs ? String(r.crs).trim().toUpperCase() : "";
    if (k && v) m.set(k, v);
  }
  TIPLOC_TO_CRS = m;
  TIPLOC_TO_CRS_LOADED_AT = now;
  return m;
}

// ---- chunk helpers ----
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---- main processing ----
async function fetchMessagesNewestFirst(limit) {
  // IMPORTANT: no JSON-path filters here (production-grade robustness)
  return await db
    .from("darwin_messages")
    .select("id,received_at,topic,payload")
    .is("processed_at", null)
    .order("received_at", { ascending: false })
    .limit(limit);
}

async function markProcessed(ids) {
  if (!ids.length) return 0;
  let marked = 0;

  for (const chunk of chunkArray(ids, MARK_CHUNK)) {
    const { error } = await db
      .from("darwin_messages")
      .update({ processed_at: nowIso() })
      .in("id", chunk);
    if (error) throw new Error("markProcessed failed: " + error.message);
    marked += chunk.length;
  }
  return marked;
}

async function upsertEvents(rows) {
  if (!rows.length) return 0;
  let up = 0;

  for (const chunk of chunkArray(rows, UPSERT_CHUNK)) {
    const { error } = await db.from("darwin_events").upsert(chunk, {
      onConflict: "rid,tiploc_norm,event_type,planned_time",
      ignoreDuplicates: true,
    });
    if (error) throw new Error("darwin_events upsert failed: " + error.message);
    up += chunk.length;
  }
  return up;
}

async function upsertServiceCalls(callRows) {
  if (!callRows.length) return 0;
  // usually small; no need to chunk unless you want
  const { error } = await db
    .from("darwin_service_calls")
    .upsert(callRows, { onConflict: "rid,crs" });
  if (error) throw new Error("darwin_service_calls upsert failed: " + error.message);
  return callRows.length;
}

async function processOnce() {
  const started = Date.now();

  const stats = {
    ok: true,
    examined: 0,
    eventsInserted: 0,
    callsUpserted: 0,
    messagesMarked: 0,
    skipped: {
      no_bytes: 0,
      bad_json: 0,
      not_schedule: 0,
      no_ts: 0,
      no_locations: 0,
      insert_error: 0,
      mark_error: 0,
      timebox: 0,
    },
    config: { MAX_MESSAGES, MAX_RUN_MS },
  };

  const { data: msgs, error } = await fetchMessagesNewestFirst(MAX_MESSAGES);
  if (error) throw new Error("fetch messages failed: " + error.message);

  const tiplocMap = await loadTiplocMap();

  const markIds = [];
  const eventRows = [];
  const callByKey = new Map(); // rid::crs -> merged row

  for (const m of msgs || []) {
    if (Date.now() - started > MAX_RUN_MS) {
      stats.skipped.timebox++;
      break;
    }

    stats.examined++;

    const bytes = m.payload?.bytes;
    if (!bytes) {
      stats.skipped.no_bytes++;
      markIds.push(m.id);
      continue;
    }

    if (!looksLikeSchedule(bytes)) {
      stats.skipped.not_schedule++;
      markIds.push(m.id);
      continue;
    }

    const decoded = safeJsonParse(bytes);
    if (!decoded) {
      stats.skipped.bad_json++;
      markIds.push(m.id);
      continue;
    }

    const TS = decoded?.uR?.TS;
    if (!TS) {
      stats.skipped.no_ts++;
      markIds.push(m.id);
      continue;
    }

    const rid = TS.rid ?? null;
    const uid = TS.uid ?? null;
    const ssd = TS.ssd ?? null;

    const locs = normalizeLocations(TS.Location);
    if (!locs.length) {
      stats.skipped.no_locations++;
      markIds.push(m.id);
      continue;
    }

    for (let idx = 0; idx < locs.length; idx++) {
      const loc = locs[idx];

      const tiploc = loc.tpl ?? null;
      const tiploc_norm = normalizeTiplocNorm(tiploc);
      const crs = tiploc_norm ? (tiplocMap.get(tiploc_norm) ?? null) : null;

      const pta = plannedArrStr(loc);
      const ptd = plannedDepStr(loc);
      const arrT = actualArrStr(loc);
      const depT = actualDepStr(loc);

      const plannedArr = toTs(ssd, pta);
      const actualArr = toTs(ssd, arrT);
      const lateArr = minutesDiffIso(actualArr, plannedArr);

      if (pta || arrT) {
        eventRows.push({
          msg_id: m.id,
          loc_index: idx,
          received_at: m.received_at,
          tiploc,
          tiploc_norm,
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

      const plannedDep = toTs(ssd, ptd);
      const actualDep = toTs(ssd, depT);
      const lateDep = minutesDiffIso(actualDep, plannedDep);

      if (ptd || depT) {
        eventRows.push({
          msg_id: m.id,
          loc_index: idx,
          received_at: m.received_at,
          tiploc,
          tiploc_norm,
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

      // Merge ARR/DEP into one row per rid+crs
      if (rid && crs) {
        const key = `${rid}::${crs}`;
        const existing =
          callByKey.get(key) ??
          ({
            rid,
            uid,
            ssd,
            crs,
            updated_at: nowIso(),
          });

        if (plannedArr || actualArr) {
          existing.planned_arrive = plannedArr ?? existing.planned_arrive ?? null;
          existing.actual_arrive = actualArr ?? existing.actual_arrive ?? null;
          existing.late_arrive_min = lateArr ?? existing.late_arrive_min ?? null;
        }

        if (plannedDep || actualDep) {
          existing.planned_depart = plannedDep ?? existing.planned_depart ?? null;
          existing.actual_depart = actualDep ?? existing.actual_depart ?? null;
          existing.late_depart_min = lateDep ?? existing.late_depart_min ?? null;
        }

        existing.updated_at = nowIso();
        callByKey.set(key, existing);
      }
    }

    // We always mark processed for schedule messages we handled
    markIds.push(m.id);
  }

  // Upserts
  try {
    stats.eventsInserted = await upsertEvents(eventRows);
  } catch (e) {
    stats.ok = false;
    stats.skipped.insert_error++;
    console.error("EVENT UPSERT ERROR:", e?.message || e);
    // still try marking processed to avoid hot-looping on poison messages
  }

  try {
    stats.callsUpserted = await upsertServiceCalls(Array.from(callByKey.values()));
  } catch (e) {
    stats.ok = false;
    console.error("SERVICE_CALLS UPSERT ERROR:", e?.message || e);
  }

  // Mark processed
  try {
    stats.messagesMarked = await markProcessed(markIds);
  } catch (e) {
    stats.ok = false;
    stats.skipped.mark_error++;
    console.error("MARK PROCESSED ERROR:", e?.message || e);
  }

  return stats;
}

// ---- loop runner ----
async function main() {
  console.log("[darwin-processor] starting", {
    MAX_MESSAGES,
    MAX_RUN_MS,
    LOOP_SLEEP_MS,
    MAP_TTL_MS,
  });

  // Soft backoff on errors
  let backoff = 250;

  while (true) {
    try {
      const stats = await processOnce();
      console.log("[darwin-processor] tick", stats);
      backoff = 250;
    } catch (e) {
      console.error("[darwin-processor] fatal tick error:", e?.message || e);
      // Backoff with jitter
      const jitter = Math.floor(Math.random() * 250);
      await sleep(Math.min(10_000, backoff + jitter));
      backoff = Math.min(10_000, backoff * 2);
    }

    await sleep(LOOP_SLEEP_MS);
  }
}

main().catch((e) => {
  console.error("[darwin-processor] crashed:", e?.message || e);
  process.exit(1);
});
