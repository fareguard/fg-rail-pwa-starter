// components/TripsLive.tsx
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
};

type TripsResponse = {
  ok: boolean;
  authenticated: boolean;
  trips: Trip[];
  error?: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

function parseTime(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDepart(trip: Trip) {
  if (!trip.depart_planned) return "Departs: —";

  const d = parseTime(trip.depart_planned);
  if (!d) return "Departs: —";

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
  "GWR",
  "Northern",
  "ScotRail",
  "TransPennine Express",
  "Thameslink",
  "Transport for Wales",
];

function extractStation(raw: string): string {
  if (!raw) return "";

  const match = raw.match(
    /([A-Z][\w&'()/-]*(?: [A-Z][\w&'()/-]*){0,3})\s*$/,
  );

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

  if (destination) return destination;
  if (trip.booking_ref) return `Booking ref ${trip.booking_ref}`;

  return "Train journey";
}

// -------------------------------------------------------------
// Brand normalisation
// -------------------------------------------------------------

function normaliseBrand(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";

  const lower = s.toLowerCase();

  if (lower.includes("crosscountry")) return "CrossCountry";
  if (lower.includes("trainpal")) return "TrainPal";
  if (lower.includes("trainline")) return "Trainline";

  if (
    lower.includes("west midlands railway") ||
    lower.includes("west midlands trains")
  ) {
    return "West Midlands Railway";
  }

  if (lower.includes("gwr") || lower.includes("great western")) {
    return "GWR";
  }

  if (lower.includes("avanti")) return "Avanti West Coast";
  if (lower.includes("northern")) return "Northern";

  if (lower.includes("transport for wales") || lower.includes("tfw")) {
    return "Transport for Wales";
  }

  return s;
}

// -------------------------------------------------------------
// Deduplication
// -------------------------------------------------------------

function scoreTrip(t: Trip): number {
  let score = 0;
  if (t.depart_planned) score += 4;
  if (t.arrive_planned) score += 1;
  if (t.origin && t.destination) score += 2;
  if (t.operator && t.retailer && t.operator !== t.retailer) score += 1;
  if (t.status === "submitted" || t.status === "queued") score += 1;
  if (t.booking_ref && t.booking_ref !== "UNKNOWN") score += 1;
  return score;
}

function areProbablySameJourney(a: Trip, b: Trip): boolean {
  const originA = (a.origin || "").toLowerCase();
  const destA = (a.destination || "").toLowerCase();
  const originB = (b.origin || "").toLowerCase();
  const destB = (b.destination || "").toLowerCase();

  if (!originA || !destA || !originB || !destB) return false;
  if (originA !== originB || destA !== destB) return false;

  const brandA =
    normaliseBrand(a.operator) || normaliseBrand(a.retailer) || "";
  const brandB =
    normaliseBrand(b.operator) || normaliseBrand(b.retailer) || "";

  if (brandA && brandB && brandA !== brandB) return false;

  const refA = (a.booking_ref || "").trim();
  const refB = (b.booking_ref || "").trim();
  if (refA && refB && refA === refB) return true;

  const tA = parseTime(a.depart_planned);
  const tB = parseTime(b.depart_planned);

  if (!tA && !tB) return false;
  if (!tA || !tB) {
    // same route + same booking_ref but only one has time
    return !!(refA && refB && refA === refB);
  }

  const diffMs = Math.abs(tA.getTime() - tB.getTime());
  const tenMinutes = 10 * 60 * 1000;

  return diffMs <= tenMinutes;
}

function dedupeTrips(trips: Trip[]): Trip[] {
  const result: Trip[] = [];

  for (const trip of trips) {
    let merged = false;

    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      if (areProbablySameJourney(existing, trip)) {
        const existingScore = scoreTrip(existing);
        const newScore = scoreTrip(trip);

        if (newScore > existingScore) {
          result[i] = trip;
        }

        merged = true;
        break;
      }
    }

    if (!merged) {
      result.push(trip);
    }
  }

  return result;
}

// -------------------------------------------------------------
// Card
// -------------------------------------------------------------

function TripCard({ trip }: { trip: Trip }) {
  const title = useMemo(() => buildTitle(trip), [trip]);
  const departLabel = useMemo(() => formatDepart(trip), [trip]);

  const isEticket = true;

  const statusColour =
    trip.status === "submitted" || trip.status === "queued"
      ? "#fbbf24"
      : "#22c55e";

  const rawOperator = (trip.operator || "").trim();
  const rawRetailer = (trip.retailer || "").trim();

  const operator = normaliseBrand(rawOperator);
  const retailer = normaliseBrand(rawRetailer);

  const isSameBrand =
    operator && retailer && operator.toLowerCase() === retailer.toLowerCase();

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

  if (operator === "Chiltern Railways") {
    operatorBadgeStyle = {
      background: "rgb(65, 182, 230)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

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

// -------------------------------------------------------------
// Main component
// -------------------------------------------------------------

export default function TripsLive() {
  const { data, error, isValidating } = useSWR<TripsResponse>(
    "/api/trips/list",
    fetcher,
    {
      refreshInterval: 60_000,
    },
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

  const trips = useMemo(() => dedupeTrips(data.trips || []), [data.trips]);

  if (!trips.length) {
    return (
      <p className="small" style={{ marginTop: 16, color: "var(--fg-muted)" }}>
        No journeys detected yet. We&apos;ll add them here as soon as your
        e-tickets arrive.
      </p>
    );
  }

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
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </ul>
    </div>
  );
}
