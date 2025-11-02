// app/(app)/dashboard/page.tsx
import { cookies } from "next/headers";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";

function StatusBadge({ status }: { status: string }) {
  const map: any = {
    pending: { bg: "#fff6e5", fg: "#9a6b00", label: "Pending" },
    queued: { bg: "#eef5ff", fg: "#1a4fbf", label: "Queued" },
    processing: { bg: "#f4f6ff", fg: "#3b4cc0", label: "Processing" },
    submitted: { bg: "#eefaf3", fg: "#0e7a3b", label: "Submitted" },
    approved: { bg: "#e8fff2", fg: "#0a8f43", label: "Approved" },
    failed: { bg: "#ffefef", fg: "#b00020", label: "Failed" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ background: s.bg, color: s.fg, padding: "6px 10px", borderRadius: 999, fontWeight: 700, fontSize: 12 }}>
      {s.label}
    </span>
  );
}

function makeIso(dateStr?: string, timeStr?: string) {
  const base = dateStr ? new Date(dateStr) : new Date();
  const [hh, mm] = (timeStr || "00:00").split(":").map((n) => parseInt(n || "0", 10));
  base.setHours(hh || 0, mm || 0, 0, 0);
  return base.toISOString();
}

async function getServerSupabase() {
  const cookieStore = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });
}

export default async function Dashboard() {
  const db = await getServerSupabase();

  // Latest claims with basic trip context
  const { data: claims } = await db
    .from("claims")
    .select("id, status, provider_ref, created_at, submitted_at, error, trip:trip_id (origin, destination, depart_planned, arrive_planned)")
    .order("created_at", { ascending: false })
    .limit(20);

  // Show dev manual form only when explicitly enabled in env
  const showDev = process.env.NEXT_PUBLIC_SHOW_DEV === "1";

  return (
    <div className="container" style={{ padding: "24px 0 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="h1">Your journeys & refund status</h1>
        <div className="small">Hi, <strong>{/* show email if you want */}</strong></div>
      </div>
      <p className="sub">We’re watching your tickets and filing Delay Repay when eligible.</p>

      {showDev && (
        <form
          action={async (formData) => {
            "use server";
            const email = String(formData.get("email") || "");
            const operator = String(formData.get("operator") || "");
            const origin = String(formData.get("origin") || "");
            const destination = String(formData.get("destination") || "");
            const booking_ref = String(formData.get("booking_ref") || "");
            const departTime = String(formData.get("depart_time") || "00:00");
            const arriveTime = String(formData.get("arrive_time") || "00:00");
            const departISO = makeIso(String(formData.get("depart_date") || ""), departTime);
            const arriveISO = makeIso(String(formData.get("arrive_date") || ""), arriveTime);

            // find user_id by email (helper RPC OR profiles table)
            const uid = await (async () => {
              const { data: prof } = await db.from("profiles").select("user_id").eq("user_email", email).maybeSingle();
              if (prof?.user_id) return prof.user_id;
              const { data: rpc } = await db.rpc("get_auth_user_id_by_email", { p_email: email }).maybeSingle();
              return rpc?.user_id || null;
            })();

            if (!uid) throw new Error("No user found for that email");

            // insert trip
            const { data: trip, error: tErr } = await db
              .from("trips")
              .insert({
                user_id: uid,
                user_email: email,
                operator,
                origin,
                destination,
                booking_ref,
                depart_planned: departISO,
                arrive_planned: arriveISO,
                status: "planned",
                source: "manual",
              })
              .select("id")
              .single();
            if (tErr || !trip?.id) throw tErr || new Error("trip insert failed");

            // insert claim
            const { data: claim, error: cErr } = await db
              .from("claims")
              .insert({
                trip_id: trip.id,
                user_id: uid,
                user_email: email,
                status: "pending",
                fee_pct: 25,
                meta: {
                  origin,
                  destination,
                  booking_ref,
                  depart_planned: departISO,
                  arrive_planned: arriveISO,
                  operator,
                },
              })
              .select("id")
              .single();
            if (cErr || !claim?.id) throw cErr || new Error("claim insert failed");

            // queue it
            await db.from("claim_queue").insert({
              claim_id: claim.id,
              provider: operator?.toLowerCase().includes("avanti")
                ? "avanti"
                : operator?.toLowerCase().includes("west midlands")
                ? "wmt"
                : "avanti", // default for now
              status: "queued",
              payload: {
                user_email: email,
                booking_ref,
                operator,
                origin,
                destination,
                depart_planned: departISO,
                arrive_planned: arriveISO,
              },
            });
          }}
          style={{ marginTop: 16, padding: 16, border: "1px dashed #e5eaf0", borderRadius: 12 }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Dev • Manual loop</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 280px))", gap: 10 }}>
            <input name="email" placeholder="email" defaultValue="hassanisherenow@gmail.com" />
            <input name="operator" placeholder="operator" defaultValue="Avanti West Coast" />
            <input name="booking_ref" placeholder="booking ref" defaultValue="12345678" />
            <input name="origin" placeholder="origin" defaultValue="Wolverhampton" />
            <input name="destination" placeholder="destination" defaultValue="Birmingham New Street" />
            <input name="depart_date" placeholder="depart date (YYYY-MM-DD)" />
            <input name="depart_time" placeholder="depart HH:mm" defaultValue="18:45" />
            <input name="arrive_date" placeholder="arrive date (YYYY-MM-DD)" />
            <input name="arrive_time" placeholder="arrive HH:mm" defaultValue="19:07" />
          </div>
          <button className="btn btnPrimary" style={{ marginTop: 12 }} type="submit">
            Create & Queue
          </button>
        </form>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16, marginTop: 24 }}>
        {(claims || []).map((c: any) => (
          <div key={c.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ color: "var(--fg-navy)" }}>
                {c.trip?.origin} → {c.trip?.destination}
              </strong>
              <StatusBadge status={c.status} />
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              {new Date(c?.trip?.depart_planned || c.created_at).toLocaleString()}
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              {c.provider_ref ? <>Ref: <code>{c.provider_ref}</code></> : <>Awaiting provider ref…</>}
            </div>
            {c.error && (
              <div className="small" style={{ marginTop: 6, color: "#b00020" }}>
                {c.error}
              </div>
            )}
          </div>
        ))}
      </div>

      {!claims?.length && (
        <div className="card" style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 800, color: "var(--fg-green)" }}>Setup complete</div>
          <p className="small" style={{ marginTop: 6 }}>
            We’ll populate this list as we detect your e-tickets. Check back after your next booking.
          </p>
        </div>
      )}

      <footer className="footer" style={{ marginTop: 32 }}>
        <div className="container" style={{ display: "flex", gap: 16 }}>
          <span>© {new Date().getFullYear()} FareGuard</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </footer>
    </div>
  );
}
