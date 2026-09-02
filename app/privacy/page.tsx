import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument from "@/app/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Policy | HT Labs",
  description: "How HT Labs collects, uses, stores, and deletes personal data.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      eyebrow="HT Labs Legal"
      title="Privacy Policy"
      updated="August 23, 2026"
      summary="This policy explains what HT Labs collects, why it is used, and the controls available to you."
    >
      <section>
        <h2>Information we collect</h2>
        <ul>
          <li><strong className="text-white">Account data:</strong> email address, authentication identifiers, and session information needed to create and secure your account.</li>
          <li><strong className="text-white">Workspace data:</strong> cloud watchlists and any signal-memory or market-behavior records associated with your user ID.</li>
          <li><strong className="text-white">Device data:</strong> saved setups, viewed tickers, and watchlist preferences stored locally in your browser or app.</li>
          <li><strong className="text-white">Operational data:</strong> ordinary security, performance, request, and error logs created while running the service.</li>
          <li><strong className="text-white">Support data:</strong> information you choose to include when asking HT Labs for help.</li>
        </ul>
        <p>HT Labs does not currently custody funds, execute brokerage orders for users, store brokerage passwords, collect payment-card details, request contacts, or request precise location.</p>
      </section>

      <section>
        <h2>How information is used</h2>
        <p>We use personal information to authenticate users, synchronize account features, protect the service, troubleshoot problems, comply with law, and provide requested support. We do not sell personal information.</p>
      </section>

      <section>
        <h2>Market intelligence and AI services</h2>
        <p>HT Labs processes public and licensed market information to generate research views. Ticker symbols, prices, market context, and prompts may be sent to AI infrastructure to produce explanatory research. Account passwords are not included in those prompts. Global market observations and research history that are not linked to a user account are not personal account data.</p>
      </section>

      <section>
        <h2>Service providers</h2>
        <p>HT Labs uses service providers to operate the product, including Supabase for authentication and database services, Vercel for application hosting, OpenAI for certain AI-generated research, and market or news data providers. They process information under their own terms and privacy commitments as needed to provide their services.</p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>Personal data is retained only as reasonably necessary to operate and secure HT Labs, meet legal obligations, or resolve disputes. You can permanently delete your account and its user-linked cloud data from the <Link href="/account">Account &amp; Privacy page</Link>. Local app data is removed on that device during the deletion flow. Some security or backup records may persist for a limited period where legally or operationally required.</p>
      </section>

      <section>
        <h2>Security and your choices</h2>
        <p>We use reasonable safeguards, but no online service can guarantee perfect security. Keep your password private and sign out on shared devices. You may use HT Labs without signing in, but cloud synchronization and account controls will not be available.</p>
      </section>

      <section>
        <h2>Age requirement</h2>
        <p>HT Labs is intended for adults age 18 and older and is not directed to children.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>We may update this policy as the product changes. The effective date above identifies the latest version. Privacy requests can be handled through the <Link href="/account">in-app account controls</Link>. If you cannot access your account, visit <Link href="/support">HT Labs Support</Link> or email <a href="mailto:support@gethtlabs.com">support@gethtlabs.com</a>.</p>
      </section>
    </LegalDocument>
  );
}
