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

// --- helpers ---------------------------------------------------------

function formatDepart(trip: Trip) {
  if (!trip.depart_planned) return "Departs: —";

  const d = new Date(trip.depart_planned);
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

// Try to pull a sensible “X → Y” route from messy text
function cleanRoute(raw: string) {
  if (!raw) return "";

  let s = raw.replace(/\s+/g, " ").trim();

  const m = s.match(/([A-Za-z][A-Za-z\s]+?→\s*[A-Za-z][A-Za-z\s]+)$/);
  if (m) s = m[1].trim();

  s = s.replace(
    /^Your booking is confirmed.*?Avanti West Coast\s*/i,
    ""
  );
  s = s.replace(/^Welcome to Avanti West Coast\s*/i, "");
  s = s.replace(/\s+on$/i, "");

  if (s.length > 90) s = s.slice(0, 90) + "…";
  return s;
}

function buildTitle(trip: Trip): string {
  const combined = [trip.origin, trip.destination]
    .filter(Boolean)
    .join(" → ");

  if (combined) return cleanRoute(combined);
  if (trip.booking_ref) return `Booking ref ${trip.booking_ref}`;
  return "Train journey";
}

// ---------------------------------------------------------------------

function TripCard({ trip }: { trip: Trip }) {
  const title = useMemo(() => buildTitle(trip), [trip]);
  const departLabel = useMemo(() => formatDepart(trip), [trip]);

  const isEticket = true;

  const statusColour =
    trip.status === "submitted" || trip.status === "queued"
      ? "#fbbf24" // amber
      : "#22c55e"; // green

  const operator = (trip.operator || "").trim();
  const retailer = (trip.retailer || "").trim();
  const isSameBrand =
    operator &&
    retailer &&
    operator.toLowerCase() === retailer.toLowerCase();

  // Operator pill style (brand-aware)
  let operatorBadgeStyle: any = {
    background: "#ecf2f8",
    color: "var(--fg-navy)",
  };

  if (operator === "Avanti West Coast") {
  operatorBadgeStyle = {
    background: "rgb(0, 95, 105)",        // lighter teal
    border: "2px solid rgb(0, 63, 72)",   // deeper, structured teal
    color: "#FF7A00",                     // Avanti orange
    borderRadius: "9999px",
    padding: "3px 10px",
    fontWeight: 600,
    fontSize: "0.78rem",
  };
}

  // Retailer pill style (generic, only shown if different from operator)
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
            {operator && (
              <span className="badge" style={operatorBadgeStyle}>
                {operator}
              </span>
            )}

            {!isSameBrand && retailer && (
              <span className="badge" style={retailerBadgeStyle}>
                {retailer}
              </span>
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
          <p
            className="small"
            style={{ margin: 0, color: "var(--fg-muted)" }}
          >
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
        {data.trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </ul>
    </div>
  );
}
