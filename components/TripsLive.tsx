"use client";

import useSWR from "swr";

type Trip = {
  id: string;
  origin: string | null;
  destination: string | null;
  operator: string | null;
  retailer: string | null;
  booking_ref: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  status?: string | null;
  is_ticket?: boolean | null;
};

type TripsResponse = {
  ok: boolean;
  authenticated: boolean;
  trips: Trip[];
  error?: string;
};

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json());

function formatDepart(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

export default function TripsLive() {
  const { data, error, isLoading } = useSWR<TripsResponse>("/api/trips/list", fetcher, {
    refreshInterval: 15_000, // auto-refresh every 15s
  });

  if (error) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <p className="small">Couldn’t load journeys right now. Please try again in a moment.</p>
      </div>
    );
  }

  if (!data || isLoading) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <p className="small">Scanning your Gmail for e-tickets…</p>
      </div>
    );
  }

  if (!data.authenticated) {
    // dashboard page already shows the “connect Gmail” card, so stay silent here
    return null;
  }

  if (!data.trips || data.trips.length === 0) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <p className="small">
          No journeys detected yet. As soon as we see rail e-tickets in Gmail, they’ll appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      {data.trips.map((t) => {
        const opLabel = t.operator || "Unknown operator";
        const retailer = t.retailer || null;
        const ref = t.booking_ref || "";
        const title =
          t.origin && t.destination
            ? `${t.origin} → ${t.destination}`
            : t.booking_ref
            ? `Booking ${t.booking_ref}`
            : "Rail journey";

        return (
          <div key={t.id} className="card" style={{ marginTop: 12 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span className="badge badgeSoft">
                {opLabel}
              </span>
              {retailer && (
                <span className="badge" style={{ background: "#eef3ff", color: "var(--fg-navy)" }}>
                  {retailer}
                </span>
              )}
              {t.is_ticket && (
                <span className="badge" style={{ background: "#ecf8f2", color: "var(--fg-green)" }}>
                  E-ticket
                </span>
              )}
            </div>

            <div style={{ fontWeight: 500, color: "var(--fg-navy)", marginBottom: 4 }}>{title}</div>

            {ref && (
              <p className="small" style={{ marginBottom: 2 }}>
                Ref: <strong>{ref}</strong>
              </p>
            )}

            <p className="small" style={{ marginBottom: 0 }}>
              Departs: {formatDepart(t.depart_planned)}
            </p>
          </div>
        );
      })}
    </>
  );
}
