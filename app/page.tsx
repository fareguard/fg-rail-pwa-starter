// app/page.tsx
import Link from "next/link";
import Image from "next/image";
import ConnectGmailButton from "./components/ConnectGmailButton";

const operators = [
  "Avanti West Coast","Great Western Railway","West Midlands Trains","Northern",
  "LNER","Thameslink","Southern","Southeastern","ScotRail","TransPennine",
];

export default function Home() {
  return (
    <>
      {/* Nav */}
      <div className="nav">
        <div className="container navInner">
          <div className="brand">
            <Link href="/">
              <Image src="/media/logo.png" width={132} height={32} alt="FareGuard" priority />
            </Link>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link className="btn btnGhost" href="/how-it-works">How it works</Link>
            <Link className="btn btnGhost" href="/pricing">Pricing</Link>
            <Link className="btn btnPrimary" href="/dashboard">Dashboard</Link>
          </div>
        </div>
      </div>

      {/* Full-bleed hero */}
      <section className="hero-bleed">
        <div className="heroImg" />
        <div className="container heroContent">
          <div className="card" style={{ padding: 22 }}>
            <div className="badge">Automatic refunds for UK train delays</div>
            <h1 className="h1" style={{ marginTop: 10 }}>
              Plug in once. Get back money forever.
            </h1>
            <p className="sub">
              We find your rail e-tickets in Gmail, detect delays, and auto-file Delay Repay.
              No forms. No hassle. If a claim is approved, the money goes to you.
            </p>
            <div className="ctaRow">
              <ConnectGmailButton />
              <Link href="/search" className="btn btnGhost">Search cheap tickets</Link>
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              Works with Gmail e-tickets. All major UK operators supported.
            </p>
          </div>
        </div>
      </section>

      {/* Operators */}
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

      {/* How it works */}
      <section className="section">
        <div className="container">
          <h2>How it works</h2>
          <div className="card">
            <ul className="list">
              <li><span className="dot" /><span>Connect Gmail (read-only). We only look for rail e-tickets.</span></li>
              <li><span className="dot" /><span>We match journeys, detect delays, and calculate what you’re owed.</span></li>
              <li><span className="dot" /><span>We auto-file the claim with the operator. You get paid when approved.</span></li>
            </ul>
            <div className="ctaRow" style={{ marginTop: 14 }}>
              <ConnectGmailButton label="Get started — free" />
            </div>
            <p className="small" style={{ marginTop: 8 }}>
              Transparent success fee shown after connection.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="container" style={{ display: "flex", gap: 16, flexWrap:"wrap" }}>
          <span>© {new Date().getFullYear()} FareGuard</span>
          <Link href="/privacy-policy">Privacy</Link>
          <Link href="/tos">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
      </footer>
    </>
  );
}
