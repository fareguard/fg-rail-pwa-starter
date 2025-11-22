"use client";

import { useMemo } from "react";
import useSWR from "swr";

type Trip = {
  id: string;
  origin: string | null;
  destination: string | null;
  booking_ref: string | null;
  operator: string | null;
  retailer: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  status: string | null;
  is_ticket: boolean | null;
  created_at: string | null;
  // will be present from the API even if TS doesn’t know it yet
  outbound_departure?: string | null;
};

type TripsResponse = {
  ok: boolean;
  authenticated: boolean;
  trips: Trip[];
  error?: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// --- helpers ---------------------------------------------------------

function preferDepartTime(trip: Trip): string | null {
  // prefer depart_planned, but fall back to outbound_departure
  return trip.depart_planned ?? trip.outbound_departure ?? null;
}

function formatDepart(trip: Trip) {
  const raw = preferDepartTime(trip);
  if (!raw) return "Departs: —";

  const d = new Date(raw);
  if (isNaN(d.getTime())) return "Departs: —";

  const date = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `Departs: ${date} · ${time}`;
}

const OPERATOR_PREFIXES = [
  "Avanti West Coast",
  "CrossCountry",
  "West Midlands Railway",
  "West Midlands Trains",
  "London Northwestern Railway",
  "Great Western Railway",
  "Northern",
  "ScotRail",
  "TransPennine Express",
  "Thameslink",
];

const AGGREGATOR_BRANDS = ["TrainPal", "Trainline", "TheTrainline", "National Rail"];

function normalise(str: string | null | undefined) {
  return (str || "").trim().toLowerCase();
}

/**
 * Take a noisy text blob like:
 * "Your booking is confirmed Thank you for booking with Avanti West Coast Wolverhampton"
 * or "Avanti West Coast Wolverhampton"
 * and pull out the likely station, e.g. "Wolverhampton".
 */
function extractStation(raw: string): string {
  if (!raw) return "";

  const match = raw.match(/([A-Z][\w&'()/-]*(?: [A-Z][\w&'()/-]*){0,3})\s*$/);

  let station = (match?.[1] || raw).trim();

  for (const op of OPERATOR_PREFIXES) {
    if (station.startsWith(op + " ")) {
      station = station.slice(op.length).trim();
      break;
    }
  }

  return station
    .replace(/^Your booking is confirmed/i, "")
    .replace(/^Thank you for booking with .*/i, "")
    .trim();
}

function buildTitle(trip: Trip): string {
  const rawOrigin = (trip.origin || "").trim();
  const rawDestination = (trip.destination || "").trim();

  const origin = extractStation(rawOrigin);
  const destination = rawDestination;

  if (origin && destination) {
    return `${origin} → ${destination}`;
  }

  if (destination) {
    return destination;
  }

  if (trip.booking_ref) {
    return `Booking ref ${trip.booking_ref}`;
  }

  return "Train journey";
}

// ---------- MERGING / DEDUPING LOGIC ---------------------------------

function isAggregator(name: string | null | undefined): boolean {
  const n = normalise(name);
  if (!n) return false;
  return AGGREGATOR_BRANDS.some((b) => n.includes(b.toLowerCase()));
}

/**
 * Merge trips that look like the same physical journey.
 * Heuristic:
 *  - same origin + destination (case-insensitive)
 *  - departure times within 10 minutes OR missing but same booking_ref
 */
function mergeTrips(trips: Trip[]): Trip[] {
  if (!trips.length) return [];

  const groups: Trip[][] = [];

  for (const trip of trips) {
    const o = normalise(trip.origin);
    const d = normalise(trip.destination);
    const depRaw = preferDepartTime(trip);
    const depMs = depRaw ? new Date(depRaw).getTime() : null;

    let placed = false;

    for (const group of groups) {
      const g0 = group[0];
      const go = normalise(g0.origin);
      const gd = normalise(g0.destination);
      if (o !== go || d !== gd) continue;

      const gDepRaw = preferDepartTime(g0);
      const gDepMs = gDepRaw ? new Date(gDepRaw).getTime() : null;

      const bothHaveDep = depMs !== null && gDepMs !== null;
      const depClose =
        bothHaveDep && Math.abs(depMs! - gDepMs!) <= 10 * 60 * 1000; // 10 mins

      const bookingMatch =
        (trip.booking_ref && trip.booking_ref === g0.booking_ref) ||
        !trip.booking_ref ||
        !g0.booking_ref;

      if ((bothHaveDep && depClose && bookingMatch) || (!bothHaveDep && bookingMatch)) {
        group.push(trip);
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push([trip]);
    }
  }

  const merged: Trip[] = groups.map((group) => {
    if (group.length === 1) return group[0];

    // start from first as base
    const base: Trip = { ...group[0] };

    // best depart/arrive
    base.depart_planned =
      group.find((t) => t.depart_planned)?.depart_planned ?? base.depart_planned;
    (base as any).outbound_departure =
      group.find((t) => t.outbound_departure)?.outbound_departure ??
      (base as any).outbound_departure;
    base.arrive_planned =
      group.find((t) => t.arrive_planned)?.arrive_planned ?? base.arrive_planned;

    const allRetailers = group.map((t) => t.retailer || "").filter(Boolean);
    const allOperators = group.map((t) => t.operator || "").filter(Boolean);

    const chosenRetailer =
      allRetailers.find((r) => isAggregator(r)) ||
      allOperators.find((r) => isAggregator(r)) ||
      base.retailer;

    const chosenOperator =
      allOperators.find((o) => !isAggregator(o)) || base.operator;

    return {
      ...base,
      retailer: chosenRetailer || base.retailer,
      operator: chosenOperator || base.operator,
    };
  });

  // sort newest first
  merged.sort((a, b) => {
    const ad = preferDepartTime(a);
    const bd = preferDepartTime(b);
    if (ad && bd) {
      return new Date(bd).getTime() - new Date(ad).getTime();
    }
    if (ad) return -1;
    if (bd) return 1;
    return 0;
  });

  return merged;
}

// ---------------------------------------------------------------------

function TripCard({ trip }: { trip: Trip }) {
  const title = useMemo(() => buildTitle(trip), [trip]);
  const departLabel = useMemo(() => formatDepart(trip), [trip]);

  const isEticket = true;

  const statusColour =
    trip.status === "submitted" || trip.status === "queued"
      ? "#fbbf24"
      : "#22c55e";

  const operator = (trip.operator || "").trim();
  const retailer = (trip.retailer || "").trim();
  const isSameBrand =
    operator && retailer && operator.toLowerCase() === retailer.toLowerCase();

  // Operator pill style (brand-aware)
  let operatorBadgeStyle: any = {
    background: "#ecf2f8",
    color: "var(--fg-navy)",
  };

  if (operator === "Avanti West Coast") {
    operatorBadgeStyle = {
      background: "rgb(0, 128, 138)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "CrossCountry") {
    operatorBadgeStyle = {
      background: "rgb(159, 40, 67)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "Northern") {
    operatorBadgeStyle = {
      background: "rgb(35, 47, 95)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "West Midlands Railway") {
    operatorBadgeStyle = {
      background: "rgb(60, 16, 83)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  // Retailer pill style (generic)
  const retailerBadgeStyle: any = {
    background: "#f4f4f5",
    color: "#444",
  };

  return (
    <li
      className="card"
      style={{
        marginTop: 12,
        listStyle: "none",
        paddingTop: 12,
        paddingBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ flex: "1 1 auto" }}>
          {/* pills row */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 6,
            }}
          >
            {isSameBrand && operator && (
              <span className="badge" style={operatorBadgeStyle}>
                {operator}
              </span>
            )}

            {!isSameBrand && (
              <>
                {retailer && (
                  <span className="badge" style={retailerBadgeStyle}>
                    {retailer}
                  </span>
                )}
                {operator && (
                  <span className="badge" style={operatorBadgeStyle}>
                    {operator}
                  </span>
                )}
              </>
            )}

            {isEticket && (
              <span
                className="badge"
                style={{
                  background: "#ecf8f2",
                  color: "var(--fg-green)",
                }}
              >
                E-ticket
              </span>
            )}
          </div>

          {/* title */}
          <p
            style={{
              margin: "0 0 4px",
              fontWeight: 500,
              color: "var(--fg-navy)",
            }}
          >
            {title}
          </p>

          {/* depart info */}
          <p className="small" style={{ margin: 0, color: "var(--fg-muted)" }}>
            {departLabel}
          </p>
        </div>

        {/* status dot */}
        <div style={{ marginTop: 4 }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 999,
              background: statusColour,
            }}
          />
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------

export default function TripsLive() {
  const { data, error, isValidating } = useSWR<TripsResponse>(
    "/api/trips/list",
    fetcher,
    {
      refreshInterval: 60_000,
    }
  );

  if (error) {
    return (
      <p className="small" style={{ marginTop: 16, color: "#b91c1c" }}>
        We couldn&apos;t load your journeys right now.
      </p>
    );
  }

  if (!data) {
    return (
      <p className="small" style={{ marginTop: 16, color: "var(--fg-muted)" }}>
        Loading your journeys…
      </p>
    );
  }

  if (!data.authenticated) {
    return (
      <p className="small" style={{ marginTop: 16, color: "var(--fg-muted)" }}>
        Sign in to see your journeys.
      </p>
    );
  }

  if (!data.trips.length) {
    return (
      <p className="small" style={{ marginTop: 16, color: "var(--fg-muted)" }}>
        No journeys detected yet. We&apos;ll add them here as soon as your
        e-tickets arrive.
      </p>
    );
  }

  const mergedTrips = useMemo(
    () => mergeTrips(data.trips),
    [data.trips]
  );

  return (
    <div style={{ marginTop: 16 }}>
      {isValidating && (
        <p
          className="small"
          style={{
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: 0.08,
            fontSize: 11,
            color: "var(--fg-muted)",
          }}
        >
          Updating from Gmail…
        </p>
      )}

      <ul
        style={{
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {mergedTrips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </ul>
    </div>
  );
}
