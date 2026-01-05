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

function minutesDiffIso(lateIso: string | null, earlyIso: string | null) {
  if (!lateIso || !earlyIso) return null;
  const a = new Date(lateIso);
  const b = new Date(earlyIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 60000);
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

function parseYMD(ymd: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function londonWallTimeToUtcIso(ssd: string, dayOffset: number, timeStr: string) {
  const ymd = parseYMD(ssd);
  const tt = parseDarwinTime(timeStr);
  if (!ymd || !tt) return null;

  const baseUtc = new Date(Date.UTC(ymd.y, ymd.mo - 1, ymd.d + dayOffset, tt.h, tt.m, tt.s, 0));

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(baseUtc).reduce((acc: any, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});

  const desiredUtcAsIf = Date.UTC(ymd.y, ymd.mo - 1, ymd.d + dayOffset, tt.h, tt.m, tt.s, 0);
  const actualLondonAsIf = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    0
  );

  const deltaMs = desiredUtcAsIf - actualLondonAsIf;
  const corrected = new Date(baseUtc.getTime() + deltaMs);

  return isNaN(corrected.getTime()) ? null : corrected.toISOString();
}

function pickTime(...candidates: Array<string | null | undefined>) {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function minutesOfDay(t: string) {
  const p = parseDarwinTime(t);
  if (!p) return null;
  return p.h * 60 + p.m + (p.s ? p.s / 60 : 0);
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
      .not("payload->>bytes", "is", null) // ensures bytes exists
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

      // Step 1A — accept Location as array OR single object
      const locs: any[] = normalizeLocations(TS.Location);

      if (!locs.length) {
        skipped.no_locations++;
        markIds.push(m.id);
        continue;
      }

      const rows: any[] = [];

      let dayOffset = 0;
      let lastMin: number | null = null;

      for (let idx = 0; idx < locs.length; idx++) {
        const loc = locs[idx];

        const tiploc: string | null = loc.tpl ?? null;

        // Optional but smart — if pta/ptd missing, fall back to wta/wtd
        const pta = pickTime(loc.pta, loc.wta);
        const ptd = pickTime(loc.ptd, loc.wtd);

        // Step 4 — accept arr.at / dep.at as well as arr.et / dep.et
        const arrTime: string | null = loc.arr?.at ?? loc.arr?.et ?? null;
        const depTime: string | null = loc.dep?.at ?? loc.dep?.et ?? null;

        const anchor = pickTime(pta, ptd, arrTime, depTime);
        const anchorMin = anchor ? minutesOfDay(anchor) : null;

        if (anchorMin != null && lastMin != null) {
          if (anchorMin < lastMin - 180) dayOffset++;
        }
        if (anchorMin != null) lastMin = anchorMin;

        const plannedArr = ssd
          ? londonWallTimeToUtcIso(ssd, dayOffset, pta ?? loc.wta ?? null)
          : null;
        const actualArr = ssd && arrTime ? londonWallTimeToUtcIso(ssd, dayOffset, arrTime) : null;
        const lateArr = minutesDiffIso(actualArr, plannedArr);

        if (pta || loc.wta || arrTime) {
          rows.push({
            msg_id: m.id,
            loc_index: idx,
            received_at: m.received_at,
            tiploc,
            crs: null,
            rid,
            uid,
            event_type: "ARR",
            planned_time: plannedArr,
            actual_time: actualArr,
            late_minutes: lateArr,
            raw: loc,
          });
        }

        const plannedDep = ssd
          ? londonWallTimeToUtcIso(ssd, dayOffset, ptd ?? loc.wtd ?? null)
          : null;
        const actualDep = ssd && depTime ? londonWallTimeToUtcIso(ssd, dayOffset, depTime) : null;
        const lateDep = minutesDiffIso(actualDep, plannedDep);

        if (ptd || loc.wtd || depTime) {
          rows.push({
            msg_id: m.id,
            loc_index: idx,
            received_at: m.received_at,
            tiploc,
            crs: null,
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

      if (rows.length) {
        const { error: insErr } = await db
          .from("darwin_events")
          .upsert(rows, { onConflict: "msg_id,loc_index,event_type" });

        if (insErr) {
          skipped.insert_error++;
          // still mark message processed so we don't hot-loop it forever
          markIds.push(m.id);
          continue;
        }
        eventsInserted += rows.length;
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
