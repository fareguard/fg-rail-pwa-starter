// components/TripsLive.tsx
"use client";

import { useMemo, useState, useEffect } from "react";
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
  outbound_departure?: string | null;
};

type DashboardMetrics = {
  potential_refunds: number;       // trips count
  potential_refunds_gbp: number;   // ticket value
  claims_in_progress: number;
  refunds_paid_gbp: number;
};

type TripsResponse = {
  ok: boolean;
  authenticated: boolean;
  trips: Trip[];
  metrics?: DashboardMetrics | null;
  error?: string;
};

const fetcher = async (url: string): Promise<TripsResponse> => {
  const res = await fetch(url);
  const json = await res.json();
  const authenticated = res.status !== 401;

  return {
    authenticated,
    ...json,
  };
};

// -------------------------------------------------------------
// Sorting helpers
// -------------------------------------------------------------

type SortOrder = "latest" | "earliest";

function safeTime(t: string | null | undefined): number {
  if (!t) return 0;
  const d = new Date(t);
  if (isNaN(d.getTime())) return 0;
  return d.getTime();
}

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

  if (operator === "LNER") {
    operatorBadgeStyle = {
      background: "rgb(206, 19, 46)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "Greater Anglia") {
    operatorBadgeStyle = {
      background: "rgb(215, 4, 40)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "South Western Railway") {
    operatorBadgeStyle = {
      background: "rgb(2, 35, 81)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "ScotRail") {
    operatorBadgeStyle = {
      background: "rgb(0, 31, 91)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "GWR") {
    operatorBadgeStyle = {
      background: "rgb(10, 45, 38)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "Transport for Wales") {
    operatorBadgeStyle = {
      background: "rgb(230, 0, 0)",
      color: "#FFFFFF",
      borderRadius: "9999px",
      padding: "3px 11px",
      fontWeight: 600,
      fontSize: "0.8rem",
      letterSpacing: "0.003em",
    };
  }

  if (operator === "c2c") {
    operatorBadgeStyle = {
      background: "rgb(182, 28, 140)",
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

            {/* If they differ (TrainPal + Avanti etc) → 2 pills (operator first) */}
            {!isSameBrand && (
              <>
                {operator && (
                  <span className="badge" style={operatorBadgeStyle}>
                    {operator}
                  </span>
                )}
                {retailer && (
                  <span className="badge" style={retailerBadgeStyle}>
                    {retailer}
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
// Button styles for sort toggle
// -------------------------------------------------------------

const sortToggleStyle = {
  display: "inline-flex",
  padding: 2,
  borderRadius: 999,
  background: "#f0f4f7",
};

const buttonBase = {
  borderRadius: 999,
  border: "none",
  padding: "4px 10px",
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  background: "transparent",
  color: "var(--fg-muted)",
  cursor: "pointer",
};

const activeButton = {
  ...buttonBase,
  background: "var(--fg-navy)",
  color: "#ffffff",
};

// -------------------------------------------------------------
// Metric pill
// -------------------------------------------------------------

type MetricPillProps = {
  label: string;
  value: string;
};

function MetricPill({ label, value }: MetricPillProps) {
  // per-metric colours
  let background = "rgba(15, 118, 110, 0.06)";
  let valueColor = "var(--fg-navy)";

  const key = label.toLowerCase();

  if (key.includes("claims in progress")) {
    // soft amber
    background = "#FEF3C7";
    valueColor = "#92400E";
  } else if (key.includes("refunds paid")) {
    // soft green
    background = "#DCFCE7";
    valueColor = "#166534";
  } else if (key.includes("potential refunds")) {
    // calm blue/teal
    background = "#E0F2FE";
    valueColor = "#075985";
  }

  return (
    <div
      style={{
        borderRadius: 999,
        padding: "8px 14px",
        background,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
        flex: "1 1 140px",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--fg-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: valueColor,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// -------------------------------------------------------------
// Main component
// -------------------------------------------------------------

export default function TripsLive() {
  // 1) Safe default — no localStorage on initial render
  const [sortOrder, setSortOrder] = useState<SortOrder>("latest");

  // 2) On mount, read stored preference (client only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("fareguard-sort");

      if (stored === "latest" || stored === "earliest") {
        setSortOrder(stored);
      }
      // in case you previously saved "newest"/"oldest"
      else if (stored === "newest") {
        setSortOrder("latest");
      } else if (stored === "oldest") {
        setSortOrder("earliest");
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  // 3) Persist whenever it changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("fareguard-sort", sortOrder);
    } catch {
      // ignore
    }
  }, [sortOrder]);

  const sortParam = sortOrder === "earliest" ? "asc" : "desc";

  // ✅ Call /dashboard/trips with the current sort order
  const { data, error, isValidating } = useSWR<TripsResponse>(
    `/dashboard/trips?sort=${sortParam}`,
    fetcher,
    {
      refreshInterval: 60_000,
    },
  );

  // 4) Derived data – keep hooks ABOVE any early returns
  const trips = useMemo(
    () => dedupeTrips(data?.trips ?? []),
    [data],
  );

  const sortedTrips = useMemo(() => {
    const copy = [...trips];
    copy.sort((a, b) => {
      const ta = safeTime(a.depart_planned || a.outbound_departure);
      const tb = safeTime(b.depart_planned || b.outbound_departure);
      return sortOrder === "latest" ? tb - ta : ta - tb;
    });
    return copy;
  }, [trips, sortOrder]);

  // -----------------------------------------------------------
  // Early returns (AFTER all hooks)
  // -----------------------------------------------------------

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

  if (!sortedTrips.length) {
    return (
      <p className="small" style={{ marginTop: 16, color: "var(--fg-muted)" }}>
        No journeys detected yet. We&apos;ll add them here as soon as your
        e-tickets arrive.
      </p>
    );
  }

  const metrics = data?.metrics ?? null;

// trips count
const potentialRefundTrips =
  typeof metrics?.potential_refunds === "number"
    ? metrics.potential_refunds
    : 0;

// ticket value (£)
const potentialRefundAmount =
  typeof metrics?.potential_refunds_gbp === "number"
    ? metrics.potential_refunds_gbp
    : 0;

const potentialRefundAmountDisplay = `£${potentialRefundAmount.toFixed(2)}`;

const potentialRefundTripsDisplay =
  potentialRefundTrips === 0
    ? "No eligible trips yet"
    : `${potentialRefundTrips} trip${potentialRefundTrips === 1 ? "" : "s"}`;

const claimsInProgressDisplay =
  typeof metrics?.claims_in_progress === "number"
    ? String(metrics.claims_in_progress)
    : "0";

const refundsPaidDisplay =
  typeof metrics?.refunds_paid_gbp === "number"
    ? `£${metrics.refunds_paid_gbp.toFixed(2)}`
    : "£0.00";

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

      {/* Metrics row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 12,
        }}
      >
 {/* Potential refunds */}
<div
  style={{
    flex: 1,
    minWidth: 180,
    padding: "12px 16px",
    borderRadius: 999,
    background: "#e4f0fa",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  }}
>
  <span
    style={{
      fontSize: 11,
      letterSpacing: 0.12,
      textTransform: "uppercase",
      color: "var(--fg-muted)",
      marginBottom: 4,
    }}
  >
    Potential refunds
  </span>

  {/* £ amount */}
  <span
    style={{
      fontSize: 18,
      fontWeight: 600,
      color: "#0f172a",
      marginBottom: 2,
    }}
  >
    {potentialRefundAmountDisplay}
  </span>

  {/* how many trips that £ comes from */}
  <span
    style={{
      fontSize: 12,
      color: "var(--fg-muted)",
    }}
  >
    {potentialRefundTripsDisplay}
  </span>
</div>

        {/* Claims in progress */}
        <div
          style={{
            flex: 1,
            minWidth: 180,
            padding: "12px 16px",
            borderRadius: 999,
            background: "#fff4ce",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: 0.12,
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              marginBottom: 4,
            }}
          >
            Claims in progress
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#92400e",
            }}
          >
            {claimsInProgressDisplay}
          </span>
        </div>

        {/* Refunds paid */}
        <div
          style={{
            flex: 1,
            minWidth: 180,
            padding: "12px 16px",
            borderRadius: 999,
            background: "#dcfce7",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: 0.12,
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              marginBottom: 4,
            }}
          >
            Refunds paid
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#166534",
            }}
          >
            {refundsPaidDisplay}
          </span>
        </div>
      </div>

      {/* Sort buttons */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 8,
          gap: 8,
        }}
      >
        <button
          type="button"
          style={sortOrder === "latest" ? activeButton : buttonBase}
          onClick={() => setSortOrder("latest")}
        >
          Newest first
        </button>
        <button
          type="button"
          style={sortOrder === "earliest" ? activeButton : buttonBase}
          onClick={() => setSortOrder("earliest")}
        >
          Oldest first
        </button>
      </div>

      {/* Trips list */}
      <ul
        style={{
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {sortedTrips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </ul>
    </div>
  );
}
