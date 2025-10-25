export default function Onboarding() {
  return (
    <main className="min-h-screen px-6 pt-20">
      <h2 className="text-xl font-bold">Make it seamless</h2>
      <p className="text-neutral-300 mt-2">
        Connect Gmail/Outlook (recommended) or add your Magic BCC. We’ll auto-ingest tickets and file claims automatically.
      </p>

      <div className="space-y-3 mt-6">
        <button className="w-full bg-brand-orange text-black px-4 py-3 rounded-2xl font-semibold">Connect Gmail</button>
        <button className="w-full bg-white text-black px-4 py-3 rounded-2xl font-semibold">Connect Outlook</button>
        <div className="bg-neutral-900 rounded-2xl p-4">
          <div className="font-semibold">Your Magic BCC</div>
          <div className="text-neutral-300 mt-1">u_xxxx@tickets.fareguard.co.uk</div>
          <div className="text-neutral-500 mt-2 text-sm">
            Add this once in Trainline/SplitMyFare account settings.
          </div>
        </div>
      </div>
    </main>
  );
}
