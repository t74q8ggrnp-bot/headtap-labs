import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument from "@/app/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Support | HT Labs",
  description: "Get help with the HT Labs website and iPhone app.",
};

export default function SupportPage() {
  return (
    <LegalDocument
      eyebrow="HT Labs Support"
      title="How can we help?"
      updated="September 2, 2026"
      summary="Get help with account access, live market research, charts, HT Paper, or the HT Labs iPhone app."
    >
      <section>
        <h2>Contact support</h2>
        <p>
          Email <a href="mailto:support@gethtlabs.com">support@gethtlabs.com</a> and include a short description of the problem. If possible, include the screen you were using, the ticker or crypto asset involved, and whether you were on the website or iPhone app.
        </p>
        <p>Do not email passwords, authentication codes, payment information, brokerage credentials, or other sensitive information.</p>
      </section>

      <section>
        <h2>Before contacting us</h2>
        <ul>
          <li>Confirm that your device has an active internet connection.</li>
          <li>Pull down to refresh the current screen or close and reopen HT Labs.</li>
          <li>For account issues, sign out and sign back in with the same email address.</li>
          <li>For HT Paper issues, include the ticker, order side, order type, and approximate time of the simulated order.</li>
          <li>For chart or market-data issues, include the ticker and the timestamp displayed by HT Labs.</li>
        </ul>
      </section>

      <section>
        <h2>Account and privacy controls</h2>
        <p>
          You can manage or permanently delete your account from the <Link href="/account">Account &amp; Privacy page</Link>. Review the <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Use</Link> for additional information.
        </p>
      </section>

      <section>
        <h2>Market and Paper Trading notice</h2>
        <p>HT Labs is educational market-research software. HT Paper uses fictional funds and does not route orders to a live broker. Market data and research outputs can be delayed, incomplete, or unavailable and should not be treated as personalized financial advice.</p>
      </section>
    </LegalDocument>
  );
}
