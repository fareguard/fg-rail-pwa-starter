"use client";

import useSWR from "swr";
import React from "react";

type Trip = {
  id: string;
  origin?: string | null;
  destination?: string | null;
  booking_ref?: string | null;
  operator?: string | null;
  retailer?: string | null;
  depart_planned?: string | null;
  arrive_planned?: string | null;
  status?: string | null;
  is_ticket?: boolean | null;
  created_at?: string | null;
};

type TripsResponse = {
  ok: boolean;
  authenticated: boolean;
  trips: Trip[];
};

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<TripsResponse>);

// --- Operator brand styles ---
const operatorStyles: Record<
  string,
  { chip: string; text: string; border?: string }
> = {
  "Avanti West Coast": {
    chip: "bg-[#00363D]",
    text: "text-white",
    border: "border border-[#FF6A00]/40",
  },
  Northern: {
    chip: "bg-[#1C1C3C]",
    text: "text-white",
  },
  "West Midlands Railway": {
    chip: "bg-[#4B286D]",
    text: "text-white",
  },
  "London Northwestern Railway": {
    chip: "bg-[#005A4C]",
    text: "text-white",
  },
  "Chiltern Railways": {
    chip: "bg-[#005C9D]",
    text: "text-white",
  },
};

// simple date formatter – no extra deps
function formatDepart(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `${dateFormatter.format(d)} · ${timeFormatter.format(d)}`;
}

// derive a nice title for the card
function getTripTitle(trip: Trip): string {
  const clean = (s?: string | null) => (s || "").trim();

  const origin = clean(trip.origin);
  const destination = clean(trip.destination);

  if (origin && destination) {
    return `${origin} → ${destination}`;
  }

  if (origin) return origin;
  if (destination) return destination;

  if (trip.booking_ref) return `Booking ref ${trip.booking_ref}`;

  return "Trip details";
}

export default function TripsLive() {
  const { data, error, isLoading } = useSWR<TripsResponse>(
    "/api/trips/list",
    fetcher,
    {
      refreshInterval: 60_000,
    }
  );

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
        We couldn’t load your journeys right now. Please try refreshing.
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border border-slate-100 bg-white px-4 py-6 text-sm text-slate-500">
        Loading your journeys…
      </div>
    );
  }

  if (!data.authenticated) {
    return (
      <div className="rounded-xl border border-slate-100 bg-white px-4 py-6 text-sm text-slate-600">
        Sign in to see your journeys.
      </div>
    );
  }

  if (!data.trips || data.trips.length === 0) {
    return (
      <div className="rounded-xl border border-slate-100 bg-white px-4 py-6 text-sm text-slate-600">
        We haven’t found any rail tickets in your email yet. As new tickets
        arrive, they’ll appear here automatically.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.trips.map((trip) => {
        const op = (trip.operator || trip.retailer || "").trim();
        const opStyles =
          (op && operatorStyles[op]) || {
            chip: "bg-slate-100",
            text: "text-slate-700",
          };

        const title = getTripTitle(trip);
        const depart = formatDepart(trip.depart_planned);

        const showRetailerChip =
          trip.retailer &&
          trip.retailer.trim() &&
          trip.retailer.trim() !== trip.operator?.trim();

        return (
          <article
            key={trip.id}
            className="rounded-2xl border border-slate-100 bg-white px-6 py-4 shadow-sm shadow-slate-100/60"
          >
            {/* top row – chips */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {op && (
                <span
                  className={[
                    "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
                    opStyles.chip,
                    opStyles.text,
                    opStyles.border ?? "",
                  ].join(" ")}
                >
                  {op}
                </span>
              )}

              {showRetailerChip && (
                <span className="inline-flex items-center rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                  {trip.retailer}
                </span>
              )}

              {trip.is_ticket && (
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  E-ticket
                </span>
              )}
            </div>

            {/* main title */}
            <h3 className="text-sm font-semibold text-slate-900">
              {title}
            </h3>

            {/* meta row */}
            <p className="mt-1 text-xs text-slate-500">
              <span className="font-medium text-slate-600">Departs:</span>{" "}
              {depart}
              {trip.booking_ref && (
                <>
                  {" "}
                  · <span className="text-slate-400">Ref:</span>{" "}
                  <span className="tabular-nums text-slate-600">
                    {trip.booking_ref}
                  </span>
                </>
              )}
            </p>
          </article>
        );
      })}
    </div>
  );
}
