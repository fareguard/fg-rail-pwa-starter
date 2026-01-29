// workers/darwin-processor.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/**
 * =========================
 * Production-grade Darwin processor
 * - Newest-first processing
 * - Filters in Node (no fragile JSON-path filters)
 * - Handles TS(Location) as array OR object
 * - Handles uR.schedule[] (planned-only rows)
 * - Normalizes TIPLOC + CRS mapping
 * - darwin_events insert-only (ignore duplicates)
 * - darwin_service_calls upsert with column whitelist (no stray fields)
 * - ALWAYS marks messages processed even if inserts fail
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

// 3) Deploy sanity check (version marker)
console.log("[darwin-processor] version", "2026-01-29-c");

// Quick “wrong database” check (catches loads of issues)
console.log("[darwin-processor] boot", {
  supabaseHost: new URL(process.env.SUPABASE_URL).host,
  hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
});

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
  // Accept either TS(Location...) updates OR schedule-array messages
  return (
    typeof bytes === "string" &&
    ((bytes.includes('"uR"') && bytes.includes('"TS"') && bytes.includes('"Location"')) ||
      (bytes.includes('"uR"') &&
        bytes.includes('"schedule"') &&
        bytes.includes('"rid"') &&
        bytes.includes('"ssd"')))
  );
}

/**
 * Step 2 — “bulletproof” normalization helpers
 * Darwin payloads vary a lot across feeds/versions.
 */
function normalizeLocations(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object") return [x];
  return [];
}

function getSSD(decoded, TS) {
  // sometimes ssd is on TS, sometimes on uR, sometimes deeper
  return TS?.ssd ?? decoded?.uR?.ssd ?? null;
}

function getRID(TS) {
  return TS?.rid ?? TS?.RID ?? null;
}

function getUID(TS) {
  return TS?.uid ?? TS?.UID ?? null;
}

function getTIPLOC(loc) {
  // common variants: tpl, tiploc, tplx
  return loc?.tpl ?? loc?.tiploc ?? loc?.tplx ?? null;
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

// planned pass: wtp (working pass time) sometimes exists without pta/ptd
function plannedPassStr(loc) {
  return pickFirstString(loc?.ptp, loc?.wtp); // ptp is rare; wtp is common
}

// actual: prefer at then et then wet
function actualArrStr(loc) {
  return pickFirstString(loc?.arr?.at, loc?.arr?.et, loc?.arr?.wet);
}
function actualDepStr(loc) {
  return pickFirstString(loc?.dep?.at, loc?.dep?.et, loc?.dep?.wet);
}

// actual pass: pass.at / pass.et / pass.wet
function actualPassStr(loc) {
  return pickFirstString(loc?.pass?.at, loc?.pass?.et, loc?.pass?.wet);
}

// Step 2 patch: schedule[] + TS detection/helpers
function hasSchedule(j) {
  const s = j?.uR?.schedule;
  return Array.isArray(s) && s.length > 0;
}
function hasTS(j) {
  const L = j?.uR?.TS?.Location;
  return !!L;
}

// schedule locations can be OR, IP, DT, OPOR, OPDT, PP etc – we only care about those with tpl + times
function extractScheduleStops(sch) {
  const stops = [];

  // OR / DT are objects
  if (sch.OR) stops.push(sch.OR);
  if (sch.DT) stops.push(sch.DT);

  // IP can be object or array
  if (sch.IP) stops.push(...normalizeLocations(sch.IP));

  // Some schedules have OPOR/OPDT (non-passenger etc)
  if (sch.OPOR) stops.push(sch.OPOR);
  if (sch.OPDT) stops.push(sch.OPDT);

  return stops;
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
      // clear process_error when processed
      .update({ processed_at: nowIso(), process_error: null })
      .in("id", chunk);

    if (error) throw new Error("markProcessed failed: " + error.message);
    marked += chunk.length;
  }
  return marked;
}

// 1A) darwin_events: insert-only (ignore duplicates) on (msg_id, loc_index, event_type)
async function upsertEvents(rows) {
  if (!rows.length) return 0;

  // IMPORTANT: insert-only to avoid "affect row a second time" on big batches
  for (const chunk of chunkArray(rows, UPSERT_CHUNK)) {
    const { error } = await db.from("darwin_events").upsert(chunk, {
      onConflict: "msg_id,loc_index,event_type",
      ignoreDuplicates: true, // DO NOTHING instead of DO UPDATE
    });
    if (error) throw new Error("events_upsert: " + error.message);
  }
  return rows.length;
}

// 1B) darwin_service_calls: whitelist real columns (do NOT send stray fields)
async function upsertServiceCalls(callRows) {
  if (!callRows.length) return 0;

  const cleaned = callRows.map((r) => ({
    rid: r.rid ?? null,
    uid: r.uid ?? null,
    ssd: r.ssd ?? null,
    crs: r.crs ?? null,
    planned_arrive: r.planned_arrive ?? null,
    actual_arrive: r.actual_arrive ?? null,
    planned_depart: r.planned_depart ?? null,
    actual_depart: r.actual_depart ?? null,
    late_arrive_min: r.late_arrive_min ?? null,
    late_depart_min: r.late_depart_min ?? null,
    updated_at: r.updated_at ?? nowIso(),
  }));

  const { error } = await db
    .from("darwin_service_calls")
    .upsert(cleaned, { onConflict: "rid,crs,ssd" });

  if (error) throw new Error("calls_upsert: " + error.message);
  return cleaned.length;
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
  const callByKey = new Map(); // rid::crs::ssd -> merged call row

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

    const j = decoded;

    // 1) schedule[] messages: create planned calls
    if (hasSchedule(j)) {
      const schedArr = j.uR.schedule;

      for (const sch of schedArr) {
        if (Date.now() - started > MAX_RUN_MS) {
          stats.skipped.timebox++;
          break;
        }

        const rid = sch.rid ?? null;
        const uid = sch.uid ?? null;
        const ssd = sch.ssd ?? null;
        if (!rid || !ssd) continue;

        const stops = extractScheduleStops(sch);

        for (const loc of stops) {
          const tiploc = loc?.tpl ?? null;
          const tiploc_norm = normalizeTiplocNorm(tiploc);
          const crs = tiploc_norm ? (tiplocMap.get(tiploc_norm) ?? null) : null;
          if (!crs) continue; // only store stations

          const pta = plannedArrStr(loc);
          const ptd = plannedDepStr(loc);

          const plannedArr = toTs(ssd, pta);
          const plannedDep = toTs(ssd, ptd);

          // PK key includes ssd: rid::crs::ssd
          const key = `${rid}::${crs}::${ssd}`;
          const existing =
            callByKey.get(key) ?? { rid, uid, ssd, crs, updated_at: nowIso() };

          if (plannedArr) existing.planned_arrive = plannedArr;
          if (plannedDep) existing.planned_depart = plannedDep;

          existing.updated_at = nowIso();
          callByKey.set(key, existing);
        }
      }

      markIds.push(m.id);
      continue;
    }

    // 2) TS messages: update actual calls (and keep event insert logic)
    if (hasTS(j)) {
      const TS = j?.uR?.TS;
      if (!TS) {
        markIds.push(m.id);
        continue;
      }

      const rid = TS.rid ?? getRID(TS) ?? null;
      const uid = TS.uid ?? getUID(TS) ?? null;
      const ssd = TS.ssd ?? getSSD(j, TS) ?? null;

      const locs = normalizeLocations(TS.Location);
      if (!locs.length) {
        stats.skipped.no_locations++;
        markIds.push(m.id);
        continue;
      }

      for (let idx = 0; idx < locs.length; idx++) {
        const loc = locs[idx];

        const tiploc = getTIPLOC(loc);
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

        const ptp = plannedPassStr(loc);
        const passT = actualPassStr(loc);

        const plannedPass = toTs(ssd, ptp);
        const actualPass = toTs(ssd, passT);
        const latePass = minutesDiffIso(actualPass, plannedPass);

        if (ptp || passT) {
          eventRows.push({
            msg_id: m.id,
            loc_index: idx,
            received_at: m.received_at,
            tiploc,
            tiploc_norm,
            crs,
            rid,
            uid,
            event_type: "PASS",
            planned_time: plannedPass,
            actual_time: actualPass,
            late_minutes: latePass,
            raw: loc,
          });
        }

        // IMPORTANT: for calls, require rid+ssd+crs and key is rid::crs::ssd (PK is rid,crs,ssd)
        if (rid && ssd && crs) {
          const key = `${rid}::${crs}::${ssd}`;
          const existing =
            callByKey.get(key) ?? { rid, uid, ssd, crs, updated_at: nowIso() };

          const pta2 = plannedArrStr(loc);
          const ptd2 = plannedDepStr(loc);
          const arrT2 = actualArrStr(loc);
          const depT2 = actualDepStr(loc);

          const plannedArr2 = toTs(ssd, pta2);
          const actualArr2 = toTs(ssd, arrT2);
          const lateArr2 = minutesDiffIso(actualArr2, plannedArr2);

          const plannedDep2 = toTs(ssd, ptd2);
          const actualDep2 = toTs(ssd, depT2);
          const lateDep2 = minutesDiffIso(actualDep2, plannedDep2);

          if (plannedArr2 || actualArr2) {
            existing.planned_arrive = plannedArr2 ?? existing.planned_arrive ?? null;
            existing.actual_arrive = actualArr2 ?? existing.actual_arrive ?? null;
            existing.late_arrive_min = lateArr2 ?? existing.late_arrive_min ?? null;
          }
          if (plannedDep2 || actualDep2) {
            existing.planned_depart = plannedDep2 ?? existing.planned_depart ?? null;
            existing.actual_depart = actualDep2 ?? existing.actual_depart ?? null;
            existing.late_depart_min = lateDep2 ?? existing.late_depart_min ?? null;
          }

          existing.updated_at = nowIso();
          callByKey.set(key, existing);
        }
      }

      markIds.push(m.id);
      continue;
    }

    // anything else: just mark processed
    stats.skipped.no_ts++;
    markIds.push(m.id);
  }

  // 2) Critical: always mark messages processed even if inserts fail
  let insertErr = null;
  let callsErr = null;

  try {
    stats.eventsInserted = await upsertEvents(eventRows);
  } catch (e) {
    insertErr = e instanceof Error ? e : new Error(String(e));
    console.error("EVENT UPSERT ERROR:", insertErr?.message || insertErr);
    stats.ok = false;
    stats.skipped.insert_error++;
  }

  try {
    stats.callsUpserted = await upsertServiceCalls(Array.from(callByKey.values()));
  } catch (e) {
    callsErr = e instanceof Error ? e : new Error(String(e));
    console.error("SERVICE_CALLS UPSERT ERROR:", callsErr?.message || callsErr);
    stats.ok = false;
  }

  // still mark processed no matter what
  try {
    stats.messagesMarked = await markProcessed(markIds);
  } catch (e) {
    console.error("MARK PROCESSED ERROR:", e?.message || e);
    stats.ok = false;
    stats.skipped.mark_error++;
  }

  // optionally write process_error if insertErr/callsErr happened (best-effort)
  if (insertErr || callsErr) {
    const msg = [
      insertErr ? `events_upsert: ${insertErr.message}` : null,
      callsErr ? `calls_upsert: ${callsErr.message}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    try {
      await db.from("darwin_messages").update({ process_error: msg }).in("id", markIds);
    } catch (e) {
      console.error("PROCESS_ERROR UPDATE FAILED:", e?.message || e);
    }

    stats.ok = false;
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
    // heartbeat log per loop
    console.log("[darwin-processor] loop", { at: new Date().toISOString() });

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
