export default function Home() {
  return (
    <main>
      <header className="fg-header">
        <div className="fg-container fg-header__inner">
          <a className="fg-logo" href="/">FareGuard</a>
          <nav className="fg-nav">
            <a href="/how-it-works">How it works</a>
            <a href="/pricing">Pricing</a>
            <a href="/dashboard">Dashboard</a>
          </nav>
        </div>
      </header>

      <section className="fg-hero">
        <div className="fg-container fg-hero__grid">
          <div className="fg-hero__copy">
            <h1>Cheaper UK train tickets.<br/>Automatic refunds.</h1>
            <p>
              We search fares, track your journey, and auto-file Delay Repay for you.
              £1.50 per booking. No win, no fee (20% of refunds).
            </p>
            <div className="fg-cta">
              <a className="fg-btn fg-btn--primary" href="/search">Search tickets</a>
              <a className="fg-btn fg-btn--outline" href="/get-started">Get started</a>
            </div>
            <p className="fg-hero__note">Works with Gmail and PDF e-tickets.</p>
          </div>

          <div className="fg-card fg-hero__card">
            <div className="fg-card__header">Sample refund timeline</div>
            <ul className="fg-list">
              <li>Book Wolverhampton → Birmingham (£6.40)</li>
              <li>Train delayed 38 minutes — we detect it automatically</li>
              <li>FareGuard files Delay Repay with Avanti</li>
              <li>Refund approved — money back to you (we keep 20%)</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="fg-footer">
        <div className="fg-container fg-footer__inner">
          <span>© {new Date().getFullYear()} FareGuard</span>
          <nav className="fg-footer__nav">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/contact">Contact</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
