import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument from "@/app/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Terms of Use | HT Labs",
  description: "Terms governing access to and use of HT Labs.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      eyebrow="HT Labs Legal"
      title="Terms of Use"
      updated="August 23, 2026"
      summary="These terms govern your use of the HT Labs website and mobile application."
    >
      <section>
        <h2>Research tool—not a broker or adviser</h2>
        <p>HT Labs provides market research, educational analytics, and software tools. HT Labs is not a broker-dealer, investment adviser, fiduciary, exchange, custodian, or execution venue. It does not hold user funds or place trades for users. Nothing in the service is personalized financial, legal, or tax advice.</p>
      </section>

      <section>
        <h2>Trading risk</h2>
        <p>Trading stocks, crypto assets, and other instruments can result in substantial or total loss. Momentum securities can move quickly, become illiquid, halt, gap, or reverse. Scores, scenarios, rankings, alerts, upside ranges, downside ranges, and AI explanations are research outputs—not promises, guarantees, or instructions to trade. You remain solely responsible for every investment decision.</p>
      </section>

      <section>
        <h2>Data limitations</h2>
        <p>Market data may be delayed, incomplete, adjusted, unavailable, or incorrect. Models can fail and past performance does not predict future results. Verify important information with your broker or another primary source before acting. HT Labs may change, pause, or remove features when needed for security, accuracy, maintenance, or compliance.</p>
      </section>

      <section>
        <h2>Accounts</h2>
        <p>You must be at least 18 years old and provide accurate account information. You are responsible for protecting your credentials and for activity under your account. You may delete your account from the <Link href="/account">Account &amp; Privacy page</Link>.</p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You may not interfere with the service, bypass access controls, upload malicious code, impersonate another person, use HT Labs unlawfully, or scrape, resell, redistribute, or commercially exploit data or outputs in violation of applicable licenses or third-party rights.</p>
      </section>

      <section>
        <h2>Ownership and third-party services</h2>
        <p>HT Labs software, branding, interfaces, and original research systems are protected by applicable intellectual-property laws. Market data, news, AI infrastructure, hosting, and authentication may be supplied by third parties and remain subject to their rights and terms.</p>
      </section>

      <section>
        <h2>Disclaimer and limitation</h2>
        <p>To the maximum extent permitted by law, HT Labs is provided “as is” and “as available,” without warranties of accuracy, availability, fitness for a particular purpose, or non-infringement. HT Labs will not be liable for trading losses, lost profits, lost data, or indirect, incidental, special, consequential, or punitive damages arising from use of the service.</p>
      </section>

      <section>
        <h2>Suspension, changes, and contact</h2>
        <p>Access may be restricted or terminated for misuse, security threats, legal requirements, or violation of these terms. We may update these terms as HT Labs evolves; continued use after an update means you accept the revised terms. Questions may be sent through <Link href="/support">HT Labs Support</Link> or to <a href="mailto:support@gethtlabs.com">support@gethtlabs.com</a>.</p>
      </section>
    </LegalDocument>
  );
}
