// app/page.tsx
import Link from "next/link";
import styles from "./page.module.css"; // not required—kept for future if you want

export default function Home() {
  return (
    <>
      {/* NAV */}
      <nav className="nav">
        <div className="container navInner">
          <div className="brand">FareGuard</div>
          <div style={{display:"flex", gap:12}}>
            <Link href="/search" className="btn btnGhost">Search tickets</Link>
            <Link href="/onboarding" className="btn btnPrimary">Get started</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <div className="container heroGrid">
          <div>
            <span className="badge">
              <span>⚡</span> Automatic refunds
            </span>
            <h1 className="h1">Cheapest UK train tickets.<br/> Refunds handled for you.</h1>
            <p className="sub">
              £1.50 service fee per booking. If we don’t win a refund, you pay nothing.
              If we do, we take 20% of the refunded amount. Simple.
            </p>
            <div className="ctaRow">
              <Link href="/search" className="btn btnPrimary">Search tickets</Link>
              <Link href="/onboarding" className="btn btnGhost">Get started</Link>
            </div>
            <p className="small" style={{marginTop:10}}>
              Install the app: Share → Add to Home Screen
            </p>
          </div>

          {/* Right column: benefits card */}
          <div className="card">
            <h2>Why FareGuard?</h2>
            <ul className="list">
              <li><span className="dot" /> Best-price tickets from trusted retailers.</li>
              <li><span className="dot" /> We track delays automatically in the background.</li>
              <li><span className="dot" /> File Delay Repay for you with no forms.</li>
              <li><span className="dot" /> “No win, no fee” on refunds (20%).</li>
              <li><span className="dot" /> Works with Avanti, West Midlands Trains & more.</li>
            </ul>
          </div>
        </div>
      </header>

      {/* HOW IT WORKS */}
      <section className="section">
        <div className="container">
          <h2>How it works</h2>
          <ul className="list">
            <li><span className="dot" /> Connect your email or forward tickets to <b>tickets@fareguard.co.uk</b>.</li>
            <li><span className="dot" /> We detect journeys + delays and prepare your claim.</li>
            <li><span className="dot" /> You get updates and keep 80% of any refund.</li>
          </ul>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container">
          © {new Date().getFullYear()} FareGuard • <Link href="/legal">Legal</Link>
        </div>
      </footer>
    </>
  );
}
