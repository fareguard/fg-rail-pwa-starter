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

// --- small helpers ---------------------------------------------------------

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

  // If there is a “Something → Something” near the end, keep just that
  const m = s.match(/([A-Za-z][A-Za-z\s]+?→\s*[A-Za-z][A-Za-z\s]+)$/);
  if (m) s = m[1].trim();

  // Strip common Avanti marketing noise
  s = s.replace(
    /^Your booking is confirmed.*?Avanti West Coast\s*/i,
    ""
  );
  s = s.replace(/^Welcome to Avanti West Coast\s*/i, "");
  s = s.replace(/\s+on$/i, ""); // “... Stations on” → “... Stations”

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

// Simple “clsx”-style helper without dependency
function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// Operator brand colours (rough but good enough for now)
function operatorBadgeClass(operator?: string | null) {
  const base =
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium";

  if (!operator) return base + " bg-slate-100 text-slate-700";

  switch (operator) {
    case "Avanti West Coast":
      // dark teal / graphite
      return base + " bg-[#003C57] text-white";
    case "Northern":
      return base + " bg-[#1A3668] text-white";
    case "West Midlands Trains":
    case "West Midlands Railway":
      return base + " bg-[#ff8200] text-white";
    case "London Northwestern Railway":
      return base + " bg-[#007A53] text-white";
    case "ScotRail":
      return base + " bg-[#003366] text-white";
    default:
      return base + " bg-slate-100 text-slate-700";
  }
}

function retailerBadgeClass(retailer?: string | null) {
  const base =
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium";
  if (!retailer) return base + " bg-slate-100 text-slate-700";

  if (/trainpal/i.test(retailer)) {
    return base + " bg-[#ff6a00]/10 text-[#ff6a00]";
  }
  if (/trainline/i.test(retailer)) {
    return base + " bg-emerald-50 text-emerald-700";
  }
  return base + " bg-slate-100 text-slate-700";
}

// ---------------------------------------------------------------------------

function TripCard({ trip }: { trip: Trip }) {
  const title = useMemo(() => buildTitle(trip), [trip]);
  const departLabel = useMemo(() => formatDepart(trip), [trip]);

  // For now everything we ingest is effectively an e-ticket
  const isEticket = true;

  return (
    <li className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm shadow-slate-100/60">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-1">
          {/* Pills row */}
          <div className="flex flex-wrap items-center gap-2">
            {trip.operator && (
              <span className={operatorBadgeClass(trip.operator)}>
                {trip.operator}
              </span>
            )}

            {trip.retailer && (
              <span className={retailerBadgeClass(trip.retailer)}>
                {trip.retailer}
              </span>
            )}

            {isEticket && (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                E-ticket
              </span>
            )}
          </div>

          {/* Title / route */}
          <p className="text-sm font-medium text-slate-900 md:text-base">
            {title}
          </p>

          {/* Depart info */}
          <p className="text-xs text-slate-500 md:text-sm">{departLabel}</p>
        </div>

        {/* Status dot (for now all “live” / ok) */}
        <div className="mt-1 flex items-center">
          <span
            className={cx(
              "inline-flex h-2.5 w-2.5 rounded-full",
              trip.status === "submitted" || trip.status === "queued"
                ? "bg-amber-400"
                : "bg-emerald-400"
            )}
          />
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

export default function TripsLive() {
  const { data, error, isValidating } = useSWR<TripsResponse>(
    "/api/trips/list",
    fetcher,
    {
      refreshInterval: 60_000, // 60s passive refresh
    }
  );

  if (error) {
    return (
      <p className="mt-4 text-sm text-red-600">
        We couldn&apos;t load your journeys right now.
      </p>
    );
  }

  if (!data) {
    return (
      <p className="mt-4 text-sm text-slate-500">
        Loading your journeys…
      </p>
    );
  }

  if (!data.authenticated) {
    return (
      <p className="mt-4 text-sm text-slate-500">
        Sign in to see your journeys.
      </p>
    );
  }

  if (!data.trips.length) {
    return (
      <p className="mt-4 text-sm text-slate-500">
        No journeys detected yet. We&apos;ll add them here as soon as
        your e-tickets arrive.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {isValidating && (
        <p className="text-[11px] uppercase tracking-wide text-slate-400">
          Updating from Gmail…
        </p>
      )}

      <ul className="space-y-3">
        {data.trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </ul>
    </div>
  );
}
