"use client";

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
  created_at: string;
};

function fmt(dt: string | null) {
  if (!dt) return null;
  try {
    const d = new Date(dt);
    // e.g. Tue 15 Jul, 13:21
    return d.toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dt;
  }
}

export default function TripCard({ t }: { t: Trip }) {
  const dep = fmt(t.depart_planned);
  const arr = fmt(t.arrive_planned);

  return (
    <div className="card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* top row: operator + booking ref */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
          {t.operator && (
            <span className="badge" title="Operator">
              {t.operator}
            </span>
          )}
          {t.retailer && t.retailer !== t.operator && (
            <span className="badge" style={{ background: "#eef3ff", color: "#244" }} title="Retailer">
              {t.retailer}
            </span>
          )}
          {t.booking_ref && (
            <span className="badge" style={{ background: "#f3f7f0", color: "#264" }} title="Booking reference">
              Ref: {t.booking_ref}
            </span>
          )}
        </div>

        {/* route */}
        <div className="h5" style={{ margin: "2px 0 6px", color: "var(--fg-navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {(t.origin || "Unknown")}{t.destination ? " → " + t.destination : ""}
        </div>

        {/* times */}
        <div className="small" style={{ color: "var(--fg-muted)" }}>
          {dep ? `Departs: ${dep}` : "Departs: —"}
          {arr ? ` · Arrives: ${arr}` : ""}
        </div>
      </div>

      {/* status light (right) */}
      <div
        title={t.status || "new"}
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          background: "#e8f8ee",
          border: "1px solid #cfeee0",
          flex: "0 0 auto",
        }}
      />
    </div>
  );
}
