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

const operatorLine =
  "Avanti West Coast · GWR · LNER · Northern · Thameslink · ScotRail · Southeastern · and others";

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
            <h1 className="h1" style={{ marginTop: 6 }}>
              Never miss a train refund again.
            </h1>

            <p className="sub">
              FareGuard watches your train tickets and lets you know when you’re
              eligible for Delay Repay — so you can claim quickly without
              tracking journeys or deadlines yourself.
            </p>

            <div className="ctaRow">
              <ConnectGmailButton />
            </div>

            <p className="small" style={{ marginTop: 8 }}>
              Takes 30 seconds • Read-only access • Disconnect anytime
            </p>

            <p className="small" style={{ marginTop: 10, color: "var(--fg-muted)" }}>
              Works with Gmail e-tickets and all UK operators
            </p>
          </div>
        </div>
      </section>

      {/* SHORT EXPLANATION */}
      <section className="section">
        <div className="container">
          <div className="card" style={{ maxWidth: 840 }}>
            <p style={{ margin: 0 }}>
              If you travel by train in the UK, you’re often owed money for
              delays.
            </p>
            <p style={{ margin: "10px 0 0" }}>But most people forget to claim.</p>
            <p style={{ margin: "10px 0 0" }}>
              FareGuard keeps an eye on your tickets and reminds you when
              compensation is available — so nothing slips through.
            </p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section">
        <div className="container">
          <h2>How FareGuard works</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              marginTop: 12,
            }}
          >
            <div className="card">
              <span className="badge" style={{ marginBottom: 8 }}>
                1 · Connect Gmail
              </span>
              <h3 style={{ margin: "4px 0 6px" }}>Sign in securely with Google</h3>
              <p className="small">
                We use read-only access and only look at ticket emails.
              </p>
            </div>

            <div className="card">
              <span className="badge" style={{ marginBottom: 8 }}>
                2 · We track your journeys
              </span>
              <h3 style={{ margin: "4px 0 6px" }}>
                Your e-tickets are picked up automatically
              </h3>
              <p className="small">
                We match tickets to your trips so you don’t need to keep
                anything organised.
              </p>
            </div>

            <div className="card">
              <span className="badge" style={{ marginBottom: 8 }}>
                3 · Get a claim reminder
              </span>
              <h3 style={{ margin: "4px 0 6px" }}>
                A direct link with the details ready
              </h3>
              <p className="small">
                If a journey qualifies for Delay Repay, we email you a link to
                the operator’s claim form with the key details prepared.
              </p>
            </div>
          </div>

          <p className="small" style={{ marginTop: 12 }}>
            That’s it.
          </p>

          <div style={{ marginTop: 10 }}>
            <ConnectGmailButton />
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="section">
        <div className="container">
          <h2>Designed for everyday commuters</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
              marginTop: 12,
            }}
          >
            <div className="card">
              <h3 style={{ margin: "4px 0 6px" }}>Don’t miss refund deadlines</h3>
              <p className="small">
                Get reminders while you still have time to claim.
              </p>
            </div>

            <div className="card">
              <h3 style={{ margin: "4px 0 6px" }}>
                No forms to save or emails to search for
              </h3>
              <p className="small">
                Your tickets are already in Gmail — we surface what matters.
              </p>
            </div>

            <div className="card">
              <h3 style={{ margin: "4px 0 6px" }}>Runs quietly in the background</h3>
              <p className="small">
                Once connected, there’s nothing to maintain.
              </p>
            </div>

            <div className="card">
              <h3 style={{ margin: "4px 0 6px" }}>
                Works with all UK train operators
              </h3>
              <p className="small">
                If an operator offers Delay Repay, FareGuard supports it.
              </p>
            </div>

            <div className="card">
              <h3 style={{ margin: "4px 0 6px" }}>Set up once and forget about it</h3>
              <p className="small">
                One connection, then just claim when you’re eligible.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PRIVACY / TRUST */}
      <section className="section">
        <div className="container">
          <h2>Your inbox stays private</h2>

          <div className="card" style={{ maxWidth: 840, marginTop: 12 }}>
            <p className="small" style={{ margin: 0 }}>
              FareGuard uses secure, read-only access.
            </p>
            <p className="small" style={{ margin: "10px 0 0" }}>
              We never send emails, delete anything, or change your inbox. You can
              disconnect at any time.
            </p>
          </div>
        </div>
      </section>

      {/* ROADMAP */}
      <section className="section">
        <div className="container">
          <h2>What’s next</h2>

          <div className="card" style={{ maxWidth: 840, marginTop: 12 }}>
            <p className="small" style={{ margin: 0 }}>
              Right now, FareGuard reminds you when to claim.
            </p>
            <p className="small" style={{ margin: "10px 0 0" }}>
              We’re working towards fully automatic claims in the future to make
              the process even simpler.
            </p>
          </div>
        </div>
      </section>

      {/* OPERATORS */}
      <section className="section">
        <div className="container">
          <h2>Supported across the UK rail network</h2>
          <p className="small">
            If an operator offers Delay Repay, FareGuard supports it.
          </p>

          <p className="small" style={{ marginTop: 10, color: "var(--fg-muted)" }}>
            {operatorLine}
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 12,
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
              Stop missing the refunds you’re owed
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ConnectGmailButton />
              <p className="small" style={{ margin: 0 }}>
                Free to use • Takes 30 seconds
              </p>
            </div>
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
