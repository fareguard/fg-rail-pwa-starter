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

// ===== monotonic helpers (DROP-IN) =====
type RollCtx = {
  // last timestamp we emitted for this RID (planned timeline)
  lastPlannedMs: number | null;
  // last timestamp we emitted for this RID (actual timeline)
  lastActualMs: number | null;
};

// parse time string -> ms at base date
function buildMs(ssd: string, timeStr: string): number | null {
  const tt = parseDarwinTime(timeStr);
  if (!tt) return null;
  const base = new Date(`${ssd}T00:00:00.000Z`);
  if (isNaN(base.getTime())) return null;
  base.setUTCHours(tt.h, tt.m, tt.s, 0);
  return base.getTime();
}

// “monotonic bump”: if time goes backwards, roll forward by +1 day until it doesn’t
function monotonicIso(
  ctx: RollCtx,
  kind: "planned" | "actual",
  ssd: string | null,
  timeStr: string | null,
  // tolerance: allow tiny backwards jitter without rolling
  backwardsToleranceMs = 2 * 60 * 1000
): string | null {
  if (!ssd || !timeStr) return null;

  let ms = buildMs(ssd, timeStr);
  if (ms == null) return null;

  const last = kind === "planned" ? ctx.lastPlannedMs : ctx.lastActualMs;

  if (last != null) {
    // If the candidate is “meaningfully” behind last, roll forward by +1 day until it’s >= last - tolerance
    while (ms < last - backwardsToleranceMs) {
      ms += 24 * 60 * 60 * 1000;

      // hard safety: prevent runaway (should never need >2 rolls)
      if (ms - last > 3 * 24 * 60 * 60 * 1000) break;
    }
  }

  if (kind === "planned") ctx.lastPlannedMs = ms;
  else ctx.lastActualMs = ms;

  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function minutesDiffIso(lateIso: string | null, earlyIso: string | null) {
  if (!lateIso || !earlyIso) return null;
  const a = new Date(lateIso);
  const b = new Date(earlyIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

// ===== NEW helper (add near your other helpers) =====
function applyMonotonicRollover(
  items: { planned_time: string | null; actual_time: string | null }[]
) {
  let plannedOffsetDays = 0;
  let actualOffsetDays = 0;

  let prevPlanned: Date | null = null;
  let prevActual: Date | null = null;

  for (const it of items) {
    if (it.planned_time) {
      const d0 = new Date(it.planned_time);
      if (!isNaN(d0.getTime())) {
        const d = new Date(d0.getTime());
        d.setUTCDate(d.getUTCDate() + plannedOffsetDays);

        if (prevPlanned && d.getTime() < prevPlanned.getTime()) {
          // rollover detected
          plannedOffsetDays += 1;
          d.setUTCDate(d.getUTCDate() + 1);
        }

        it.planned_time = d.toISOString();
        prevPlanned = d;
      }
    }

    if (it.actual_time) {
      const a0 = new Date(it.actual_time);
      if (!isNaN(a0.getTime())) {
        const a = new Date(a0.getTime());
        a.setUTCDate(a.getUTCDate() + actualOffsetDays);

        if (prevActual && a.getTime() < prevActual.getTime()) {
          actualOffsetDays += 1;
          a.setUTCDate(a.getUTCDate() + 1);
        }

        it.actual_time = a.toISOString();
        prevActual = a;
      }
    }
  }
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

      // ===== Monotonic ctx per message (per RID) =====
      const ctx: RollCtx = { lastPlannedMs: null, lastActualMs: null };

      for (let idx = 0; idx < locs.length; idx++) {
        const loc = locs[idx];

        const tiploc: string | null = loc.tpl ?? null;
        const tiploc_norm: string | null = normalizeTiplocNorm(tiploc);

        const crs = tiploc_norm ? tiplocMap.get(tiploc_norm) ?? null : null;

        // --- ARR ---
        const pta = plannedArrStr(loc);
        const arrT = actualArrStr(loc);

        // IMPORTANT: planned first, then actual (each has its own monotonic chain)
        const plannedArr = monotonicIso(ctx, "planned", ssd, pta);
        const actualArr = monotonicIso(ctx, "actual", ssd, arrT);

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

        const plannedDep = monotonicIso(ctx, "planned", ssd, ptd);
        const actualDep = monotonicIso(ctx, "actual", ssd, depT);

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

      // ===== APPLY requested sorting + monotonic rollover (before upsert) =====
      if (rows.length) {
        rows.sort(
          (a, b) =>
            (a.loc_index ?? 0) - (b.loc_index ?? 0) ||
            (a.event_type > b.event_type ? 1 : -1)
        );
        applyMonotonicRollover(rows);

        // recompute late_minutes after rollover-adjusted ISO timestamps
        for (const r of rows) {
          r.late_minutes = minutesDiffIso(r.actual_time ?? null, r.planned_time ?? null);
        }

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
      // ================================================================

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
