// app/(app)/privacy-policy/page.tsx
import Link from "next/link";

export default function PrivacyPolicy() {
  return (
    <>
      <div className="nav">
        <div className="container navInner">
          <div className="brand">FareGuard</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link className="btn btnGhost" href="/">
              Home
            </Link>
            <Link className="btn btnGhost" href="/tos">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <h1 className="h1">FareGuard Privacy Policy</h1>
          <p className="sub" style={{ marginTop: 8 }}>
            Effective date: <strong>January 2026</strong>
            <br />
            Last updated: <strong>January 2026</strong>
          </p>

          <div style={{ marginTop: 28, lineHeight: 1.7 }}>
            <p>
              This Privacy Policy explains how FareGuard collects, uses, stores, and
              protects personal data when you use our services.
            </p>

            <p>
              FareGuard is committed to processing personal data lawfully, fairly, and
              transparently in accordance with:
            </p>
            <ul>
              <li>UK General Data Protection Regulation (UK GDPR)</li>
              <li>Data Protection Act 2018</li>
              <li>Privacy and Electronic Communications Regulations (PECR)</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>1. Who We Are</h3>
            <p>
              FareGuard is the data controller responsible for the personal data
              described in this policy.
            </p>
            <p>
              <strong>Controller:</strong> FareGuard
              <br />
              <strong>Website:</strong>{" "}
              <a href="https://fareguard.co.uk" target="_blank" rel="noreferrer">
                https://fareguard.co.uk
              </a>
              <br />
              <strong>Email:</strong>{" "}
              <a href="mailto:hello@fareguard.co.uk">hello@fareguard.co.uk</a>
            </p>
            <p>
              If you have any questions about this policy or wish to exercise your data
              protection rights, contact us using the details above.
            </p>
            <p>
              You also have the right to lodge a complaint with the Information
              Commissioner’s Office (ICO):{" "}
              <a href="https://ico.org.uk" target="_blank" rel="noreferrer">
                https://ico.org.uk
              </a>
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              2. Overview of How FareGuard Works
            </h3>
            <p>
              FareGuard is a software service that helps identify potential UK rail
              delay compensation eligibility.
            </p>
            <p>
              When you connect your Gmail account using Google OAuth, FareGuard performs
              automated processing to detect rail booking confirmation emails and
              extract relevant journey data.
            </p>
            <p>
              Our data processing pipeline is designed around strict data minimisation:
            </p>
            <ul>
              <li>Read-only Gmail access is established via Google OAuth.</li>
              <li>Emails are programmatically scanned for recognised rail booking confirmations only.</li>
              <li>Non-relevant emails are immediately discarded and not retained.</li>
              <li>Relevant booking emails are parsed to extract structured journey data.</li>
              <li>Email content (subject, body, sender information) is redacted and not stored at rest.</li>
              <li>Only structured journey data necessary to provide the service is retained.</li>
              <li>We do not modify, send, or delete emails in your Gmail account.</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              3. Personal Data We Collect
            </h3>

            <h4 style={{ marginTop: 16, color: "var(--fg-navy)" }}>3.1 Account Information</h4>
            <ul>
              <li>Email address obtained through Google Sign-In</li>
              <li>Authentication identifiers and session information</li>
            </ul>

            <h4 style={{ marginTop: 16, color: "var(--fg-navy)" }}>
              3.2 Gmail Booking Email Data (Limited Access)
            </h4>
            <p>
              Where you connect Gmail, we access booking confirmation emails issued by
              rail operators for the sole purpose of identifying journeys.
            </p>
            <p>From relevant booking emails we extract structured data such as:</p>
            <ul>
              <li>Travel dates</li>
              <li>Departure and arrival locations</li>
              <li>Ticket or booking reference</li>
              <li>Train operator</li>
              <li>Journey details</li>
            </ul>
            <p>Full email content is not stored after processing.</p>
            <p>Non-relevant emails are not retained.</p>

            <h4 style={{ marginTop: 16, color: "var(--fg-navy)" }}>
              3.3 Derived Journey and Claim Data
            </h4>
            <ul>
              <li>Structured journey records</li>
              <li>Eligibility assessments</li>
              <li>Claim tracking information</li>
              <li>Compensation status</li>
            </ul>

            <h4 style={{ marginTop: 16, color: "var(--fg-navy)" }}>
              3.4 Technical and Service Data
            </h4>
            <ul>
              <li>Log files and diagnostics</li>
              <li>Security monitoring data</li>
              <li>System performance information</li>
            </ul>
            <p>This data is used to maintain and secure the service.</p>

            <h4 style={{ marginTop: 16, color: "var(--fg-navy)" }}>3.5 Support Communications</h4>
            <p>If you contact us, we may process:</p>
            <ul>
              <li>Your email address</li>
              <li>Message content</li>
              <li>Support history</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              4. Data We Do Not Intentionally Collect
            </h3>
            <p>FareGuard does not intentionally collect:</p>
            <ul>
              <li>Passwords</li>
              <li>Unrelated email content</li>
              <li>Advertising identifiers</li>
              <li>Precise location data</li>
              <li>Device tracking data</li>
              <li>Biometric or special category data</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              5. How We Use Personal Data
            </h3>
            <p>We process personal data to:</p>
            <ul>
              <li>Provide the FareGuard service</li>
              <li>Identify rail journeys</li>
              <li>Assess potential refund eligibility</li>
              <li>Assist with claims</li>
              <li>Maintain service security</li>
              <li>Provide support</li>
              <li>Improve system reliability</li>
              <li>Comply with legal obligations</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              6. Lawful Bases for Processing
            </h3>
            <p>We rely on the following lawful bases under UK GDPR:</p>

            <p>
              <strong>Performance of a contract (Article 6(1)(b))</strong>
              <br />
              To provide the FareGuard service you request, including scanning booking
              emails and identifying refund eligibility.
            </p>

            <p>
              <strong>Consent (Article 6(1)(a))</strong>
              <br />
              To access your Gmail account via Google OAuth.
              <br />
              You may withdraw this consent at any time by disconnecting your account.
            </p>

            <p>
              <strong>Legitimate interests (Article 6(1)(f))</strong>
              <br />
              To:
            </p>
            <ul>
              <li>Maintain system security</li>
              <li>Prevent misuse</li>
              <li>Improve reliability</li>
              <li>Operate and administer the service</li>
            </ul>
            <p>We balance these interests against your rights and freedoms.</p>

            <p>
              <strong>Legal obligation (Article 6(1)(c))</strong>
              <br />
              Where required for regulatory, accounting, or legal compliance.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              7. Google Account and Gmail Integration
            </h3>
            <p>When you connect your Google account:</p>
            <ul>
              <li>Access is read-only</li>
              <li>Processing is automated and programmatic</li>
              <li>Only relevant booking emails are analysed</li>
              <li>Non-relevant emails are not retained</li>
              <li>Full email content is not stored at rest</li>
              <li>Human review occurs only where strictly necessary for technical support</li>
            </ul>
            <p>You may revoke access at any time through:</p>
            <ul>
              <li>Google account permissions, or</li>
              <li>The FareGuard dashboard</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              8. Google API Services User Data Policy
            </h3>
            <p>
              FareGuard’s use and transfer of information received from Google APIs
              complies with the Google API Services User Data Policy, including the
              Limited Use requirements.
            </p>
            <p>Gmail data is used solely to provide the FareGuard service requested by the user.</p>
            <p>Gmail data is not used for:</p>
            <ul>
              <li>Advertising</li>
              <li>Profiling unrelated to refund identification</li>
              <li>Training machine learning models</li>
              <li>Sale or transfer for independent third-party use</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              9. Automated Processing
            </h3>
            <p>
              FareGuard uses automated processing to assess whether journeys may be
              eligible for delay compensation schemes.
            </p>
            <p>This assessment:</p>
            <ul>
              <li>Does not produce legal or similarly significant effects</li>
              <li>Does not determine compensation outcomes</li>
              <li>Does not replace decisions made by rail operators</li>
            </ul>
          
            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>10. Data Sharing</h3>
            <p>We do not sell personal data.</p>
            <p>We share personal data only with:</p>
            <ul>
              <li>Service providers acting on our instructions</li>
              <li>Technical infrastructure providers</li>
              <li>Legal or regulatory authorities where required</li>
            </ul>
            <p>All processors are contractually bound to protect personal data.</p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              11. International Transfers
            </h3>
            <p>
              Where personal data is transferred outside the UK, we implement
              appropriate safeguards such as:
            </p>
            <ul>
              <li>UK International Data Transfer Agreement (IDTA)</li>
              <li>Standard contractual clauses</li>
              <li>Adequacy regulations where applicable</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>12. Data Retention</h3>
            <p>
              We retain personal data only as long as necessary for the purposes
              described.
            </p>
            <p>Typical retention periods:</p>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.12)" }}>
                      Data type
                    </th>
                    <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.12)" }}>
                      Retention
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
                      OAuth tokens
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
                      Until account disconnection
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
                      Structured journey and claim data
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
                      While account active and for 12 months after inactivity
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
                      Technical debugging data
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
                      7 to 14 days
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
                      Support correspondence
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
                      Up to 12 months
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 10px" }}>Legal and financial records</td>
                    <td style={{ padding: "8px 10px" }}>As required by law</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p style={{ marginTop: 12 }}>
              When no longer required, data is securely deleted or anonymised.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              13. Account Disconnection and Deletion
            </h3>
            <p>If you disconnect Gmail or delete your FareGuard account:</p>
            <ul>
              <li>OAuth tokens are revoked</li>
              <li>Associated personal data is deleted</li>
              <li>Processing stops immediately</li>
            </ul>
            <p>Some data may be retained where required by law.</p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              14. Cookies and Similar Technologies
            </h3>
            <p>
              FareGuard uses cookies and similar technologies necessary to:
            </p>
            <ul>
              <li>Maintain secure sessions</li>
              <li>Operate the service</li>
              <li>Ensure technical functionality</li>
            </ul>
            <p>We do not use advertising or tracking cookies.</p>
            <p>
              Where non-essential cookies are introduced, we will obtain consent in
              accordance with PECR.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              15. Security Measures
            </h3>
            <p>
              We implement appropriate technical and organisational security measures
              including:
            </p>
            <ul>
              <li>Encryption in transit and at rest</li>
              <li>Access control and authentication safeguards</li>
              <li>Data minimisation and redaction</li>
              <li>Monitoring and logging</li>
              <li>Secure hosting infrastructure</li>
            </ul>
            <p>
              No system can be guaranteed completely secure, but we continuously review
              our protections.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              16. Your Data Protection Rights
            </h3>
            <p>You have the right to:</p>
            <ul>
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion</li>
              <li>Restrict processing</li>
              <li>Object to processing</li>
              <li>Data portability</li>
              <li>Withdraw consent</li>
            </ul>
            <p>
              We respond to requests within one month where required by law.
            </p>
            <p>
              To exercise your rights, contact:{" "}
              <a href="mailto:support@fareguard.co.uk">support@fareguard.co.uk</a>
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              17. Changes to This Policy
            </h3>
            <p>
              We may update this policy from time to time. Material changes will be
              published on our website.
            </p>

            <p style={{ marginTop: 32 }}>
              <strong>End of Policy</strong>
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
