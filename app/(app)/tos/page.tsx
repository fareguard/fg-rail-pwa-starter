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
          <h1 className="h1">FareGuard Terms of Service</h1>
          <p className="sub" style={{ marginTop: 8 }}>
            Effective date: <strong>February 2026</strong><br />
            Last updated: <strong>February 2026</strong>
          </p>

          <div style={{ marginTop: 28, lineHeight: 1.7 }}>

            <p>
              These Terms of Service (“Terms”) govern your access to and use of FareGuard,
              including the website located at{" "}
              <a href="https://fareguard.co.uk">https://fareguard.co.uk</a> and all related
              services (the “Service”).
            </p>

            <p>
              FareGuard is operated by FareGuard Ltd, a company registered in England and
              Wales under company number 16810407, with registered office at 64 Lincoln
              Street, Birmingham, B12 9EX (“FareGuard”, “we”, “us”, or “our”).
            </p>

            <p>
              By accessing or using the Service, you confirm that you accept these Terms and
              agree to be legally bound by them. If you do not agree, you must not use the
              Service.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>1. Eligibility</h3>
            <p>To use the Service, you must:</p>
            <ul>
              <li>be resident in the United Kingdom;</li>
              <li>be at least 13 years old;</li>
              <li>have a valid Google account capable of granting Gmail access via Google OAuth; and</li>
              <li>provide accurate and complete information when using the Service.</li>
            </ul>
            <p>
              If you are under 18, you confirm that a parent or legal guardian has authorised
              your use of the Service.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>2. What FareGuard Does</h3>
            <p>
              FareGuard is an automated software service that helps users identify when they
              may be eligible to claim compensation or refunds for UK rail journeys.
            </p>
            <p>The Service operates by:</p>
            <ul>
              <li>securely connecting to your Gmail account using Google OAuth with read-only permission;</li>
              <li>automatically identifying rail e-ticket and booking confirmation emails;</li>
              <li>extracting structured journey information such as travel dates, routes, operators, and booking references;</li>
              <li>monitoring journey data to detect potential delay compensation eligibility; and</li>
              <li>notifying you when you may wish to submit a claim.</li>
            </ul>

            <p>FareGuard provides automated detection and reminders only.</p>
            <p>FareGuard does not:</p>
            <ul>
              <li>submit claims on your behalf;</li>
              <li>act as your representative or agent;</li>
              <li>communicate with train operators for claim purposes;</li>
              <li>receive, manage, or distribute compensation payments; or</li>
              <li>determine whether compensation will be awarded.</li>
            </ul>

            <p>
              You decide whether to submit a claim and must do so directly with the relevant
              train operator.
            </p>
            <p>
              FareGuard is independent of all rail operators, regulators, and government
              authorities.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              3. Automated Processing and Accuracy
            </h3>
            <p>
              The Service operates using automated systems that analyse relevant booking
              emails and structured journey data.
            </p>
            <p>
              Eligibility notifications are informational only and may not be complete or
              accurate in every case.
            </p>
            <p>
              You are responsible for independently verifying any entitlement before
              submitting a claim.
            </p>
            <p>
              FareGuard does not make legal, financial, or compensation decisions.
            </p>
            <p>
              FareGuard also does not guarantee detection of all journeys, delays, or
              compensation opportunities for which you may be eligible. Detection depends on
              the availability, structure, and successful processing of relevant booking
              information. You remain responsible for independently checking train operator
              compensation schemes and submitting any claims you wish to make.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              4. Gmail Access and Data Processing
            </h3>
            <p>
              To use FareGuard, you must authorise access to your Gmail account through
              Google OAuth.
            </p>
            <p>Access is strictly read-only.</p>
            <p>FareGuard:</p>
            <ul>
              <li>identifies recognised rail booking confirmation emails;</li>
              <li>extracts structured journey information required to operate the Service;</li>
              <li>does not store full email content after processing; and</li>
              <li>does not send, edit, or delete emails in your Gmail account.</li>
            </ul>
            <p>Non-relevant emails are not retained.</p>
            <p>
              Processing is automated and programmatic. Human review occurs only where
              strictly necessary for technical support or service reliability.
            </p>
            <p>
              You may revoke Gmail access at any time through your Google account permissions
              or within the Service. Some functionality may stop if access is revoked.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              5. User Responsibilities
            </h3>
            <p>You agree to:</p>
            <ul>
              <li>review notifications provided by the Service;</li>
              <li>independently confirm claim eligibility;</li>
              <li>submit claims directly to train operators yourself;</li>
              <li>ensure any claim you submit is accurate and lawful; and</li>
              <li>notify us promptly of unauthorised access or technical issues.</li>
            </ul>
            <p>You are responsible for any claim you choose to make.</p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>6. Acceptable Use</h3>
            <p>You must not:</p>
            <ul>
              <li>attempt to access or interfere with other users’ data;</li>
              <li>misuse Gmail access permissions;</li>
              <li>attempt to reverse engineer or extract source code;</li>
              <li>interfere with the operation or security of the Service;</li>
              <li>use the Service for unlawful purposes; or</li>
              <li>provide false or misleading information.</li>
            </ul>
            <p>
              We may suspend or restrict access where misuse is reasonably suspected.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>7. Service Availability</h3>
            <p>
              We aim to provide continuous access but do not guarantee uninterrupted
              availability.
            </p>
            <p>The Service may be suspended or restricted for:</p>
            <ul>
              <li>maintenance or upgrades;</li>
              <li>technical failures;</li>
              <li>security concerns;</li>
              <li>legal or regulatory requirements; or</li>
              <li>circumstances beyond our reasonable control.</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>8. Intellectual Property</h3>
            <p>
              All intellectual property rights in the Service, including software, branding,
              and content, belong to FareGuard or its licensors.
            </p>
            <p>
              You are granted a limited, non-exclusive, non-transferable licence to use the
              Service for personal, non-commercial purposes only.
            </p>
            <p>
              You must not copy, modify, distribute, reverse engineer, or commercially
              exploit any part of the Service.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              9. Privacy and Data Protection
            </h3>
            <p>
              Our use of personal data is governed by our Privacy Policy.
            </p>
            <p>
              By using the Service, you acknowledge that personal data is processed as
              described in that policy, including automated analysis of relevant booking
              emails and retention of structured journey data.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              10. Suspension and Termination
            </h3>
            <p>
              You may stop using the Service at any time and disconnect your Gmail account.
            </p>
            <p>We may suspend or terminate access if:</p>
            <ul>
              <li>you breach these Terms;</li>
              <li>misuse of the Service is reasonably suspected;</li>
              <li>required by law or regulation; or</li>
              <li>continued provision is not commercially or technically feasible.</li>
            </ul>
            <p>Where reasonably possible, we will provide notice.</p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>11. Consumer Rights</h3>
            <p>
              Nothing in these Terms limits or excludes your statutory rights under UK
              consumer law.
            </p>
            <p>
              We will provide the Service with reasonable care and skill.
            </p>
            <p>
              If the Service does not meet this standard, you may be entitled to legal
              remedies, including repeat performance or an appropriate price reduction where
              applicable.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>12. Right to Cancel</h3>
            <p>
              You have the right to cancel your agreement within 14 days of accepting these
              Terms.
            </p>
            <p>
              However, the Service begins immediately when you connect your Gmail account and
              allow processing to start. By connecting your account and using the Service
              during the cancellation period, you request immediate performance.
            </p>
            <p>
              As FareGuard is provided free of charge, cancellation does not involve any
              refund or financial adjustment.
            </p>
            <p>
              You may stop using the Service at any time by disconnecting your Gmail account
              through your Google account permissions or within the FareGuard dashboard. Once
              disconnected, processing stops and your use of the Service ends.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>13. Disclaimers</h3>
            <p>The Service is provided on an “as is” and “as available” basis.</p>
            <p>We do not guarantee:</p>
            <ul>
              <li>that compensation or refunds will be available;</li>
              <li>that eligibility assessments are accurate or complete;</li>
              <li>decisions made by train operators; or</li>
              <li>uninterrupted or error-free operation;</li>
              <li>
                that all eligible journeys, delays, or compensation opportunities will be
                identified by the Service.
              </li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              14. Limitation of Liability
            </h3>
            <p>Nothing in these Terms excludes liability for:</p>
            <ul>
              <li>death or personal injury caused by negligence;</li>
              <li>fraud or fraudulent misrepresentation; or</li>
              <li>any liability that cannot be excluded under law.</li>
            </ul>
            <p>
              Subject to the above, FareGuard’s total liability arising from the Service
              shall not exceed £100.
            </p>
            <p>We are not liable for:</p>
            <ul>
              <li>claim rejection by train operators;</li>
              <li>actions or decisions of third parties;</li>
              <li>indirect or consequential loss; or</li>
              <li>loss of opportunity or expected savings.</li>
            </ul>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              15. Changes to the Service or Terms
            </h3>
            <p>
              We may update these Terms to reflect legal, technical, or commercial changes.
            </p>
            <p>
              Where changes materially affect users, we will provide reasonable notice.
            </p>
            <p>
              If you do not agree with updated Terms, you may stop using the Service and
              disconnect your account before the changes take effect.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>16. Entire Agreement</h3>
            <p>
              These Terms and the Privacy Policy form the entire agreement between you and
              FareGuard regarding use of the Service.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>
              17. Governing Law and Jurisdiction
            </h3>
            <p>
              These Terms are governed by the laws of England and Wales.
            </p>
            <p>
              If you are a consumer, you may bring legal proceedings in the courts of the
              part of the United Kingdom where you live.
            </p>

            <h3 style={{ marginTop: 24, color: "var(--fg-navy)" }}>18. Contact</h3>
            <p>
              FareGuard Ltd<br />
              64 Lincoln Street<br />
              Birmingham<br />
              B12 9EX<br />
              United Kingdom
            </p>
            <p>
              Email: <a href="mailto:hello@fareguard.co.uk">hello@fareguard.co.uk</a>
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
