// app/api/claims/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json }
  | Json[];

type StartClaimBody = {
  trip_id?: unknown;
};

function noStoreJson(body: any, status = 200) {
  const res = NextResponse.json(body, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  return res;
}

function isUuid(v: string): boolean {
  // strict-ish UUID v4/v1 format check (good enough for input validation)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function normaliseProviderFromOperator(
  operatorRaw: string | null | undefined
): string | null {
  const s = String(operatorRaw || "")
    .trim()
    .toLowerCase();

  if (!s) return null;

  // keep these aligned with your scripts/provider-*.mjs + process-queue.mjs routing
  if (s.includes("great western") || s === "gwr") return "gwr";
  if (s.includes("avanti")) return "avanti";
  if (s.includes("west midlands")) return "wmt";
  if (s.includes("lner")) return "lner";

  // gtr umbrella (adjust as you add scripts)
  if (
    s.includes("thameslink") ||
    s.includes("southern") ||
    s.includes("great northern") ||
    s.includes("gtr")
  ) {
    return "gtr";
  }

  return null;
}

function coerceFeePct(): number {
  const raw = process.env.FAREGUARD_FEE_PCT;
  const n = raw ? Number(raw) : 20;
  if (!Number.isFinite(n)) return 20;
  // clamp to sane bounds
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

async function getOrCreateProfileId(
  supa: ReturnType<typeof getSupabaseAdmin>,
  email: string
): Promise<string> {
  // Assumption (based on your description): profiles has { id uuid, email text unique }
  // If your column name differs, we’ll adjust once you paste the profiles schema.
  const { data: existing, error: selErr } = await supa
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (selErr) throw selErr;
  if (existing?.id) return existing.id as string;

  const { data: created, error: insErr } = await supa
    .from("profiles")
    .insert({ email })
    .select("id")
    .single();

  if (insErr) throw insErr;
  if (!created?.id) throw new Error("Failed to create profile");
  return created.id as string;
}

export async function POST(req: NextRequest) {
  try {
    // 1) session
    const cookieStore = cookies();
    const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value || null;
    const session = decodeSession(raw);
    const userEmail = session?.email;

    if (!userEmail) {
      return noStoreJson(
        { ok: false, error: "Not authenticated" },
        401
      );
    }

    // 2) parse + validate body
    let body: StartClaimBody = {};
    try {
      body = (await req.json()) as StartClaimBody;
    } catch {
      return noStoreJson({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const tripId = typeof body.trip_id === "string" ? body.trip_id.trim() : "";
    if (!tripId || !isUuid(tripId)) {
      return noStoreJson({ ok: false, error: "trip_id must be a UUID" }, 400);
    }

    const supa = getSupabaseAdmin();

    // 3) Load trip (strict per-user isolation)
    const { data: trip, error: tripErr } = await supa
      .from("trips")
      .select(
        "id,user_email,retailer,operator,booking_ref,origin,destination,depart_planned,arrive_planned,eligible,eligibility_reason"
      )
      .eq("id", tripId)
      .eq("user_email", userEmail)
      .maybeSingle();

    if (tripErr) throw tripErr;
    if (!trip) {
      return noStoreJson({ ok: false, error: "Trip not found" }, 404);
    }

    // 4) Determine provider script to use
    const provider = normaliseProviderFromOperator(trip.operator);
    if (!provider) {
      return noStoreJson(
        {
          ok: false,
          error: "Operator not supported for auto-claim yet",
          operator: trip.operator ?? null,
        },
        400
      );
    }

    // 5) Idempotency: prevent duplicate claims for same trip
    // Treat anything not failed as "already in flight or completed"
    const { data: existingClaim, error: existErr } = await supa
      .from("claims")
      .select("id,status")
      .eq("trip_id", tripId)
      .eq("user_email", userEmail)
      .not("status", "eq", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existErr) throw existErr;

    if (existingClaim?.id) {
      // Ensure it's queued at least once (optional: you can remove this if you want strict no-touch)
      return noStoreJson({
        ok: true,
        reused: true,
        claim_id: existingClaim.id,
        status: existingClaim.status,
      });
    }

    // 6) Profiles → user_id (claims.user_id is NOT NULL in your schema)
    const userId = await getOrCreateProfileId(supa, userEmail);

    const feePct = coerceFeePct();

    // 7) Create claim
    const { data: claim, error: claimErr } = await supa
      .from("claims")
      .insert({
        trip_id: trip.id,
        user_email: userEmail,
        user_id: userId,
        status: "pending",
        fee_pct: feePct,
        booking_ref: trip.booking_ref ?? null,
        operator: trip.operator ?? null,
        origin: trip.origin ?? null,
        destination: trip.destination ?? null,
        depart_planned: trip.depart_planned ?? null,
        arrive_planned: trip.arrive_planned ?? null,
        meta: {
          eligibility_reason: trip.eligibility_reason ?? null,
          eligible: trip.eligible ?? null,
        } satisfies Json,
      })
      .select("id")
      .single();

    if (claimErr) throw claimErr;
    if (!claim?.id) throw new Error("Failed to create claim");

    // 8) Canonical queue payload
    const payload: Json = {
      claim_id: claim.id,
      trip_id: trip.id,
      provider,
      passenger: {
        email: userEmail,
        // name/postcode come later from onboarding profile table
      },
      journey: {
        origin: trip.origin,
        destination: trip.destination,
        planned_departure: trip.depart_planned,
        planned_arrival: trip.arrive_planned,
      },
      ticket: {
        booking_ref: trip.booking_ref,
        retailer: trip.retailer,
        operator: trip.operator,
      },
      fee_pct: feePct,
      // add provider-specific stuff later (barcode, ticket type, etc)
      meta: {
        source: "api.claims.start",
      },
    };

    // 9) Enqueue
    const { data: queueRow, error: queueErr } = await supa
      .from("claim_queue")
      .insert({
        claim_id: claim.id,
        provider,
        status: "queued",
        payload,
        meta: {
          created_by: "api/claims/start",
        } satisfies Json,
      })
      .select("id,status")
      .single();

    if (queueErr) throw queueErr;

    return noStoreJson({
      ok: true,
      claim_id: claim.id,
      queue_id: queueRow?.id ?? null,
      queue_status: queueRow?.status ?? null,
      provider,
    });
  } catch (e: any) {
    console.error("claims/start error", e);
    return noStoreJson(
      { ok: false, error: String(e?.message || e) },
      500
    );
  }
}
