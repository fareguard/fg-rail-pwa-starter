import { getSupabaseAdmin } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

async function fetchTrips() {
  const supa = getSupabaseAdmin();
  const { data, error } = await supa
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

async function callApi(path: string) {
  "use server";
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      cache: "no-store",
    });
    // don't crash the page on non-2xx — just log
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("callApi non-200", path, res.status, txt);
    }
  } catch (e) {
    console.error("callApi failed", path, e);
  }
  revalidatePath("/dashboard");
}

export default async function Dashboard() {
  const trips = await fetchTrips();

  return (
    <main className="min-h-screen px-6 pt-10 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold">Your trips</h1>
      <p className="text-neutral-400 mt-1">
        Parsed from your email confirmations. We’ll check delays and file claims automatically.
      </p>

      <div className="mt-4 flex gap-2">
        {/* Ingest: hit the real ingest endpoint directly */}
        <form action={callApi.bind(null, "/api/ingest/google/save")}>
          <button className="rounded-xl bg-neutral-900 px-4 py-2">Run ingest now</button>
        </form>

        {/* Eligibility check */}
        <form action={callApi.bind(null, "/api/eligibility/run")}>
          <button className="rounded-xl bg-neutral-900 px-4 py-2">Check eligibility</button>
        </form>
      </div>

      <div className="mt-6 grid gap-4">
        {trips.map((t: any) => (
          <div key={t.id} className="rounded-xl border border-neutral-800 p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">
                {t.origin || "—"} → {t.destination || "—"}
              </div>
              <div className="text-sm text-neutral-400">
                {new Date(t.created_at).toLocaleString()}
              </div>
            </div>

            <div className="mt-2 text-sm text-neutral-300">
              <div>Operator: {t.operator || "—"}</div>
              <div>Retailer: {t.retailer || "—"}</div>
              <div>Booking ref: {t.booking_ref || "—"}</div>
              <div>
                Planned:{" "}
                {t.depart_planned ? new Date(t.depart_planned).toLocaleString() : "—"} →{" "}
                {t.arrive_planned ? new Date(t.arrive_planned).toLocaleString() : "—"}
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <span className="text-xs rounded-full bg-neutral-900 px-2 py-1">
                Status: {t.status || "new"}
              </span>
              <span className="text-xs rounded-full bg-neutral-900 px-2 py-1">
                Eligible: {"eligible" in t ? (t.eligible ? "Yes" : "No") : "TBC"}
              </span>
            </div>
          </div>
        ))}

        {!trips.length && (
          <div className="text-neutral-400">No trips yet. Connect Gmail and run ingest.</div>
        )}
      </div>
    </main>
  );
}
