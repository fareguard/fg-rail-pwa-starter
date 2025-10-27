import Link from "next/link";

export default function Page() {
  return (
    <main className="min-h-screen flex flex-col items-center px-6 pt-24">
      <h1 className="text-3xl font-bold text-center">FareGuard</h1>
      <p className="mt-3 text-neutral-300 text-center">
        Cheapest UK train tickets with automatic refunds.<br/>
        £1.50 service fee per booking. No win, no fee (20% of refunds).
      </p>

      <div className="mt-8 flex gap-3">
        <Link
          href="/results"
          className="bg-brand-orange text-black px-5 py-3 rounded-2xl font-semibold"
        >
          Search tickets
        </Link>
        <Link
          href="/onboarding"
          className="bg-neutral-900 px-5 py-3 rounded-2xl"
        >
          Get started
        </Link>
      </div>

      <p className="mt-10 text-neutral-500 text-sm">
        Install: Share → Add to Home Screen
      </p>
    </main>
  );
}
