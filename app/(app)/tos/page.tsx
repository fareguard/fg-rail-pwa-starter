// app/(app)/tos/page.tsx
import Link from "next/link";

export default function TermsOfService() {
  return (
    <>
      <div className="nav">
        <div className="container navInner">
          <div className="brand">FareGuard</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link className="btn btnGhost" href="/">Home</Link>
            <Link className="btn btnGhost" href="/privacy-policy">Privacy Policy</Link>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <h1 className="h1">Terms of Service</h1>
          <p className="sub" style={{ marginTop: 8 }}>
            Last updated: <strong>November 2025</strong>
          </p>

          <div style={{ marginTop: 28, lineHeight: 1.7 }}>
            <p>
              These Terms of Service (“Terms”) govern your access to and use of FareGuard,
              including any content, functionality, and services offered through
              fareguard.co.uk (the “Service”).
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>1. Acceptance of Terms</h3>
            <p>
              By accessing or using the Service, you agree to be bound by these Terms. If
              you do not agree, you may not use FareGuard.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>2. Use of Service</h3>
            <p>
              FareGuard provides automatic train delay refund detection for UK rail
              operators. You must be at least 13 years old to use this Service and agree
              to use it in compliance with all applicable laws.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>3. Accounts & Data</h3>
            <p>
              You are responsible for maintaining the confidentiality of your account and
              any connected email accounts. We do not sell or share personal data with
              third parties without consent.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>4. Fees & Payments</h3>
            <p>
              FareGuard charges a small service fee or commission per successful claim, as
              displayed on the website. Fees are subject to change with notice.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>5. Limitation of Liability</h3>
            <p>
              FareGuard is not affiliated with any train operator. We provide the service
              “as is” without warranties. We are not responsible for rejected or delayed
              claims caused by external providers.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>6. Contact</h3>
            <p>
              For questions about these Terms, contact us at{" "}
              <a href="mailto:support@fareguard.co.uk">support@fareguard.co.uk</a>.
            </p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container" style={{ display: "flex", gap: 16 }}>
          <span>© {new Date().getFullYear()} FareGuard</span>
          <Link href="/privacy-policy">Privacy Policy</Link>
        </div>
      </footer>
    </>
  );
}
