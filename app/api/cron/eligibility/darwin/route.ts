import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

function isAuthorized(req: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  return (req.headers.get("x-admin-key") || "") === ADMIN_KEY;
}

function json(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}

const WINDOW_PAST_HOURS = Number(process.env.ELIG_WINDOW_PAST_HOURS ?? "6");
const WINDOW_FUTURE_HOURS = Number(process.env.ELIG_WINDOW_FUTURE_HOURS ?? "48");
const ARRIVAL_BUFFER_MIN = Number(process.env.ELIG_ARRIVAL_BUFFER_MIN ?? "20");
const MIN_DELAY_MINUTES = Number(process.env.ELIG_MIN_DELAY_MINUTES ?? "15");

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) return NextResponse.json({ ok: false }, { status: 404 });

    const db = getSupabaseAdmin();

    const now = new Date();
    const tMin = new Date(now.getTime() - WINDOW_PAST_HOURS * 3600_000);
    const tMax = new Date(now.getTime() + WINDOW_FUTURE_HOURS * 3600_000);

    // Pull trips that are in-window and not locked yet
    const { data: trips, error } = await db
      .from("trips")
      .select("id,origin_crs,destination_crs,depart_planned,arrive_planned,eligible,eligibility_reason")
      .eq("is_ticket", true)
      .is("eligible", null)
      .gte("depart_planned", tMin.toISOString())
      .lte("depart_planned", tMax.toISOString())
      .order("depart_planned", { ascending: true })
      .limit(300);

    if (error) return json({ ok: false, error: error.message }, 500);

    let examined = 0;
    let updated = 0;
    const skipped: Record<string, number> = {
      no_crs: 0,
      no_times: 0,
      no_events: 0,
      not_arrived_yet: 0,
      db_update_failed: 0,
    };

    for (const t of trips || []) {
      examined++;

      const dest = (t.destination_crs || "").trim().toUpperCase();
      const arrivePlanned = t.arrive_planned ? new Date(t.arrive_planned) : null;
      if (!dest || dest.length !== 3) { skipped.no_crs++; continue; }
      if (!arrivePlanned || isNaN(arrivePlanned.getTime())) { skipped.no_times++; continue; }

      const lockAfter = new Date(arrivePlanned.getTime() + ARRIVAL_BUFFER_MIN * 60_000);
      if (now.getTime() < lockAfter.getTime()) { skipped.not_arrived_yet++; continue; }

      // Find the “best” Darwin event near the planned arrival at destination CRS
      // We look around +/- 2 hours of planned arrival.
      const from = new Date(arrivePlanned.getTime() - 2 * 3600_000).toISOString();
      const to = new Date(arrivePlanned.getTime() + 2 * 3600_000).toISOString();

      const { data: events, error: evErr } = await db
        .from("darwin_events")
        .select("id,event_type,planned_time,actual_time,late_minutes,raw,received_at")
        .eq("crs", dest)
        .gte("planned_time", from)
        .lte("planned_time", to)
        .order("received_at", { ascending: false })
        .limit(25);

      if (evErr) { skipped.no_events++; continue; }
      if (!events || events.length === 0) { skipped.no_events++; continue; }

      // Pick a usable event:
      // Prefer one with actual_time, else late_minutes, else nothing.
      const chosen = events.find(e => e.actual_time || typeof e.late_minutes === "number") || events[0];

      let eligible: boolean = false;
      let reason = "Darwin: no usable delay data";

      // Cancel beats everything
      if (String(chosen.event_type || "").toUpperCase().includes("CAN")) {
        eligible = true;
        reason = "Cancelled (Darwin)";
      } else if (typeof chosen.late_minutes === "number") {
        eligible = chosen.late_minutes >= MIN_DELAY_MINUTES;
        reason = eligible
          ? `Delayed ${chosen.late_minutes} min (Darwin)`
          : `Delayed ${chosen.late_minutes} min (<${MIN_DELAY_MINUTES} threshold, Darwin)`;
      } else if (chosen.actual_time && chosen.planned_time) {
        const p = new Date(chosen.planned_time);
        const a = new Date(chosen.actual_time);
        const mins = Math.max(0, Math.round((a.getTime() - p.getTime()) / 60000));
        eligible = mins >= MIN_DELAY_MINUTES;
        reason = eligible
          ? `Delayed ${mins} min (Darwin)`
          : `Delayed ${mins} min (<${MIN_DELAY_MINUTES} threshold, Darwin)`;
      }

      const patch: any = {
        eligible,
        eligibility_reason: reason,
        delay_source: "darwin",
        delay_checked_at: new Date().toISOString(),
        delay_minutes: typeof chosen.late_minutes === "number" ? chosen.late_minutes : null,
      };

      const { error: upErr } = await db.from("trips").update(patch).eq("id", t.id);
      if (upErr) { skipped.db_update_failed++; continue; }

      updated++;
    }

    return json({
      ok: true,
      window: { from: tMin.toISOString(), to: tMax.toISOString() },
      examined,
      updated,
      skipped,
      config: { WINDOW_PAST_HOURS, WINDOW_FUTURE_HOURS, ARRIVAL_BUFFER_MIN, MIN_DELAY_MINUTES },
    });
  } catch (e: any) {
    console.error("[darwin eligibility cron] error", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
