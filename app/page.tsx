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
              Automatic refunds for UK train delays
            </div>

            <h1 className="h1" style={{ marginTop: 10 }}>
              Plug in once. Get back money forever.
            </h1>

            <p className="sub">
              FareGuard watches your Gmail for rail e-tickets, tracks delays,
              and files Delay Repay on your behalf — so you don’t have to
              remember forms, deadlines, or claim numbers ever again.
            </p>

            <div className="ctaRow">
              <ConnectGmailButton />
              <Link href="/search" className="btn btnGhost">
                Search cheap tickets
              </Link>
            </div>

            <p className="small" style={{ marginTop: 8 }}>
              Works with Gmail e-tickets. All UK operators supported.
            </p>

            {/* “Trust strip” */}
            <p
              className="small"
              style={{ marginTop: 12, color: "var(--fg-muted)" }}
            >
              No inbox changes, read-only access, and you can disconnect
              any time.
            </p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section">
        <div className="container">
          <h2>How FareGuard works</h2>
          <p className="small" style={{ marginBottom: 16 }}>
            Simple background automation — built for everyday commuters.
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
                You sign in with Google. We only read travel emails, never send
                mail or touch anything else in your inbox.
              </p>
            </div>

            <div className="card">
              <span className="badge" style={{ marginBottom: 8 }}>
                2 · We detect your trips
              </span>
              <h3 style={{ margin: "4px 0 6px" }}>Tickets appear automatically</h3>
              <p className="small">
                FareGuard scans for e-tickets from Trainline, TrainPal and all
                major operators, then builds your journey timeline for you.
              </p>
            </div>

            <div className="card">
              <span className="badge" style={{ marginBottom: 8 }}>
                3 · We file Delay Repay
              </span>
              <h3 style={{ margin: "4px 0 6px" }}>You get the payout</h3>
              <p className="small">
                When a train is late enough to qualify, we prep the claim with
                your journey details and submit it, so the refund lands back
                with you.
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
                Delay Repay rules are confusing and easy to forget. FareGuard
                keeps watch for you and nudges claims before deadlines expire.
              </p>
            </div>

            <div className="card">
              <h3 style={{ margin: "4px 0 6px" }}>Set-and-forget</h3>
              <p className="small">
                Once connected, it runs quietly in the background. No forms to
                fill in after a long commute — your journeys are already saved.
              </p>
            </div>

            <div className="card">
              <h3 style={{ margin: "4px 0 6px" }}>Built for all UK operators</h3>
              <p className="small">
                From GWR to ScotRail, Avanti to Northern — if they offer Delay
                Repay, FareGuard knows how to read their emails.
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
              Connect once, let FareGuard watch your journeys, and only think
              about Delay Repay when the refund hits your account.
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
