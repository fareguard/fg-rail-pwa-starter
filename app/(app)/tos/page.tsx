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
            Effective Date: <strong>January 2026</strong><br />
            Last Updated: <strong>January 2026</strong>
          </p>

          <div style={{ marginTop: 28, lineHeight: 1.7 }}>
            <p>
              These Terms of Service (“Terms”) govern your access to and use of FareGuard,
              including any content, functionality, and services provided through{" "}
              <a href="https://fareguard.co.uk">https://fareguard.co.uk</a> (the “Service”).
              By accessing or using FareGuard, you agree to be bound by these Terms.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>1. Acceptance of Terms</h3>
            <p>
              By accessing or using the Service, you agree to comply with and be legally
              bound by these Terms. If you do not agree, you must not use FareGuard.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>2. Eligibility</h3>
            <p>To use FareGuard, you must:</p>
            <ul>
              <li>Be a resident of the United Kingdom</li>
              <li>Be at least 13 years of age</li>
              <li>Have a valid Gmail account</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>3. Services Provided</h3>
            <p>FareGuard is a third-party tool that:</p>
            <ul>
              <li>Scans your Gmail inbox for train e-tickets</li>
              <li>
                Matches journeys against eligible UK rail delay and compensation schemes
              </li>
              <li>
                Assists with the submission of refund or compensation claims
              </li>
            </ul>
            <p>
              FareGuard is not affiliated with any train operator, government body, or rail
              authority.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>4. Accounts &amp; Data</h3>
            <p>
              You are responsible for maintaining the confidentiality and security of your
              FareGuard account and any connected Gmail account.
            </p>
            <p>
              FareGuard uses Google OAuth for authentication. We do not request, store, or
              have access to your Google password.
            </p>
            <p>
              We do not sell or share personal data with third parties without your consent,
              except where required to provide the Service or comply with the law.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>5. Fees &amp; Commission</h3>
            <p>
              FareGuard is free to use. For each successful refund or compensation claim,
              FareGuard retains a commission of 20%, or an equivalent service fee as
              displayed on the website at the time of claim.
            </p>
            <p>
              Fees and commission structures may change with reasonable notice.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>6. Use of Service</h3>
            <p>
              You agree to use FareGuard only for lawful purposes and in accordance with
              these Terms. Misuse of the Service, including abuse, fraud, or interference
              with systems, may result in suspension or termination of access.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>7. Account Termination</h3>
            <p>
              We reserve the right to suspend or terminate your access to FareGuard at our
              discretion if you violate these Terms or misuse the Service.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              8. Disclaimers &amp; Limitation of Liability
            </h3>
            <p>
              FareGuard is provided on an “as is” and “as available” basis without
              warranties of any kind.
            </p>
            <p>
              We do not guarantee that any claim will result in a refund or compensation.
              FareGuard is not responsible for rejected or delayed claims, errors or
              decisions made by train operators or third-party providers, or service
              interruptions outside our control.
            </p>
            <p>
              Use of FareGuard is at your own discretion and risk.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>9. Legal Jurisdiction</h3>
            <p>
              These Terms are governed by and construed in accordance with the laws of
              England and Wales.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>10. Contact</h3>
            <p>
              If you have any questions about these Terms, you can contact us at{" "}
              <a href="mailto:hello@fareguard.co.uk">hello@fareguard.co.uk</a>.
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
