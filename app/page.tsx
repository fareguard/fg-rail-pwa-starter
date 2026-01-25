// app/page.tsx
import Image from "next/image";
import Link from "next/link";
import ConnectGmailButton from "./components/ConnectGmailButton";
import AutoConnect from "./components/AutoConnect";

const operators = [
  "Avanti West Coast",
  "Great Western Railway",
  "West Midlands Trains",
  "Northern",
  "LNER",
  "Thameslink",
  "Southern",
  "Southeastern",
  "ScotRail",
  "TransPennine",
];

export default function Home() {
  const year = new Date().getFullYear();

  return (
    <>
      {/* auto-open Google when ?connect=1 is present */}
      <AutoConnect />

      {/* NAV */}
      <div className="nav">
        <div className="container navInner">
          <div className="brand">
            <Image
              src="/media/logo.png"
              alt="FareGuard"
              width={240}
              height={56}
              priority
            />
          </div>
          <div className="navActions">
            <Link className="btn btnGhost" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="hero">
        <div className="container heroGrid">
          <div>
            <div className="badge">
              Never miss a refund again for UK train delays
            </div>

            <h1 className="h1" style={{ marginTop: 10 }}>
              Delays tracked. Money back.
            </h1>

            <p className="sub">
              FareGuard tracks your journeys, spots delays, and reminds you to claim
              what you’re owed — because we know delays are frustrating enough.
            </p>

            <div className="ctaRow">
              <ConnectGmailButton />
            </div>

            <p className="small" style={{ marginTop: 8 }}>
              Works with e-tickets stored on Gmail • All UK operators supported
            </p>

            {/* “Trust strip” */}
            <p
              className="small"
              style={{ marginTop: 12, color: "var(--fg-muted)" }}
            >
              Secure, read-only access to your tickets.
            </p>
          </div>
        </div>
      </section>

{/* HOW IT WORKS */}
<section className="section">
  <div className="container">
    <h2>How FareGuard works</h2>
    <p className="small" style={{ marginBottom: 16 }}>
      Simple background automation — built for everyday commuters and occasional travellers.
    </p>

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16,
      }}
    >
      <div className="card">
        <span className="badge" style={{ marginBottom: 8 }}>
          1 · Connect Gmail
        </span>
        <h3 style={{ margin: "4px 0 6px" }}>Secure, read-only access</h3>
        <p className="small">
          Sign in with Google so FareGuard can securely find your train tickets
          and track your journeys. We only use ticket emails.
        </p>
      </div>

      <div className="card">
        <span className="badge" style={{ marginBottom: 8 }}>
          2 · We detect your trips
        </span>
        <h3 style={{ margin: "4px 0 6px" }}>Tickets appear automatically</h3>
        <p className="small">
          We automatically pick up e-tickets from most train ticket retailers
          and train operators, so you don’t have to add anything manually.
        </p>
      </div>

      <div className="card">
        <span className="badge" style={{ marginBottom: 8 }}>
          3 · Get reminded to claim
        </span>
        <h3 style={{ margin: "4px 0 6px" }}>Never miss money you’re owed</h3>
        <p className="small">
          When a delay qualifies for Delay Repay, we send you a simple email reminder 
          so you can claim it without having to keep track.
        </p>
      </div>
    </div>
  </div>
</section>
      
{/* BENEFITS */}
<section className="section">
  <div className="container">
    <h2>Why commuters use FareGuard</h2>

    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 16,
        marginTop: 8,
      }}
    >
      <div className="card">
        <h3 style={{ margin: "4px 0 6px" }}>Never miss a claim</h3>
        <p className="small">
          Claiming Delay Repay is easy to forget. FareGuard tracks your journeys
          and reminds you as soon as you're eligible.
        </p>
      </div>

      <div className="card">
        <h3 style={{ margin: "4px 0 6px" }}>Set-and-forget</h3>
        <p className="small">
          Connect once and you never need to touch it again, keeping your trips
          organised and ready when you need to claim.
        </p>
      </div>

      <div className="card">
        <h3 style={{ margin: "4px 0 6px" }}>Built for all UK operators</h3>
        <p className="small">
          From GWR to ScotRail, Avanti to Northern —
          FareGuard helps you never miss money you’re owed.
        </p>
      </div>
    </div>
  </div>
</section>
      
      {/* OPERATORS */}
      <section className="section">
        <div className="container">
          <h2>All UK train operators</h2>
          <p className="small">If they offer Delay Repay, we support it.</p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 8,
            }}
          >
            {operators.map((op) => (
              <span
                key={op}
                className="badge"
                style={{
                  background: "#f2f6fb",
                  color: "var(--fg-navy)",
                  borderColor: "#e6eef7",
                }}
              >
                {op}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="section">
        <div className="container">
          <div className="card">
            <h2 style={{ margin: "0 0 8px" }}>
              Ready to stop leaving money on the tracks?
            </h2>
            <p className="small" style={{ marginBottom: 12 }}>
              Connect once, let FareGuard track your journeys, 
              and only think about Delay Repay when it’s time to claim.
            </p>
            <ConnectGmailButton />
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div
          className="container"
          style={{ display: "flex", gap: 16, flexWrap: "wrap" }}
        >
          <span>© {year} FareGuard</span>
          <Link href="/privacy-policy">Privacy</Link>
          <Link href="/tos">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </footer>
    </>
  );
}
