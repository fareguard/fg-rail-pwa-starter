// app/(app)/privacy-policy/page.tsx
import Link from "next/link";

export default function PrivacyPolicy() {
  return (
    <>
      <div className="nav">
        <div className="container navInner">
          <div className="brand">FareGuard</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link className="btn btnGhost" href="/">Home</Link>
            <Link className="btn btnGhost" href="/tos">Terms of Service</Link>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <h1 className="h1">Privacy Policy</h1>
          <p className="sub" style={{ marginTop: 8 }}>
            Effective date: <strong>January 2026</strong>
          </p>

          <div style={{ marginTop: 28, lineHeight: 1.7 }}>
            <p>
              FareGuard (“FareGuard”, “we”, “us”, or “our”) is committed to protecting
              your privacy and handling your personal data in a transparent and lawful
              manner, in accordance with the UK General Data Protection Regulation
              (“UK GDPR”) and the Data Protection Act 2018.
            </p>

            <p>
              This Privacy Policy explains how we collect, use, store, and protect
              personal data when you use our services.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>1. Who We Are</h3>
            <p>
              FareGuard is the data controller for the personal data described in this
              policy.
            </p>
            <p>
              For any privacy-related questions or requests, you can contact us at{" "}
              <a href="mailto:support@fareguard.co.uk">support@fareguard.co.uk</a>.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              2. Personal Data We Collect
            </h3>

            <p><strong>a. Account Information</strong></p>
            <p>Email address (provided via Google Sign-In)</p>

            <p><strong>b. Gmail E-Ticket Data</strong></p>
            <p>
              Rail e-ticket and booking confirmation emails from known train operators,
              including journey details such as travel date, route, and ticket reference.
            </p>
            <p>
              We access Gmail data solely for the purpose of identifying rail journeys
              relevant to refund eligibility. We do not access, read, or store unrelated
              personal emails.
            </p>

            <p><strong>c. Derived Journey Data</strong></p>
            <p>
              Parsed and structured journey and ticket information extracted from
              e-ticket emails to assess eligibility for refunds and track claims.
            </p>

            <p>
              We do not intentionally collect names, phone numbers, passwords, precise
              location data, device identifiers, or advertising identifiers.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              3. How We Use Your Personal Data
            </h3>
            <p>
              We process personal data to identify rail journeys from connected email
              accounts, assess eligibility for train delay refunds, provide information
              and updates relating to potential or submitted claims, and to operate,
              maintain, and secure our service.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              4. Legal Bases for Processing
            </h3>
            <p>
              We rely on the following legal bases under UK GDPR:
            </p>
            <ul>
              <li>
                Performance of a contract (Article 6(1)(b)) to provide the FareGuard
                service you request
              </li>
              <li>
                Consent (Article 6(1)(a)) for connecting and accessing your Gmail account,
                which you may withdraw at any time
              </li>
              <li>
                Legitimate interests (Article 6(1)(f)) to operate, secure, and improve
                our service where those interests are not overridden by your rights
              </li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              5. Gmail Integration
            </h3>
            <p>
              When you connect your Google account, access is limited to automated
              processing of rail e-ticket and booking confirmation emails. We do not
              permit human review of email content except where strictly necessary for
              technical support, and we do not store full email content beyond what is
              required to extract relevant journey details.
            </p>
            <p>
              You may revoke FareGuard’s access at any time via your Google account
              settings.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              6. Data Storage and Retention
            </h3>
            <p>
              Parsed journey and claim-related data is stored in a secure database hosted
              by Supabase. We retain personal data only for as long as necessary to
              identify and process potential refund claims, provide ongoing service to
              you, and comply with legal, accounting, or regulatory obligations.
            </p>
            <p>
              When data is no longer required, it is deleted or anonymised. You may also
              request deletion of your data at any time.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              7. Third-Party Processors and International Transfers
            </h3>
            <p>
              We use trusted third-party service providers to operate FareGuard,
              including Supabase for database and backend infrastructure. Where personal
              data is transferred outside the UK, appropriate safeguards such as
              standard contractual clauses are used in accordance with UK GDPR
              requirements.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>8. Data Sharing</h3>
            <p>
              We do not sell personal data. We do not share personal data with third
              parties except with service providers acting on our instructions, or
              where required by law or regulatory obligation.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              9. Your Data Protection Rights
            </h3>
            <p>
              Under UK GDPR, you have the right to access your personal data, request
              correction or deletion, restrict or object to processing, request data
              portability, and withdraw consent at any time where processing is based
              on consent.
            </p>
            <p>
              To exercise your rights, contact{" "}
              <a href="mailto:hello@fareguard.co.uk">hello@fareguard.co.uk</a>. You also
              have the right to lodge a complaint with the Information Commissioner’s
              Office (ICO).
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>10. Security</h3>
            <p>
              We implement appropriate technical and organisational measures to protect
              personal data. However, no system can be guaranteed to be completely
              secure.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              11. Changes to This Policy
            </h3>
            <p>
              We may update this Privacy Policy from time to time. Any material changes
              will be published on our website.
            </p>

            <p style={{ marginTop: 32 }}><strong>End of Policy</strong></p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container" style={{ display: "flex", gap: 16 }}>
          <span>© {new Date().getFullYear()} FareGuard</span>
          <Link href="/tos">Terms of Service</Link>
        </div>
      </footer>
    </>
  );
}
