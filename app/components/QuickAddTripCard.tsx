// app/components/QuickAddTripCard.tsx
"use client";
import { useState } from "react";

export default function QuickAddTripCard() {
  const [form, setForm] = useState({
    user_email: "",
    operator: "Avanti West Coast",
    origin: "",
    destination: "",
    booking_ref: "",
    depart_planned: "",
    arrive_planned: "",
  });
  const [status, setStatus] = useState<string | null>(null);

  const onChange = (e: any) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async () => {
    setStatus("Creating trip…");
    const r1 = await fetch("/api/trips", { method: "POST", body: JSON.stringify(form) });
    const j1 = await r1.json();
    if (!j1.ok) return setStatus(`Error: ${j1.error}`);

    setStatus("Enqueuing claim…");
    const r2 = await fetch("/api/queue", { method: "POST", body: JSON.stringify({ trip_id: j1.trip_id }) });
    const j2 = await r2.json();
    if (!j2.ok) return setStatus(`Error: ${j2.error}`);

    setStatus(`Queued for ${j2.provider}. Claim: ${j2.claim_id}`);
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="kicker">Dev • Manual loop</div>
      <h3 style={{ margin: "6px 0 8px", color: "var(--fg-navy)" }}>Quick add trip & queue claim</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <input className="card" placeholder="User email" name="user_email" value={form.user_email} onChange={onChange}/>
        <input className="card" placeholder="Operator (e.g., Avanti West Coast)" name="operator" value={form.operator} onChange={onChange}/>
        <input className="card" placeholder="Origin" name="origin" value={form.origin} onChange={onChange}/>
        <input className="card" placeholder="Destination" name="destination" value={form.destination} onChange={onChange}/>
        <input className="card" placeholder="Booking ref (optional)" name="booking_ref" value={form.booking_ref} onChange={onChange}/>
        <input className="card" placeholder="Depart planned (ISO)" name="depart_planned" value={form.depart_planned} onChange={onChange}/>
        <input className="card" placeholder="Arrive planned (ISO)" name="arrive_planned" value={form.arrive_planned} onChange={onChange}/>
      </div>

      <div className="ctaRow">
        <button className="btn btnPrimary" onClick={submit}>Create & Queue</button>
        {status && <span className="small">{status}</span>}
      </div>
    </div>
  );
}