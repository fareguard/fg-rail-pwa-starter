// app/page.tsx
import Link from "next/link";
import Image from "next/image";
import ConnectGmailButton from "./components/ConnectGmailButton";

const operators = [
  "Avanti West Coast", "Great Western Railway", "West Midlands Trains", "Northern",
  "LNER", "Thameslink", "Southern", "Southeastern", "ScotRail", "TransPennine",
];

export default function Home() {
  return (
    <>
      {/* NAVBAR */}
      <div className="nav">
        <div className="container navInner">
          <div className="brand">
            <Link href="/">
              <Image
                src="/media/logo.png"
                alt="FareGuard logo"
                width={160}
                height={44}
                priority
              />
            </Link>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link className="btn btnGhost" href="/how-it-works">How it works</Link>
            <Link className="btn btnGhost" href="/pricing">Pricing</Link>
            <Link className="btn btnGhost" href="/dashboard">Dashboard</Link>
          </div>
        </div>
      </div>

      {/* HERO */}
      <section className="hero" style={{ position: "relative", overflow: "hidden" }}>
        {/* Full-width hero image */}
        <div style={{ position: "relative", width: "100%", height: "520px" }}>
          <Image
            src="/hero.png"
            alt="UK train station"
            fill
            priority
            sizes="100vw"
            style={{ objectFit: "cover", objectPosition: "center" }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.85) 45%, rgba(255,255,255,0) 100%)",
            }}
          />
        </div>

        {/* Hero content centered */}
        <div
          className="container"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "100%",
            zIndex: 2,
          }}
        >
          <div className="badge">Automatic refunds for UK train delays</div>
          <h1 className="h1" style={{ marginTop: 10 }}>
            Cheaper UK train tickets. <br /> Automatic refunds.
          </h1>
          <p className="sub">
            We track your journeys and auto-file Delay Repay — so you never miss
            money you’re owed. Set up once, then it runs in the background.
          </p>
          <div className="ctaRow">
            <ConnectGmailButton />
            <Link href="/search" className="btn btnGhost">Search tickets</Link>
          </div>
          <p className="small" style={{ marginTop: 8 }}>
            Works with Gmail e-tickets. All UK operators supported.
          </p>
        </div>
      </section>

      {/* OPERATORS */}
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
          <div
            className="card"
            style={{
              background: "white",
              borderRadius: "16px",
              padding: "24px",
            }}
          >
            <ul className="list">
              <li><span className="dot" /><span>Connect Gmail (read-only) — we only look for rail e-tickets</span></li>
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

      {/* FOOTER */}
      <footer className="footer">
        <span>© {new Date().getFullYear()} FareGuard</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
      </footer>
    </>
  );
}
