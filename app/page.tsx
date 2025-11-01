import Link from "next/link";
import Nav from "@/components/Nav";
import ConnectGmailButton from "@/components/ConnectGmailButton";

export default function HomePage() {
  return (
    <main>
      <Nav />

      <section className="hero">
        <div className="container heroGrid">
          <div>
            <span className="badge">
              <span className="dot" style={{ width: 6, height: 6, marginTop: 0 }}></span>
              Auto-refunds for UK trains
            </span>
            <h1 className="h1">Cheaper UK train tickets.<br/>Automatic refunds.</h1>
            <p className="sub">
              We search fares, track your journey, and auto-file Delay Repay for you.
              £1.50 per booking. No win, no fee (20% of refunds).
            </p>

            <div className="ctaRow">
              <Link className="btn btnPrimary" href="/search">Search tickets</Link>
              <Link className="btn btnGhost" href="/get-started">Get started</Link>
              <ConnectGmailButton />
            </div>

            <p className="small" style={{ marginTop: 8 }}>
              Works with Gmail and PDF e-tickets.
            </p>
          </div>

          <div className="card">
            <div className="kicker">Sample refund timeline</div>
            <ul className="list">
              <li><span className="dot"></span>Book Wolverhampton → Birmingham (£6.40)</li>
              <li><span className="dot"></span>Train delayed 38 minutes — we detect it automatically</li>
              <li><span className="dot"></span>FareGuard files Delay Repay with Avanti</li>
              <li><span className="dot"></span>Refund approved — money back to you (we keep 20%)</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Why FareGuard?</h2>
          <div className="card">
            <ul className="list">
              <li><span className="dot"></span>Cheapest fares finder (split tickets when possible)</li>
              <li><span className="dot"></span>Delay detection + auto-claims, hands-off</li>
              <li><span className="dot"></span>£1.50 per booking; then 20% only if we win you a refund</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>© {new Date().getFullYear()} FareGuard</span>
          <nav style={{ display: "flex", gap: 16 }}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/contact">Contact</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
