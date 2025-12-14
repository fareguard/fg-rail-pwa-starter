import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { openLdbwsCall } from "@/lib/openldbws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// ===== SECURITY GATE =====
// In dev: allow.
// In prod: require x-admin-key header to match ADMIN_API_KEY.
const DEV_ONLY = process.env.NODE_ENV !== "production";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";

function isAuthorized(request: Request) {
  if (DEV_ONLY) return true;
  if (!ADMIN_KEY) return false;
  const hdr = request.headers.get("x-admin-key") || "";
  return hdr === ADMIN_KEY;
}

// ===== CONFIG =====
const WINDOW_PAST_HOURS = Number(process.env.ELIG_WINDOW_PAST_HOURS ?? "2"); // look back
const WINDOW_FUTURE_HOURS = Number(process.env.ELIG_WINDOW_FUTURE_HOURS ?? "12"); // look ahead
const CHECK_COOLDOWN_MIN = Number(process.env.ELIG_CHECK_COOLDOWN_MIN ?? "5"); // don't re-check too frequently
const ARRIVAL_BUFFER_MIN = Number(process.env.ELIG_ARRIVAL_BUFFER_MIN ?? "20"); // wait after arrival before locking
const MIN_DELAY_MINUTES = Number(process.env.ELIG_MIN_DELAY_MINUTES ?? "15"); // eligibility threshold (MVP)

// ===== tiny utils =====
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

// ===== XML parsing (minimal, but works with OpenLDBWS service blocks) =====
function pickTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return String(m[1] ?? "").trim() || null;
}

function pickAllServiceBlocks(xml: string): string[] {
  // OpenLDBWS services are typically <service>...</service>
  const blocks: string[] = [];
  const re = /<service\b[\s\S]*?<\/service>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) blocks.push(m[0]);
  return blocks;
}

function pickDestinationName(serviceBlock: string): string | null {
  // destination often appears as <destination><location><locationName>...</locationName>
  // We’ll just grab the first <locationName> inside destination.
  const destBlock = pickTag(serviceBlock, "destination");
  if (!destBlock) return null;
  const locName = pickTag(destBlock, "locationName");
  return locName;
}

function parseTimeHHMM(hhmm: string | null): { h: number; m: number } | null {
  if (!hhmm) return null;
  const s = hhmm.trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return { h, m: mm };
}

function sameMinuteClose(planned: Date, candidate: Date, toleranceMin = 20) {
  const diff = Math.abs(minutesDiff(candidate, planned));
  return diff <= toleranceMin;
}

function buildBoardRequestXml(crs: string, numRows = 20) {
  // SOAP body for GetDepartureBoard (OpenLDBWS)
  // The token is injected by your openLdbwsCall helper in SOAP header (as you already did in /test).
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:ldb="http://thalesgroup.com/RTTI/2016-02-16/ldb/">
  <soap:Body>
    <ldb:GetDepartureBoardRequest>
      <ldb:numRows>${numRows}</ldb:numRows>
      <ldb:crs>${crs}</ldb:crs>
    </ldb:GetDepartureBoardRequest>
  </soap:Body>
</soap:Envelope>`;
}

type TripRow = {
  id: string;
  user_email: string | null;
  origin: string | null;
  destination: string | null;
  origin_crs: string | null;
  destination_crs: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  eligible: boolean | null;
  eligibility_reason: string | null;
  delay_minutes: number | null;
  delay_checked_at: string | null;
  service_id: string | null;
};

async function processOneTrip(db: any, t: TripRow) {
  const now = new Date();

  const originCrs = normalizeCrs(t.origin_crs);
  const destCrs = normalizeCrs(t.destination_crs);
  if (!originCrs || !destCrs) {
    return { ok: false, skipped: "no_crs" as const };
  }

  const plannedDepart = parseIso(t.depart_planned);
  const plannedArrive = parseIso(t.arrive_planned);
  if (!plannedDepart || !plannedArrive) {
    return { ok: false, skipped: "no_times" as const };
  }

  // cooldown
  const lastCheck = parseIso(t.delay_checked_at);
  if (lastCheck) {
    const minsSince = Math.abs(minutesDiff(now, lastCheck));
    if (minsSince < CHECK_COOLDOWN_MIN) {
      return { ok: false, skipped: "cooldown" as const };
    }
  }

  // 1) fetch board
  const bodyXml = buildBoardRequestXml(originCrs, 30);
  const xml = await openLdbwsCall(bodyXml);

  // 2) parse services
  const services = pickAllServiceBlocks(xml);
  if (!services.length) {
    // still update checked_at so we don't hammer
    await db
      .from("trips")
      .update({
        delay_checked_at: toIso(now),
        delay_source: "openldbws",
      })
      .eq("id", t.id);

    return { ok: false, skipped: "no_services" as const };
  }

  // 3) find best matching service by destination + planned departure close
  // Prefer:
  // - destination name includes the destination CRS *name isn't present*, so we match by time first
  // - match std (scheduled depart) near planned depart
  const plannedDepartLocal = plannedDepart;

  let best: { block: string; score: number } | null = null;

  for (const s of services) {
    const serviceID = pickTag(s, "serviceID");
    const std = pickTag(s, "std"); // scheduled depart
    const etd = pickTag(s, "etd"); // expected depart
    const sta = pickTag(s, "sta"); // scheduled arrive (sometimes present)
    const eta = pickTag(s, "eta"); // expected arrive
    const destName = pickDestinationName(s);

    // score
    let score = 0;

    // time closeness on std (best signal)
    const stdTime = parseTimeHHMM(std);
    if (stdTime) {
      const cand = new Date(plannedDepartLocal);
      cand.setUTCHours(stdTime.h, stdTime.m, 0, 0);
      if (sameMinuteClose(plannedDepartLocal, cand, 30)) score += 5;
    }

    // destination hint (weak signal, but helps)
    if (destName && t.destination) {
      const a = destName.toLowerCase();
      const b = t.destination.toLowerCase();
      if (a.includes(b) || b.includes(a)) score += 2;
    }

    // if we have booking refs later, we can match even better; for now keep it simple

    if (!best || score > best.score) best = { block: s, score };
  }

  if (!best || best.score < 3) {
    // no confident match, just mark checked
    await db
      .from("trips")
      .update({
        delay_checked_at: toIso(now),
        delay_source: "openldbws",
      })
      .eq("id", t.id);

    return { ok: false, skipped: "no_match" as const };
  }

  const chosen = best.block;

  const serviceID = pickTag(chosen, "serviceID");
  const std = pickTag(chosen, "std");
  const etd = pickTag(chosen, "etd");
  const sta = pickTag(chosen, "sta");
  const eta = pickTag(chosen, "eta");
  const ata = pickTag(chosen, "ata"); // actual arrival (if present)
  const status = pickTag(chosen, "status"); // may exist

  // 4) compute delay minutes (prefer arrival-based if we can)
  // We compare planned arrival timestamp vs:
  // - ATA time if available
  // - else ETA time if available
  // - else if only "On time"/"Delayed", we can't compute reliably => delay null

  let delayMinutes: number | null = null;

  const pickActualOrExpectedArrival = ata || eta;
  const arrivalHHMM = parseTimeHHMM(pickActualOrExpectedArrival);

  if (arrivalHHMM) {
    const actualArrive = new Date(plannedArrive);
    actualArrive.setUTCHours(arrivalHHMM.h, arrivalHHMM.m, 0, 0);

    // handle midnight-ish wrap: if computed time is "before" planned by a lot, add a day
    if (actualArrive.getTime() + 6 * 60 * 60 * 1000 < plannedArrive.getTime()) {
      actualArrive.setUTCDate(actualArrive.getUTCDate() + 1);
    }

    delayMinutes = Math.max(0, minutesDiff(actualArrive, plannedArrive));
  } else {
    // Sometimes ETA/ATA is "On time" or "Cancelled" etc.
    // We’ll treat Cancelled specially (eligible true, reason cancelled) once in past.
    delayMinutes = null;
  }

  // 5) update trip with fresh tracking fields
  const patch: any = {
    delay_checked_at: toIso(now),
    delay_source: "openldbws",
    service_id: serviceID ?? null,
    delay_minutes: delayMinutes,
  };

  // 6) decide if we should lock eligibility yet
  const arriveBufferAt = new Date(plannedArrive.getTime() + ARRIVAL_BUFFER_MIN * 60000);
  const isPastWithBuffer = now.getTime() >= arriveBufferAt.getTime();

  if (isPastWithBuffer) {
    // cancelled?
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
      // we couldn't compute: be truthful
      patch.eligible = false;
      patch.eligibility_reason = "Unable to compute delay from OpenLDBWS (no ETA/ATA)";
    }
  }

  const { error: upErr } = await db.from("trips").update(patch).eq("id", t.id);
  if (upErr) return { ok: false, skipped: "db_update_failed" as const, error: upErr.message };

  return {
    ok: true,
    locked: isPastWithBuffer,
    eligible: typeof patch.eligible === "boolean" ? patch.eligible : null,
    delay_minutes: delayMinutes,
    service_id: serviceID ?? null,
  };
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const db = getSupabaseAdmin();

    const now = new Date();
    const tMin = new Date(now.getTime() - WINDOW_PAST_HOURS * 60 * 60 * 1000);
    const tMax = new Date(now.getTime() + WINDOW_FUTURE_HOURS * 60 * 60 * 1000);

    // Only ticket-like trips, within a window OpenLDBWS can realistically help with
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
    let lockedEligible = 0;
    let lockedIneligible = 0;

    const skipped: Record<string, number> = {
      no_crs: 0,
      no_times: 0,
      cooldown: 0,
      no_services: 0,
      no_match: 0,
      db_update_failed: 0,
    };

    for (const t of (trips || []) as TripRow[]) {
      examined++;

      const r = await processOneTrip(db, t);

      if (!r.ok) {
        const key = (r as any).skipped || "unknown";
        skipped[key] = (skipped[key] ?? 0) + 1;
        continue;
      }

      updated++;

      if (r.locked) {
        if (r.eligible === true) lockedEligible++;
        if (r.eligible === false) lockedIneligible++;
      }
    }

    return json({
      ok: true,
      window: { from: toIso(tMin), to: toIso(tMax) },
      examined,
      updated,
      locked: { eligible: lockedEligible, ineligible: lockedIneligible },
      skipped,
      config: {
        WINDOW_PAST_HOURS,
        WINDOW_FUTURE_HOURS,
        CHECK_COOLDOWN_MIN,
        ARRIVAL_BUFFER_MIN,
        MIN_DELAY_MINUTES,
      },
    });
  } catch (e: any) {
    console.error("[openldbws cron] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
