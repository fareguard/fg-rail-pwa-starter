'use client';
import Link from "next/link";
const mock = [
  { id: "r1", depart: "07:45", arrive: "10:08", duration: "2h23m", operator: "Avanti", price: 32.40, splitSaving: 7.10 },
  { id: "r2", depart: "08:15", arrive: "10:38", duration: "2h23m", operator: "Avanti", price: 36.80 }
];

export default function Results() {
  return (
    <main className="min-h-screen px-6 pt-20">
      <h2 className="text-xl font-bold mb-4">Cheapest options</h2>
      <div className="space-y-4">
        {mock.map(r => (
          <div key={r.id} className="bg-neutral-900 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{r.depart} → {r.arrive}</div>
                <div className="text-neutral-400 text-sm">{r.duration} • {r.operator}</div>
              </div>
              <div className="text-right">
                <div className="text-brand-orange font-bold text-lg">£{r.price.toFixed(2)}</div>
                {"splitSaving" in r && r.splitSaving
                  ? <div className="text-emerald-400 text-sm">Save £{r.splitSaving.toFixed(2)}</div>
                  : null}
              </div>
            </div>
            <div className="flex gap-3 mt-3">
              <Link href="/checkout" className="bg-brand-orange text-black px-4 py-2 rounded-xl font-semibold">Buy</Link>
              <Link href="/onboarding" className="bg-neutral-800 px-4 py-2 rounded-xl">Auto-refund details</Link>
            </div>
            <div className="text-neutral-500 text-xs mt-2">Auto-refund included. £1.50 FareGuard fee applies.</div>
          </div>
        ))}
      </div>
    </main>
  );
}
