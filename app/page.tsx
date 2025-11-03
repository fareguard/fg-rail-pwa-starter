// app/page.tsx
import Image from "next/image";
import Link from "next/link";
import ConnectGmailButton from "./components/ConnectGmailButton";

const operators = [
  "Avanti West Coast","Great Western Railway","West Midlands Trains","Northern",
  "LNER","Thameslink","Southern","Southeastern","ScotRail","TransPennine",
];

export default function Home() {
  return (
    <>
      {/* ====== NAV ====== */}
      <div className="nav">
        <div className="container navInner">
          <div className="brand">
            <Image
              src="/media/logo.png"   // must exist exactly at /public/media/logo.png
              alt="FareGuard logo"
              width={176}              // maintain visible size
              height={44}
              priority
            />
          </div>
          <div className="navActions">
            <Link className="btn btnGhost" href="/how-it-works">How it works</Link>
            <Link className="btn btnGhost" href="/pricing">Pricing</Link>
            <Link className="btn btnGhost" href="/dashboard">Dashboard</Link>
          </div>
        </div>
      </div>

      {/* ====== HERO (simple, no absolute positioning) ====== */}
      <section className="hero">
        <div className="container heroGrid">
          <div>
            <div className="badge">Automatic refunds for UK train delays</div>
            <h1 className="h1" style={{ marginTop: 10 }}>
              Plug in once. Get back money forever.
            </h1>
            <p className="sub">
              We find your rail e-tickets in Gmail, detect delays, and auto-file Delay Repay —
              so you never miss money you’re owed. Set up once, then it runs in the background.
            </p>
            <div className="ctaRow">
              <ConnectGmailButton />
              <Link href="/search" className="btn btnGhost">Search cheap tickets</Link>
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              Works with Gmail e-tickets. All UK operators supported.
            </p>
          </div>

          <div className="card">
            <div className="kicker">Plug & play</div>
            <h3 style={{ margin: "6px 0 8px", color: "var(--fg-navy)" }}>
              “You’ve been missing out on money.”
            </h3>
            <p className="small">
              We scan your inbox for past trips and show what you could have claimed.
              From now on, we’ll file eligible claims automatically.
            </p>
            <ul className="list">
              <li><span className="dot" /><span>Detect delays (30–60+ mins)</span></li>
              <li><span className="dot" /><span>Auto-file with the operator</span></li>
              <li><span className="dot" /><span>Approved? Money back to you</span></li>
            </ul>
          </div>
        </div>
      </section>

      {/* ====== OPERATORS ====== */}
      <section className="section">
        <div className="container">
          <h2>All UK train operators</h2>
          <p className="small">If they offer Delay Repay, we support it.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {operators.map((op) => (
              <span
                key={op}
                className="badge"
                style={{ background:"#f2f6fb", color:"var(--fg-navy)", borderColor:"#e6eef7" }}
              >
                {op}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ====== HOW IT WORKS ====== */}
      <section className="section">
        <div className="container">
          <h2>How it works</h2>
          <div className="card">
            <ul className="list">
              <li><span className="dot" /><span>Connect Gmail (read-only) – we only look for rail e-tickets</span></li>
              <li><span className="dot" /><span>We match journeys, detect delays, and calculate what you’re owed</span></li>
              <li><span className="dot" /><span>We file the claim. You get paid when approved</span></li>
            </ul>
            <div className="ctaRow" style={{ marginTop: 14 }}>
              <ConnectGmailButton label="Get started — free" />
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              Transparent pricing shown after connection.
            </p>
          </div>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer className="footer">
        <div className="container" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span>© {new Date().getFullYear()} FareGuard</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </footer>
    </>
  );
}
