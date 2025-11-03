// app/(app)/dashboard/page.tsx
import { cookies } from "next/headers";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";

type Row = {
  claim_id: string;
  user_id: string | null;
  user_email: string | null;
  claim_status: string | null;
  claim_created_at: string;

  operator: string | null;
  origin: string | null;
  destination: string | null;
  depart_planned: string | null;   // timestamptz
  arrive_planned: string | null;   // timestamptz

  provider: string | null;
  queue_status: string | null;
  queue_updated_at: string | null;
};

function fmt(dt?: string | null) {
  if (!dt) return "";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt || "";
  }
}

function StatusBadge({ label, tone = "pending" }: { label: string; tone?: "pending" | "submitted" | "error" | "done" }) {
  const bg =
    tone === "done" ? "#e8f7ee"
      : tone === "error" ? "#fde8e8"
      : tone === "submitted" ? "#eaf2ff"
      : "#f6f9fb";
  const fg =
    tone === "done" ? "#127a4a"
      : tone === "error" ? "#b42318"
      : tone === "submitted" ? "#0F2A43"
      : "#0F2A43";

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "6px 10px",
      borderRadius: 999,
      background: bg,
      color: fg,
      fontWeight: 700,
      fontSize: 14,
    }}>
      {label}
    </span>
  );
}

function statusTone(s?: string | null): "pending" | "submitted" | "error" | "done" {
  const v = (s || "").toLowerCase();
  if (["queued", "pending"].includes(v)) return "pending";
  if (["submitted", "processing"].includes(v)) return "submitted";
  if (["failed", "error"].includes(v)) return "error";
  if (["approved", "paid", "complete", "completed"].includes(v)) return "done";
  return "pending";
}

/**
 * Renders the example chip row inside each trip card.
 * Matches your example:
 *  - pending/queued      -> "Claim queued" (chip warn)
 *  - submitted/processing-> "Submitted" (chip ok)
 *  - no-delay            -> "Not delayed" (plain chip)
 *  - error/failed        -> "Action needed" (chip err)
 */
function ClaimChips({ status }: { status?: string | null }) {
  const v = (status || "").toLowerCase();

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      {(["pending", "queued"].includes(v)) && <span className="chip warn">Claim queued</span>}
      {(["submitted", "processing"].includes(v)) && <span className="chip ok">Submitted</span>}
      {(["no-delay", "no delay", "not delayed", "not_delayed"].includes(v)) && <span className="chip">Not delayed</span>}
      {(["error", "failed"].includes(v)) && <span className="chip err">Action needed</span>}
    </div>
  );
}

export default async function Dashboard() {
  // SSR Supabase client (works on Vercel)
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  // Get the logged-in user (email + id)
  const { data: userResp } = await supabase.auth.getUser();
  const user = userResp?.user || null;

  // If not logged in, show gentle nudge
  if (!user) {
    return (
      <>
        <div className="nav">
          <div className="container navInner">
            <div className="brand">FareGuard</div>
            <div style={{ display: "flex", gap: 10 }}>
              <Link className="btn btnGhost" href="/how-it-works">How it works</Link>
              <Link className="btn btnGhost" href="/pricing">Pricing</Link>
            </div>
          </div>
        </div>

        <section className="section">
          <div className="container">
            <h1 className="h1">Your journeys & refund status</h1>
            <p className="sub">Sign in to see your claims.</p>
            <div className="ctaRow" style={{ marginTop: 16 }}>
              <Link href="/" className="btn btnPrimary">Connect Gmail (1-click)</Link>
            </div>
          </div>
        </section>
      </>
    );
  }

  // Pull only YOUR claims (via the view), newest first
  // Prefer user_id, but fall back to user.email if needed.
  const { data: rowsById } = await supabase
    .from("dashboard_claims")
    .select("*")
    .eq("user_id", user.id)
    .order("claim_created_at", { ascending: false })
    .limit(60);

  let rows: Row[] = (rowsById || []) as any;

  if ((!rows || rows.length === 0) && user.email) {
    const { data: rowsByEmail } = await supabase
      .from("dashboard_claims")
      .select("*")
      .eq("user_email", user.email)
      .order("claim_created_at", { ascending: false })
      .limit(60);

    rows = (rowsByEmail || []) as any;
  }

  return (
    <>
      <div className="nav">
        <div className="container navInner">
          <div className="brand">FareGuard</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="small">Hi, {user.email}</span>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <h1 className="h1">Your journeys & refund status</h1>
          <p className="sub">We’re watching your tickets and filing Delay Repay when eligible.</p>

          {(!rows || rows.length === 0) ? (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="kicker">Setup complete</div>
              <p className="small">We’ll populate this list as we detect your e-tickets. Check back after your next booking.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 18, marginTop: 18 }}>
              {rows.map((r) => {
                const mainStatus = r.queue_status || r.claim_status || "Pending";
                return (
                  <div key={r.claim_id} className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ fontWeight: 800, color: "var(--fg-navy)", lineHeight: 1.2 }}>
                        {(r.origin || "—") + " → " + (r.destination || "—")}
                      </div>
                      <StatusBadge label={mainStatus} tone={statusTone(mainStatus)} />
                    </div>

                    <div className="small" style={{ marginTop: 8 }}>
                      {fmt(r.depart_planned)}
                    </div>
                    <div className="small" style={{ marginTop: 4 }}>
                      {r.provider ? `Provider: ${r.provider}` : "Awaiting provider ref..."}
                    </div>

                    {/* example inside your trip card */}
                    <ClaimChips status={mainStatus} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
