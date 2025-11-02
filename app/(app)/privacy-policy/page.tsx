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
            Last updated: <strong>November 2025</strong>
          </p>

          <div style={{ marginTop: 28, lineHeight: 1.7 }}>
            <p>
              This Privacy Policy describes how FareGuard (“we”, “our”, or “us”) collects,
              uses, and protects personal information in connection with our automated
              refund detection service.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>1. Information We Collect</h3>
            <p>
              We may collect account details, connected email data (limited to rail ticket
              emails), and technical information such as browser type or IP address.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>2. How We Use Information</h3>
            <p>
              Information is used to detect train delays, file Delay Repay claims, and
              improve our services. We never sell user data or share it without consent.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>3. Data Access & Security</h3>
            <p>
              We use Supabase for authentication and secure storage. All data transfers
              are encrypted, and only limited service processes can access your claim
              information.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>4. Gmail Integration</h3>
            <p>
              When connecting Gmail, we only read e-ticket and booking confirmation
              messages from known train providers. We do <strong>not</strong> access, store, or
              view unrelated personal emails. You may revoke access at any time via your
              Google account settings.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>5. Data Retention</h3>
            <p>
              Claim and trip data are retained only as long as needed to process refunds
              or comply with accounting regulations.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>6. Your Rights</h3>
            <p>
              You can request deletion of your data or disconnection of your Google
              account by contacting{" "}
              <a href="mailto:hello@fareguard.co.uk">hello@fareguard.co.uk</a>.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>7. Contact Us</h3>
            <p>
              Questions? Email us at{" "}
              <a href="mailto:hello@fareguard.co.uk">hello@fareguard.co.uk</a>.
            </p>
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
