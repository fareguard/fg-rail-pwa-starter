// components/TripsLive.tsx
"use client";

import useSWR from "swr";
import clsx from "clsx";

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

const fetcher = (url: string) =>
  fetch(url).then<TripsResponse>((r) => r.json());

// Simple brand colour map for operator chips
const operatorBrandStyles: Record<
  string,
  { bg: string; text: string }
> = {
  "Avanti West Coast": { bg: "#003D4C", text: "#FFFFFF" }, // dark teal
  Northern: { bg: "#171C8F", text: "#FFFFFF" },
  "West Midlands Trains": { bg: "#ff8200", text: "#000000" },
  "London Northwestern Railway": { bg: "#006747", text: "#FFFFFF" },
  "Great Western Railway": { bg: "#004736", text: "#FFFFFF" },
  LNER: { bg: "#9d2235", text: "#FFFFFF" },
};

function formatDepart(dateIso: string | null) {
  if (!dateIso) return "—";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "—";

  // e.g. Fri, 16 Apr · 18:45
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

function Pill({
  children,
  brand,
}: {
  children: React.ReactNode;
  brand?: string | null;
}) {
  const brandStyle =
    brand && operatorBrandStyles[brand]
      ? operatorBrandStyles[brand]
      : null;

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
        !brandStyle && "bg-slate-100 text-slate-700"
      )}
      style={
        brandStyle
          ? { backgroundColor: brandStyle.bg, color: brandStyle.text }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export default function TripsLive() {
  const { data, error, isLoading } = useSWR("/api/trips/list", fetcher, {
    revalidateOnFocus: true,
  });

  if (error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load journeys. Please try refreshing.
      </p>
    );
  }

  if (isLoading || !data) {
    return (
      <p className="text-sm text-slate-500">
        Loading your journeys…
      </p>
    );
  }

  if (!data.ok) {
    return (
      <p className="text-sm text-red-600">
        {data.error || "Something went wrong loading your journeys."}
      </p>
    );
  }

  if (!data.authenticated) {
    return (
      <p className="text-sm text-slate-500">
        Sign in to see your journeys.
      </p>
    );
  }

  if (!data.trips.length) {
    return (
      <p className="text-sm text-slate-500">
        No journeys found yet. We’ll show them here as soon as we spot
        tickets in your email.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {data.trips.map((trip) => {
        const title =
          trip.origin && trip.destination
            ? `${trip.origin} → ${trip.destination}`
            : trip.booking_ref
            ? `Booking reference ${trip.booking_ref}`
            : "Rail journey";

        const departLabel = formatDepart(trip.depart_planned);

        return (
          <div
            key={trip.id}
            className="rounded-2xl border border-slate-100 bg-white px-5 py-4 shadow-sm"
          >
            {/* Top row: pills */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {trip.operator && (
                <Pill brand={trip.operator}>{trip.operator}</Pill>
              )}

              {trip.retailer &&
                trip.retailer !== trip.operator && (
                  <Pill>{trip.retailer}</Pill>
                )}

              {trip.is_ticket && <Pill>E-ticket</Pill>}
            </div>

            {/* Title */}
            <h3 className="text-sm font-semibold text-slate-900">
              {title}
            </h3>

            {/* Meta */}
            <p className="mt-1 text-xs text-slate-500">
              Departs: {departLabel}
            </p>
          </div>
        );
      })}
    </div>
  );
}
