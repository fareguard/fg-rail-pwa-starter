// app/page.tsx
import Link from "next/link";
import ConnectGmailButton from "@/components/ConnectGmailButton";

const operators = [
  "Avanti West Coast","Great Western Railway","West Midlands Trains","Northern",
  "LNER","Thameslink","Southern","Southeastern","ScotRail","TransPennine",
];

export default function Home() {
  return (
    <>
      {/* NAV */}
      <div className="nav">
        <div className="container navInner">
          <div className="brand">FareGuard</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link className="btn btnGhost" href="/how-it-works">How it works</Link>
            <Link className="btn btnGhost" href="/pricing">Pricing</Link>
            <Link className="btn btnGhost" href="/dashboard">Dashboard</Link>
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="hero">
        <div className="container heroGrid">
          <div>
            <div className="badge">Automatic refunds for UK train delays</div>
            <h1 className="h1" style={{ marginTop: 10 }}>
              Cheaper UK train tickets. <br /> Automatic refunds.
            </h1>
            <p className="sub">
              We track your journeys and auto-file Delay Repay—so you don’t miss
              money you’re owed. Set up once, then it runs in the background.
            </p>
            <div className="ctaRow">
              <ConnectGmailButton />
              <Link href="/search" className="btn btnGhost">
                Search tickets
              </Link>
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              Works with Gmail e-tickets. All UK operators supported.
            </p>
          </div>

          {/* Right card */}
          <div className="card">
            <div className="kicker">Plug & play</div>
            <h3 style={{ margin: "6px 0 8px", color: "var(--fg-navy)" }}>
              “You’ve been missing out on money.”
            </h3>
            <p className="small">
              We scan your inbox for past trips and show what you could have
              claimed. From now on, we’ll file eligible claims automatically.
            </p>
            <ul className="list">
              <li>
                <span className="dot" />
                <span>Detect delays (e.g. 30–60+ mins)</span>
              </li>
              <li>
                <span className="dot" />
                <span>Auto-file Delay Repay with the operator</span>
              </li>
              <li>
                <span className="dot" />
                <span>Approved? Money back to you. (Fee shown clearly.)</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* TRUST / OPERATORS */}
      <section className="section">
        <div className="container">
          <h2>All UK train operators</h2>
          <p className="small">If they offer Delay Repay, we support it.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
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

      {/* HOW IT WORKS */}
      <section className="section">
        <div className="container">
          <h2>How it works</h2>
          <div className="card">
            <ul className="list">
              <li>
                <span className="dot" />
                <span>
                  Connect Gmail (read-only). We only look for rail e-ticket emails.
                </span>
              </li>
              <li>
                <span className="dot" />
                <span>
                  We match journeys, detect delays, and calculate what you’re owed.
                </span>
              </li>
              <li>
                <span className="dot" />
                <span>
                  We file the claim with the operator. You get paid when approved.
                </span>
              </li>
            </ul>
            <div className="ctaRow" style={{ marginTop: 14 }}>
              <ConnectGmailButton label="Get started — free" />
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              Transparent pricing shown after connection. No surprises.
            </p>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container" style={{ display: "flex", gap: 16 }}>
          <span>© {new Date().getFullYear()} FareGuard</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </footer>
    </>
  );
}
