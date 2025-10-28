import Link from "next/link";

export default function Onboarding() {
  return (
    <main className="min-h-screen px-6 pt-20">
      <h2 className="text-xl font-bold">Make it seamless</h2>
      <p className="text-neutral-300 mt-2">
        Connect Gmail. We’ll auto-ingest tickets and file Delay Repay automatically (25% success fee).
      </p>

      <div className="space-y-3 mt-6">
        <Link
          href="/api/auth/google/start"
          className="block w-full text-center bg-brand-orange text-black px-4 py-3 rounded-2xl font-semibold"
        >
          Connect Gmail
        </Link>

        <button
          className="w-full bg-white/30 text-white/60 px-4 py-3 rounded-2xl font-semibold cursor-not-allowed"
          disabled
          aria-disabled="true"
          title="Outlook coming soon"
        >
          Connect Outlook (coming soon)
        </button>

        <div className="bg-neutral-900 rounded-2xl p-4 opacity-50">
          <div className="font-semibold">Magic BCC (coming soon)</div>
          <div className="text-neutral-500 mt-1 text-sm">
            We’ll generate this after Gmail is live.
          </div>
        </div>
      </div>
    </main>
  );
}
