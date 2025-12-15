import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { openLdbwsCall } from "@/lib/openldbws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// ===== SECURITY GATE =====
const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";
function isAuthorized(request: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  const hdr = request.headers.get("x-admin-key") || "";
  return hdr === ADMIN_KEY;
}

// ===== OpenLDBWS LIMITS (important) =====
// timeOffset allowed roughly -120..+120, timeWindow up to 120.
// In practice: keep it conservative for reliability.
const MAX_ABS_OFFSET_MIN = 110;
const TIME_WINDOW_MIN = 60;

// Eligibility threshold (Delay Repay usually starts at 15/30 depending on TOC;
// we keep your MVP 15, you can later move this into delay_repay_rules per operator.)
const MIN_DELAY_MINUTES = Number(process.env.ELIG_MIN_DELAY_MINUTES ?? "15");

// Wait after planned arrival before we “lock” eligibility
const ARRIVAL_BUFFER_MIN = Number(process.env.ELIG_ARRIVAL_BUFFER_MIN ?? "20");

// Don’t hammer the same trip repeatedly
const CHECK_COOLDOWN_MIN = Number(process.env.ELIG_CHECK_COOLDOWN_MIN ?? "5");

// ===== utils =====
function json(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return res;
}
function toIso(d: Date) {
  return d.toISOString();
}
function parseIso(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function minutesDiff(later: Date, earlier: Date) {
  return Math.round((later.getTime() - earlier.getTime()) / 60000);
}
function normalizeCrs(crs: any): string | null {
  const s = String(crs || "").trim().toUpperCase();
  return s.length === 3 ? s : null;
}
function parseTimeHHMM(hhmm: string | null): { h: number; m: number } | null {
  if (!hhmm) return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return { h, m: mm };
}

// ===== minimal xml helpers =====
function pickTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return String(m[1] ?? "").trim() || null;
}
function pickAllServiceBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const re = /<service\b[\s\S]*?<\/service>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) blocks.push(m[0]);
  return blocks;
}

function buildDepartureBoardXml(opts: {
  crs: string;
  numRows?: number;
  filterCrs?: string;
  filterType?: "to" | "from";
  timeOffsetMin?: number;
  timeWindowMin?: number;
}) {
  const {
    crs,
    numRows = 30,
    filterCrs,
    filterType = "to",
    timeOffsetMin = 0,
    timeWindowMin = TIME_WINDOW_MIN,
  } = opts;

  // OpenLDBWS request: GetDepartureBoardRequest supports filter + timeOffset + timeWindow.
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:ldb="http://thalesgroup.com/RTTI/2016-02-16/ldb/">
  <soap:Body>
    <ldb:GetDepartureBoardRequest>
      <ldb:numRows>${numRows}</ldb:numRows>
      <ldb:crs>${crs}</ldb:crs>
      ${filterCrs ? `<ldb:filterCrs>${filterCrs}</ldb:filterCrs>` : ""}
      ${filterCrs ? `<ldb:filterType>${filterType}</ldb:filterType>` : ""}
      <ldb:timeOffset>${timeOffsetMin}</ldb:timeOffset>
      <ldb:timeWindow>${timeWindowMin}</ldb:timeWindow>
    </ldb:GetDepartureBoardRequest>
  </soap:Body>
</soap:Envelope>`;
}

type TripRow = {
  id: string;
  user_email: string | null;
  origin_crs: string | null;
  destination_crs: string | null;
  origin: string | null;
  destination: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  eligible: boolean | null;
  eligibility_reason: string | null;
  delay_minutes: number | null;
  delay_checked_at: string | null;
  service_id: string | null;
};

async function safeMarkChecked(db: any, tripId: string, extra?: Partial<any>) {
  const patch: any = {
    delay_checked_at: new Date().toISOString(),
    delay_source: "openldbws",
    ...extra,
  };
  await db.from("trips").update(patch).eq("id", tripId);
}

async function processOneTrip(db: any, t: TripRow) {
  const now = new Date();

  const originCrs = normalizeCrs(t.origin_crs);
  const destCrs = normalizeCrs(t.destination_crs);
  if (!originCrs || !destCrs) return { ok: false, skipped: "no_crs" as const };

  const plannedDepart = parseIso(t.depart_planned);
  const plannedArrive = parseIso(t.arrive_planned);
  if (!plannedDepart || !plannedArrive) return { ok: false, skipped: "no_times" as const };

  // cooldown
  const lastCheck = parseIso(t.delay_checked_at);
  if (lastCheck) {
    const minsSince = Math.abs(minutesDiff(now, lastCheck));
    if (minsSince < CHECK_COOLDOWN_MIN) return { ok: false, skipped: "cooldown" as const };
  }

  // OpenLDBWS can only answer near “now”. If trip is too old / too far in future, skip cleanly.
  const offsetMin = minutesDiff(plannedDepart, now); // planned - now
  if (Math.abs(offsetMin) > MAX_ABS_OFFSET_MIN) {
    await safeMarkChecked(db, t.id, {
      // don’t overwrite eligibility_reason with scary errors
      eligibility_reason: t.eligibility_reason,
    });
    return { ok: false, skipped: "out_of_range" as const };
  }

  // Fetch board filtered to destination CRS (massively improves matching)
  const bodyXml = buildDepartureBoardXml({
    crs: originCrs,
    filterCrs: destCrs,
    filterType: "to",
    timeOffsetMin: offsetMin,
    timeWindowMin: TIME_WINDOW_MIN,
  });

  let xml: string;
  try {
    xml = await openLdbwsCall(bodyXml);
  } catch (e: any) {
    // Mark checked but do not “lock” an error into eligibility_reason
    await safeMarkChecked(db, t.id);
    return { ok: false, skipped: "openldbws_error" as const, error: e?.message || String(e) };
  }

  const services = pickAllServiceBlocks(xml);
  if (!services.length) {
    await safeMarkChecked(db, t.id);
    return { ok: false, skipped: "no_services" as const };
  }

  // Pick best service by closest STD to planned departure (destination already filtered)
  let best: { block: string; diff: number } | null = null;
  for (const s of services) {
    const std = pickTag(s, "std");
    const stdTime = parseTimeHHMM(std);
    if (!stdTime) continue;

    const cand = new Date(plannedDepart);
    cand.setUTCHours(stdTime.h, stdTime.m, 0, 0);

    const diff = Math.abs(minutesDiff(cand, plannedDepart));
    if (!best || diff < best.diff) best = { block: s, diff };
  }

  if (!best || best.diff > 45) {
    await safeMarkChecked(db, t.id);
    return { ok: false, skipped: "no_match" as const };
  }

  const chosen = best.block;

  const serviceID = pickTag(chosen, "serviceID");
  const eta = pickTag(chosen, "eta");
  const ata = pickTag(chosen, "ata");
  const status = pickTag(chosen, "status");
  const etd = pickTag(chosen, "etd");

  // compute delay based on arrival if possible
  let delayMinutes: number | null = null;
  const arrivalHHMM = parseTimeHHMM(ata || eta);

  if (arrivalHHMM) {
    const actualArrive = new Date(plannedArrive);
    actualArrive.setUTCHours(arrivalHHMM.h, arrivalHHMM.m, 0, 0);

    // midnight wrap guard
    if (actualArrive.getTime() + 6 * 60 * 60 * 1000 < plannedArrive.getTime()) {
      actualArrive.setUTCDate(actualArrive.getUTCDate() + 1);
    }

    delayMinutes = Math.max(0, minutesDiff(actualArrive, plannedArrive));
  }

  const patch: any = {
    delay_checked_at: toIso(now),
    delay_source: "openldbws",
    service_id: serviceID ?? null,
    delay_minutes: delayMinutes,
  };

  // lock eligibility only after arrival + buffer
  const arriveBufferAt = new Date(plannedArrive.getTime() + ARRIVAL_BUFFER_MIN * 60000);
  const isPastWithBuffer = now.getTime() >= arriveBufferAt.getTime();

  if (isPastWithBuffer) {
    const lowerStatus = String(status || "").toLowerCase();
    const isCancelled =
      lowerStatus.includes("cancel") ||
      String(etd || "").toLowerCase().includes("cancel") ||
      String(eta || "").toLowerCase().includes("cancel");

    if (isCancelled) {
      patch.eligible = true;
      patch.eligibility_reason = "Cancelled (OpenLDBWS)";
    } else if (typeof delayMinutes === "number") {
      patch.eligible = delayMinutes >= MIN_DELAY_MINUTES;
      patch.eligibility_reason = patch.eligible
        ? `Delayed ${delayMinutes} min (OpenLDBWS)`
        : `Delayed ${delayMinutes} min (<${MIN_DELAY_MINUTES} min threshold, OpenLDBWS)`;
    } else {
      patch.eligible = false;
      patch.eligibility_reason = "Unable to compute delay from OpenLDBWS (no ETA/ATA)";
    }
  }

  const { error: upErr } = await db.from("trips").update(patch).eq("id", t.id);
  if (upErr) return { ok: false, skipped: "db_update_failed" as const, error: upErr.message };

  return { ok: true, locked: isPastWithBuffer, eligible: patch.eligible ?? null };
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) return NextResponse.json({ ok: false }, { status: 404 });

    const db = getSupabaseAdmin();

    const now = new Date();
    const tMin = new Date(now.getTime() - MAX_ABS_OFFSET_MIN * 60 * 1000);
    const tMax = new Date(now.getTime() + MAX_ABS_OFFSET_MIN * 60 * 1000);

    // ONLY pull trips OpenLDBWS can possibly answer
    const { data: trips, error } = await db
      .from("trips")
      .select(
        "id,user_email,origin,destination,origin_crs,destination_crs,depart_planned,arrive_planned,eligible,eligibility_reason,delay_minutes,delay_checked_at,service_id"
      )
      .eq("is_ticket", true)
      .gte("depart_planned", toIso(tMin))
      .lte("depart_planned", toIso(tMax))
      .order("depart_planned", { ascending: true })
      .limit(200);

    if (error) return json({ ok: false, error: error.message }, 500);

    let examined = 0;
    let updated = 0;
    const skipped: Record<string, number> = {
      no_crs: 0,
      no_times: 0,
      cooldown: 0,
      out_of_range: 0,
      openldbws_error: 0,
      no_services: 0,
      no_match: 0,
      db_update_failed: 0,
    };

    for (const t of (trips || []) as TripRow[]) {
      examined++;
      const r = await processOneTrip(db, t);
      if (!r.ok) {
        skipped[(r as any).skipped || "unknown"] = (skipped[(r as any).skipped || "unknown"] ?? 0) + 1;
      } else {
        updated++;
      }
    }

    return json({
      ok: true,
      window: { from: toIso(tMin), to: toIso(tMax) },
      examined,
      updated,
      skipped,
      config: {
        MAX_ABS_OFFSET_MIN,
        TIME_WINDOW_MIN,
        CHECK_COOLDOWN_MIN,
        ARRIVAL_BUFFER_MIN,
        MIN_DELAY_MINUTES,
      },
    });
  } catch (e: any) {
    console.error("[openldbws cron] error", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
