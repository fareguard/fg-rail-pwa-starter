// app/(app)/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

type Trip = {
  id: string;
  origin: string | null;
  destination: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  status: string | null;
  delay_minutes: number | null;
  potential_refund: number | null;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Dashboard() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[] | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
      if (!data.user) return;
      supabase
        .from("trips")
        .select(
          "id, origin, destination, depart_planned, arrive_planned, status, delay_minutes, potential_refund"
        )
        .order("depart_planned", { ascending: false })
        .limit(50)
        .then(({ data }) => setTrips(data ?? []));
    });
  }, []);

  return (
    <>
      <div className="nav">
        <div className="container navInner">
          <div className="brand">FareGuard</div>
          <div style={{ color: "var(--fg-muted)" }}>
            {userEmail ? `Hi, ${userEmail}` : ""}
          </div>
        </div>
      </div>

      <section className="hero">
        <div className="container">
          <div className="badge">Live</div>
          <h1 className="h1" style={{ marginTop: 10 }}>
            Your journeys & refund status
          </h1>
          {!userEmail && (
            <>
              <p className="sub">You’re not signed in.</p>
              <div className="ctaRow">
                <Link className="btn btnPrimary" href="/">
                  Go to landing
                </Link>
              </div>
            </>
          )}

          {userEmail && (
            <>
              <p className="sub">
                We’re watching your tickets and filing Delay Repay when eligible.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 16,
                  marginTop: 18,
                }}
              >
                {(trips ?? []).map((t) => {
                  const delayed = (t.delay_minutes ?? 0) > 0;
                  return (
                    <div key={t.id} className="card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div
                          className="badge"
                          style={{
                            background: delayed ? "#fff1f1" : "#ecf8f2",
                            color: delayed ? "#b42323" : "var(--fg-green)",
                            borderColor: delayed ? "#ffd8d8" : "#d6f0e4",
                          }}
                        >
                          {delayed ? `Delayed ${t.delay_minutes}m` : "Not delayed"}
                        </div>
                        {t.potential_refund != null && (
                          <div className="small" style={{ fontWeight: 800, color: "var(--fg-navy)" }}>
                            £{t.potential_refund.toFixed(2)}
                          </div>
                        )}
                      </div>
                      <h3 style={{ margin: "10px 0 4px", color: "var(--fg-navy)", fontSize: 18 }}>
                        {(t.origin ?? "Unknown")} → {(t.destination ?? "Unknown")}
                      </h3>
                      <p className="small">
                        Depart: {t.depart_planned ? new Date(t.depart_planned).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                        <br />
                        Arrive: {t.arrive_planned ? new Date(t.arrive_planned).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>

              {trips && trips.length === 0 && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div className="kicker">Setup complete</div>
                  <p className="sub">
                    We’ll populate this list as we detect your e-tickets. Check back
                    after your next booking.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
