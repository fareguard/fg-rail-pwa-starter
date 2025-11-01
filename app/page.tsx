export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[#0a2a4a] flex items-center justify-center text-white font-bold">F</div>
            <span className="text-xl font-semibold text-[#0a2a4a]">FareGuard</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-700">
            <a href="/how-it-works" className="hover:text-[#0a2a4a]">How it works</a>
            <a href="/pricing" className="hover:text-[#0a2a4a]">Pricing</a>
            <a href="/dashboard" className="hover:text-[#0a2a4a]">Dashboard</a>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-[#0a2a4a]">
            Cheaper UK train tickets.<br />Automatic refunds.
          </h1>
          <p className="mt-4 text-slate-700 text-lg">
            We search fares, track your journey, and auto-file Delay Repay for you.
            £1.50 per booking. No win, no fee (20% of refunds).
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/search"
              className="inline-flex items-center justify-center rounded-lg bg-[#0a2a4a] px-5 py-3 text-white font-medium hover:opacity-90"
            >
              Search tickets
            </a>
            <a
              href="/get-started"
              className="inline-flex items-center justify-center rounded-lg border border-[#13a86b] px-5 py-3 text-[#0a2a4a] font-medium hover:bg-[#13a86b]/10"
            >
              Get started
            </a>
          </div>
          <p className="mt-3 text-sm text-slate-500">Works with Gmail and PDF e-tickets.</p>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 rounded-2xl bg-[#13a86b]/10 blur-lg" />
          <div className="relative rounded-2xl border shadow-sm bg-white">
            <div className="p-4 border-b">
              <p className="text-sm font-medium text-[#0a2a4a]">Sample refund timeline</p>
            </div>
            <ul className="p-4 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#13a86b]" />
                Book Wolverhampton → Birmingham (£6.40)
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#13a86b]" />
                Train delayed 38 minutes — we detect it automatically
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#13a86b]" />
                FareGuard files Delay Repay with Avanti
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#13a86b]" />
                Refund approved — money back to you (we keep 20%)
              </li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-600 flex flex-wrap items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} FareGuard</p>
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-[#0a2a4a]">Privacy</a>
            <a href="/terms" className="hover:text-[#0a2a4a]">Terms</a>
            <a href="/contact" className="hover:text-[#0a2a4a]">Contact</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
