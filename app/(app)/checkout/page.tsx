export default function Checkout() {
  return (
    <main className="min-h-screen px-6 pt-20">
      <h2 className="text-xl font-bold">Checkout</h2>
      <p className="text-neutral-300 mt-2">
        £1.50 FareGuard Service Fee covers automated Delay Repay. No win, no fee (we take 20% of approved refunds).
      </p>
      <div className="mt-6">
        <button className="bg-brand-orange text-black px-5 py-3 rounded-2xl font-semibold">
          Pay & Continue to Retailer
        </button>
      </div>
      <p className="text-neutral-500 text-sm mt-3">
        After purchase, your ticket will appear automatically via Gmail/Outlook or Magic BCC.
      </p>
    </main>
  );
}
