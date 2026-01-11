import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// ===== SECURITY GATE =====
const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

function isAuthorized(req: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  const hdr = req.headers.get("x-admin-key") || "";
  return hdr === ADMIN_KEY;
}

// ===== CONFIG =====
const MAX_MESSAGES = Number(process.env.DARWIN_PROCESS_MAX_MESSAGES ?? "200");
const MAX_MS = Number(process.env.DARWIN_PROCESS_MAX_MS ?? "15000");

// ===== utils =====
function json(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

function mustParseJsonString(s: any) {
  if (typeof s !== "string" || !s.trim()) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ===== 2.1 helpers (top of file) =====
function pickFirstString(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// planned: prefer public (pt*) else working (wt*)
function plannedArrStr(loc: any): string | null {
  return pickFirstString(loc?.pta, loc?.wta);
}
function plannedDepStr(loc: any): string | null {
  return pickFirstString(loc?.ptd, loc?.wtd);
}

// actual/estimated: prefer actual time (at) else estimate (et) else working estimate (wet)
function actualArrStr(loc: any): string | null {
  return pickFirstString(loc?.arr?.at, loc?.arr?.et, loc?.arr?.wet);
}
function actualDepStr(loc: any): string | null {
  return pickFirstString(loc?.dep?.at, loc?.dep?.et, loc?.dep?.wet);
}

// Darwin time fields are like "20:55" or "21:01:30"
function parseDarwinTime(t: any): { h: number; m: number; s: number } | null {
  if (!t || typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
  return { h: hh, m: mm, s: ss };
}

// ===== Drop-in helpers (NEW) =====
function parseIso(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function absMs(a: Date, b: Date) {
  const x = a.getTime() - b.getTime();
  return x < 0 ? -x : x;
}

function toIsoAtOffset(ssd: string, timeStr: string, dayOffset: number): string | null {
  const tt = parseDarwinTime(timeStr);
  if (!tt) return null;

  const base = new Date(`${ssd}T00:00:00.000Z`);
  if (isNaN(base.getTime())) return null;

  base.setUTCDate(base.getUTCDate() + dayOffset);
  base.setUTCHours(tt.h, tt.m, tt.s, 0);

  return isNaN(base.getTime()) ? null : base.toISOString();
}

/**
 * Picks best dayOffset among candidates to minimize absolute difference to refTime.
 * If refTime is null, returns null and you can fall back to monotonic only.
 */
function pickBestOffsetByRef(
  ssd: string,
  timeStr: string,
  refTime: Date | null,
  offsets: number[]
): { iso: string; dayOffset: number } | null {
  if (!refTime) return null;

  let best: { iso: string; dayOffset: number } | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const off of offsets) {
    const iso = toIsoAtOffset(ssd, timeStr, off);
    if (!iso) continue;

    const d = new Date(iso);
    const dist = absMs(d, refTime);
    if (dist < bestDist) {
      bestDist = dist;
      best = { iso, dayOffset: off };
    }
  }
  return best;
}

// ===== sequence-aware monotonic helpers (below parseDarwinTime) =====
function minutesOfDay(t: string | null): number | null {
  if (!t) return null;
  const tt = parseDarwinTime(t);
  if (!tt) return null;
  return tt.h * 60 + tt.m; // seconds ignored for monotonic decision (safe)
}

// (kept for backward compatibility; now prefer toIsoAtOffset)
function isoAtSsdWithDayOffset(ssd: string, timeStr: string, dayOffset: number): string | null {
  return toIsoAtOffset(ssd, timeStr, dayOffset);
}

type RolloverState = {
  dayOffset: number;
  lastAbsMin: number | null; // abs minutes since ssd start
};

/**
 * Enforce monotonic time across locations:
 * - choose a "reference" minute for rollover decisions (planned preferred, else actual)
 * - if reference would go backwards meaningfully, roll dayOffset forward until it doesn't
 *
 * thresholdBackwardsMin:
 *   allows small reorder/noise without rolling day (e.g. passing times, suppressed, etc.)
 */
function applyMonotonicRollover(
  state: RolloverState,
  refMinOfDay: number | null,
  thresholdBackwardsMin = 60
) {
  if (refMinOfDay == null) return;

  let candidateAbs = state.dayOffset * 1440 + refMinOfDay;

  if (state.lastAbsMin != null) {
    // While it goes backwards beyond threshold, roll forward by 1 day
    while (candidateAbs < state.lastAbsMin - thresholdBackwardsMin) {
      state.dayOffset += 1;
      candidateAbs += 1440;
    }
  }

  // Update lastAbsMin to the candidate abs time (monotonic anchor)
  state.lastAbsMin = candidateAbs;
}

function minutesDiffIso(lateIso: string | null, earlyIso: string | null) {
  if (!lateIso || !earlyIso) return null;
  const a = new Date(lateIso);
  const b = new Date(earlyIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

// NEW: smart TS chooser: closest-to-message-time with monotonic offset fallback
function toTsSmart(
  ssd: string | null,
  timeStr: string | null,
  msgRef: Date | null,
  rollover: RolloverState
) {
  if (!ssd || !timeStr) return null;

  // Prefer staying on current offset, but allow +1 day if closer to msgRef
  // (solves isolated midnight fragments cleanly)
  if (msgRef) {
    const best = pickBestOffsetByRef(ssd, timeStr, msgRef, [
      rollover.dayOffset,
      rollover.dayOffset + 1,
    ]);
    if (best) return best.iso;
  }

  // fallback
  return toIsoAtOffset(ssd, timeStr, rollover.dayOffset);
}

// ===== 2.3 CRS cache / map =====
let TIPLOC_TO_CRS: Map<string, string> | null = null;

async function loadTiplocMap(db: any) {
  if (TIPLOC_TO_CRS) return TIPLOC_TO_CRS;

  const { data, error } = await db.from("tiploc_crs").select("tiploc, crs");

  if (error) throw new Error("Failed loading tiploc_crs: " + error.message);

  const m = new Map<string, string>();
  for (const r of data || []) {
    const k = String(r.tiploc || "").trim().toUpperCase();
    const v = r.crs ? String(r.crs).trim().toUpperCase() : "";
    if (k && v) m.set(k, v);
  }

  TIPLOC_TO_CRS = m;
  return m;
}

// ===== Drop-in helpers =====
function looksLikeSchedule(bytes: string) {
  // ultra-cheap prefilter: avoids JSON.parse for heartbeat/failure/etc
  return (
    bytes.includes('"uR"') &&
    bytes.includes('"TS"') &&
    bytes.includes('"ssd":"') &&
    bytes.includes('"Location"')
  );
}

function normalizeLocations(loc: any): any[] {
  if (!loc) return [];
  if (Array.isArray(loc)) return loc;
  if (typeof loc === "object") return [loc]; // IMPORTANT: sometimes Location is an object
  return [];
}

// IMPORTANT: normalize tiploc in code so we can upsert on a real column (tiploc_norm)
function normalizeTiplocNorm(tiploc: any): string | null {
  if (typeof tiploc !== "string") return null;
  const v = tiploc.trim().toUpperCase();
  return v ? v : null;
}

type DarwinMsgRow = {
  id: number;
  received_at: string;
  topic: string;
  payload: any;
};

export async function GET(req: Request) {
  const started = Date.now();
  try {
    if (!isAuthorized(req)) return NextResponse.json({ ok: false }, { status: 404 });

    const db = getSupabaseAdmin();

    // Pull unprocessed messages (NEWEST FIRST). Do not call darwin_messages_ready.
    const { data: msgs, error } = await db
      .from("darwin_messages")
      .select("id,received_at,topic,payload")
      .is("processed_at", null)
      .order("received_at", { ascending: false }) // NEWEST FIRST
      .limit(MAX_MESSAGES);

    if (error) return json({ ok: false, error: error.message }, 500);

    let examined = 0;
    let eventsInserted = 0;
    let messagesMarked = 0;

    const markIds: number[] = [];

    const skipped = {
      no_bytes: 0,
      bad_json: 0,
      no_ts: 0,
      no_rid: 0,
      no_locations: 0,
      insert_error: 0,
      mark_error: 0,
      timebox: 0,
      not_schedule: 0,
    };

    for (const m of (msgs || []) as DarwinMsgRow[]) {
      if (Date.now() - started > MAX_MS) {
        skipped.timebox++;
        break;
      }

      examined++;

      const bytes = m.payload?.bytes;

      if (!bytes) {
        skipped.no_bytes++;
        markIds.push(m.id);
        continue;
      }

      if (!looksLikeSchedule(bytes)) {
        skipped.not_schedule++;
        markIds.push(m.id);
        continue;
      }

      const decoded = mustParseJsonString(bytes);
      if (!decoded) {
        skipped.bad_json++;
        markIds.push(m.id);
        continue;
      }

      // ===== 3) capture a reference time per message (NEW) =====
      const msgTsIso: string | null = typeof decoded?.ts === "string" ? decoded.ts : null;
      const msgRef = parseIso(msgTsIso) ?? parseIso(m.received_at) ?? null;

      // ===== FAST-PATH: non-TS messages =====
      const TS = decoded?.uR?.TS;
      if (!TS) {
        skipped.no_ts++;
        markIds.push(m.id);
        continue;
      }
      // ====================================

      const rid: string | null = TS.rid ?? null;
      const uid: string | null = TS.uid ?? null;
      const ssd: string | null = TS.ssd ?? null;

      // Production-grade rule: if there is no rid, nothing is matchable
      if (!rid) {
        skipped.no_rid++;
        markIds.push(m.id);
        continue;
      }

      // Step 1A — accept Location as array OR single object
      const locs: any[] = normalizeLocations(TS.Location);

      if (!locs.length) {
        skipped.no_locations++;
        markIds.push(m.id);
        continue;
      }

      const rows: any[] = [];

      // 2.4 collect service call rows (merged per rid+crs)
      const callByKey = new Map<string, any>();

      // load CRS map once per message (cached in memory globally)
      const tiplocMap = await loadTiplocMap(db);

      // ===== 4) Initialize rollover dayOffset using first usable time (NEW) =====
      const rollover: RolloverState = { dayOffset: 0, lastAbsMin: null };

      let firstTimeStr: string | null = null;
      for (const loc of locs) {
        firstTimeStr = pickFirstString(
          plannedArrStr(loc),
          plannedDepStr(loc),
          actualArrStr(loc),
          actualDepStr(loc)
        );
        if (firstTimeStr) break;
      }

      if (ssd && firstTimeStr && msgRef) {
        const best = pickBestOffsetByRef(ssd, firstTimeStr, msgRef, [0, 1, 2]);
        if (best) rollover.dayOffset = best.dayOffset;
      }

      for (let idx = 0; idx < locs.length; idx++) {
        const loc = locs[idx];

        const tiploc: string | null = loc.tpl ?? null;
        const tiploc_norm: string | null = normalizeTiplocNorm(tiploc);

        const crs = tiploc_norm ? tiplocMap.get(tiploc_norm) ?? null : null;

        // --- ARR ---
        const pta = plannedArrStr(loc);
        const arrT = actualArrStr(loc);

        const refArrMin = minutesOfDay(pta) ?? minutesOfDay(arrT);
        if (ssd && refArrMin != null) {
          applyMonotonicRollover(rollover, refArrMin);
        }

        // ===== 5) smart conversion (NEW) =====
        const plannedArr = toTsSmart(ssd, pta, msgRef, rollover);
        const actualArr = toTsSmart(ssd, arrT, msgRef, rollover);

        const lateArr = minutesDiffIso(actualArr, plannedArr);

        if (pta || arrT) {
          rows.push({
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

        // --- DEP ---
        const ptd = plannedDepStr(loc);
        const depT = actualDepStr(loc);

        const refDepMin = minutesOfDay(ptd) ?? minutesOfDay(depT);
        if (ssd && refDepMin != null) {
          applyMonotonicRollover(rollover, refDepMin);
        }

        // ===== 5) smart conversion (NEW) =====
        const plannedDep = toTsSmart(ssd, ptd, msgRef, rollover);
        const actualDep = toTsSmart(ssd, depT, msgRef, rollover);

        const lateDep = minutesDiffIso(actualDep, plannedDep);

        if (ptd || depT) {
          rows.push({
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

        // 2.4 Upsert into darwin_service_calls (merge ARR/DEP into one row per rid+crs)
        // Same rule: only write/update fields that have a planned_* anchor.
        if (crs) {
          const key = `${rid}::${crs}`;
          const existing =
            callByKey.get(key) ??
            ({
              rid,
              uid,
              ssd,
              crs,
              updated_at: new Date().toISOString(),
            } as any);

          // ARR (only if plannedArr exists)
          if (plannedArr) {
            existing.planned_arrive = plannedArr ?? existing.planned_arrive ?? null;
            existing.actual_arrive = actualArr ?? existing.actual_arrive ?? null;
            existing.late_arrive_min = lateArr ?? existing.late_arrive_min ?? null;
          }

          // DEP (only if plannedDep exists)
          if (plannedDep) {
            existing.planned_depart = plannedDep ?? existing.planned_depart ?? null;
            existing.actual_depart = actualDep ?? existing.actual_depart ?? null;
            existing.late_depart_min = lateDep ?? existing.late_depart_min ?? null;
          }

          existing.updated_at = new Date().toISOString();
          callByKey.set(key, existing);
        }
      }

      if (rows.length) {
        // Upsert on your *real* uniqueness key (rid,tiploc_norm,event_type,planned_time)
        // and ignore duplicates so the worker never fails on replays/overlaps.
        const { error: insErr } = await db.from("darwin_events").upsert(rows, {
          onConflict: "rid,tiploc_norm,event_type,planned_time",
          ignoreDuplicates: true,
        });

        if (insErr) {
          skipped.insert_error++;
          // still mark message processed so we don't hot-loop it forever
          markIds.push(m.id);
          continue;
        }
        eventsInserted += rows.length;
      }

      // 2.4 service_calls upsert
      const callRows = Array.from(callByKey.values());
      if (callRows.length) {
        const { error: upErr } = await db
          .from("darwin_service_calls")
          .upsert(callRows, { onConflict: "rid,crs,ssd" });

        if (upErr) console.error("service_calls upsert error", upErr.message);
      }

      markIds.push(m.id);
    }

    // Step 5 — production-grade bulk marking
    if (markIds.length) {
      const { error: me } = await db
        .from("darwin_messages")
        .update({ processed_at: new Date().toISOString() })
        .in("id", markIds);

      if (!me) messagesMarked += markIds.length;
      else skipped.mark_error += markIds.length;
    }

    return json({
      ok: true,
      examined,
      eventsInserted,
      messagesMarked,
      skipped,
      config: { MAX_MESSAGES, MAX_MS },
    });
  } catch (e: any) {
    console.error("[darwin process] error", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
