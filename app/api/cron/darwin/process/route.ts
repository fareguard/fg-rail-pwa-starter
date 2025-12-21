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

function toTs(ssd: string | null, timeStr: string | null) {
  // ssd = "YYYY-MM-DD" (service start date)
  // timeStr = "HH:MM" or "HH:MM:SS"
  if (!ssd || !timeStr) return null;
  const tt = parseDarwinTime(timeStr);
  if (!tt) return null;
  // Create as UTC; Darwin feed is essentially UK local time, but in winter this matches UTC.
  // If you want BST-correctness later, we’ll do proper TZ conversion.
  const d = new Date(`${ssd}T00:00:00.000Z`);
  d.setUTCHours(tt.h, tt.m, tt.s, 0);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function minutesDiffIso(lateIso: string | null, earlyIso: string | null) {
  if (!lateIso || !earlyIso) return null;
  const a = new Date(lateIso);
  const b = new Date(earlyIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 60000);
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

    // Pull unprocessed messages
    const { data: msgs, error } = await db
      .from("darwin_messages")
      .select("id,received_at,topic,payload")
      .is("processed_at", null)
      .order("id", { ascending: true })
      .limit(MAX_MESSAGES);

    if (error) return json({ ok: false, error: error.message }, 500);

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
        // mark as processed so it doesn't loop forever
        const { error: me } = await db
          .from("darwin_messages")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", m.id);
        if (!me) messagesMarked++;
        else skipped.mark_error++;
        continue;
      }

      const decoded = mustParseJsonString(bytes);
      if (!decoded) {
        skipped.bad_json++;
        const { error: me } = await db
          .from("darwin_messages")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", m.id);
        if (!me) messagesMarked++;
        else skipped.mark_error++;
        continue;
      }

      const TS = decoded?.uR?.TS;
      if (!TS) {
        skipped.no_ts++;
        const { error: me } = await db
          .from("darwin_messages")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", m.id);
        if (!me) messagesMarked++;
        else skipped.mark_error++;
        continue;
      }

      const rid: string | null = TS.rid ?? null;
      const uid: string | null = TS.uid ?? null;
      const ssd: string | null = TS.ssd ?? null;
      const locs: any[] = Array.isArray(TS.Location) ? TS.Location : [];

      if (!locs.length) {
        skipped.no_locations++;
        const { error: me } = await db
          .from("darwin_messages")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", m.id);
        if (!me) messagesMarked++;
        else skipped.mark_error++;
        continue;
      }

      // Build events for this message
      const rows: any[] = [];

      for (const loc of locs) {
        const tiploc: string | null = loc.tpl ?? null;

        // scheduled times (public)
        const pta: string | null = loc.pta ?? null;
        const ptd: string | null = loc.ptd ?? null;

        // estimated/actual times
        const arrEt: string | null = loc.arr?.et ?? null;
        const depEt: string | null = loc.dep?.et ?? null;

        // NOTE: we don’t have CRS here yet (only TIPLOC). We’ll add a mapping table next.
        const crs: string | null = null;

        // ARR event
        const plannedArr = toTs(ssd, pta);
        const actualArr = toTs(ssd, arrEt);
        const lateArr = minutesDiffIso(actualArr, plannedArr);

        if (pta || arrEt) {
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

        // DEP event
        const plannedDep = toTs(ssd, ptd);
        const actualDep = toTs(ssd, depEt);
        const lateDep = minutesDiffIso(actualDep, plannedDep);

        if (ptd || depEt) {
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

      if (rows.length) {
        const { error: insErr } = await db.from("darwin_events").insert(rows);
        if (insErr) {
          skipped.insert_error++;
          // don't mark processed if we failed inserting; you want retry
          continue;
        }
        eventsInserted += rows.length;
      }

      // Mark message processed
      const { error: markErr } = await db
        .from("darwin_messages")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", m.id);

      if (markErr) skipped.mark_error++;
      else messagesMarked++;
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
