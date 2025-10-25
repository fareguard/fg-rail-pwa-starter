export default function Dashboard() {
  return (
    <main className="min-h-screen px-6 pt-20">
      <h2 className="text-xl font-bold">Dashboard</h2>
      <div className="mt-4 grid gap-3">
        <div className="bg-neutral-900 rounded-2xl p-4">
          <div className="font-semibold">Savings</div>
          <div className="text-emerald-400 mt-1">You’ve saved £0.00 so far</div>
        </div>
        <div className="bg-neutral-900 rounded-2xl p-4">
          <div className="font-semibold">My Tickets</div>
          <div className="text-neutral-400 mt-1 text-sm">Tickets appear here after onboarding.</div>
        </div>
        <div className="bg-neutral-900 rounded-2xl p-4">
          <div className="font-semibold">Claims</div>
          <div className="text-neutral-400 mt-1 text-sm">Submitted → Approved → Paid.</div>
        </div>
      </div>
    </main>
  );
}
