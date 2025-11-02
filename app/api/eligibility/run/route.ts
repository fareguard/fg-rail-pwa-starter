"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Dashboard() {
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("trips")
        .select(
          "id, origin, destination, operator, depart_planned, arrive_planned, created_at, status"
        )
        .eq("is_ticket", true) // 👈 only show ticket-like emails
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && data) setTrips(data);
      setLoading(false);
    };

    load();
  }, []);

  return (
    <div className="container" style={{ padding: "40px 20px" }}>
      <h1 className="h1">Your journeys & refund status</h1>
      <p className="sub">
        We’re watching your tickets and filing Delay Repay when eligible.
      </p>

      {loading ? (
        <p style={{ marginTop: 30 }}>Loading your journeys...</p>
      ) : trips.length === 0 ? (
        <p style={{ marginTop: 30 }}>
          No journeys found yet. We’ll populate this list as we detect your
          e-tickets.
        </p>
      ) : (
        <div
          style={{
            marginTop: 40,
            display: "grid",
            gap: 20,
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          }}
        >
          {trips.map((t) => (
            <div key={t.id} className="card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h3 style={{ color: "var(--fg-navy)", margin: 0 }}>
                  {t.origin} → {t.destination}
                </h3>
                <span
                  className={`badge ${
                    t.status === "submitted"
                      ? "bg-green"
                      : t.status === "rejected"
                      ? "bg-red"
                      : "bg-yellow"
                  }`}
                  style={{
                    background:
                      t.status === "submitted"
                        ? "#ecf8f2"
                        : t.status === "rejected"
                        ? "#fce8e8"
                        : "#fff4db",
                    color:
                      t.status === "submitted"
                        ? "var(--fg-green)"
                        : t.status === "rejected"
                        ? "#b3261e"
                        : "#a66f00",
                  }}
                >
                  {t.status || "Pending"}
                </span>
              </div>

              <p className="small" style={{ marginTop: 4 }}>
                {new Date(t.created_at).toLocaleString()}
              </p>

              <p className="small" style={{ marginTop: 4 }}>
                {t.operator || "Awaiting provider ref..."}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
