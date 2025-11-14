"use client";

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
  created_at: string;
};

type TripsResponse = {
  ok: boolean;
  authenticated: boolean;
  trips: Trip[];
  error?: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// --- Formatting helpers ---

function formatDeparture(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTitle(trip: Trip) {
  if (trip.origin && trip.destination) {
    return `${trip.origin} → ${trip.destination}`;
  }
  if (trip.booking_ref) {
    return `Booking reference ${trip.booking_ref}`;
  }
  return "Train journey";
}

function buildSubtitle(trip: Trip) {
  // Short status line under the main title
  if (trip.operator && trip.booking_ref) {
    return `${trip.operator} • Ref ${trip.booking_ref}`;
  }
  if (trip.operator) return trip.operator;
  if (trip.retailer) return trip.retailer;
  return "";
}

// --- Badge colour maps ---

const OPERATOR_STYLES: Record<string, string> = {
  "Avanti West Coast": "bg-[#00454F] text-white",           // Avanti teal
  Northern: "bg-[#003B6F] text-white",
  "West Midlands Trains": "bg-[#FF8200] text-slate-900",
  "London Northwestern Railway": "bg-[#008066] text-white",
  ScotRail: "bg-[#002663] text-white",
  CrossCountry: "bg-[#5C0D3B] text-white",
};

const RETAILER_STYLES: Record<string, string> = {
  Trainline: "bg-[#00B26F] text-white",
  TrainPal: "bg-[#FF4B5C] text-white",
};

function chipClasses(
  base: string,
  value: string | null,
  map: Record<string, string>
) {
  if (!value) return `${base} bg-slate-100 text-slate-700`;
  const style = map[value];
  return style ? `${base} ${style}` : `${base} bg-slate-100 text-slate-700`;
}

// --- Component ---

export default function TripsLive() {
  const { data, error, isLoading } = useSWR<TripsResponse>(
    "/api/trips/list",
    fetcher,
    { refreshInterval: 0 }
  );

  if (isLoading) {
    return (
      <p className="mt-6 text-sm text-slate-500">
        Loading your journeys…
      </p>
    );
  }

  if (error || !data?.ok) {
    return (
      <p className="mt-6 text-sm text-red-600">
        We couldn’t load your journeys just now.
      </p>
    );
  }

  const trips = data.trips ?? [];

  if (!trips.length) {
    return (
      <p className="mt-6 text-sm text-slate-500">
        We’ll show journeys here as soon as we spot e-tickets in your inbox.
      </p>
    );
  }

  return (
    <section className="mt-6 space-y-4">
      {trips.map((trip) => (
        <article
          key={trip.id}
          className="rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm"
        >
          {/* badges row */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            {trip.operator && (
              <span
                className={chipClasses(
                  "rounded-full px-3 py-1",
                  trip.operator,
                  OPERATOR_STYLES
                )}
              >
                {trip.operator}
              </span>
            )}

            {trip.retailer &&
              trip.retailer !== trip.operator && ( // avoid duplicate Avanti / Avanti
                <span
                  className={chipClasses(
                    "rounded-full px-3 py-1",
                    trip.retailer,
                    RETAILER_STYLES
                  )}
                >
                  {trip.retailer}
                </span>
              )}

            {trip.is_ticket && (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                E-ticket
              </span>
            )}
          </div>

          {/* main text */}
          <h3 className="mt-3 text-base font-semibold text-slate-900">
            {buildTitle(trip)}
          </h3>

          {buildSubtitle(trip) && (
            <p className="mt-1 text-sm text-slate-600">
              {buildSubtitle(trip)}
            </p>
          )}

          <p className="mt-3 text-xs text-slate-500">
            Departs: {formatDeparture(trip.depart_planned)}
          </p>
        </article>
      ))}
    </section>
  );
}
