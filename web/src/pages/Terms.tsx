import { Link } from "react-router-dom";

const CONTACT_EMAIL = "support@usetau.dev";
const EFFECTIVE_DATE = "June 29, 2025";
const PRO_PRICE = "₹999";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-sm text-foreground/90">
      <Link
        to="/"
        className="mb-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to tau
      </Link>

      <h1 className="mb-2 text-2xl font-semibold">Terms of Service</h1>
      <p className="mb-10 text-xs text-muted-foreground">
        Effective date: {EFFECTIVE_DATE}
      </p>

      <Section title="1. Acceptance">
        <p>
          By creating a tau account or using any tau service, you agree to these
          Terms of Service and our{" "}
          <Link to="/privacy" className="text-indigo-400 hover:underline">
            Privacy Policy
          </Link>
          . If you do not agree, do not use tau.
        </p>
      </Section>

      <Section title="2. Service description">
        <p>
          Tau is an AI-powered web application builder. You describe an
          application in natural language; tau generates code, runs it in a
          secure sandbox, and gives you a preview. Generated code is yours to
          keep and deploy.
        </p>
      </Section>

      <Section title="3. Accounts">
        <ul className="list-disc space-y-1 pl-5">
          <li>You must be at least 18 years old to create an account.</li>
          <li>You are responsible for all activity under your account.</li>
          <li>
            You must provide accurate information and keep your credentials
            confidential.
          </li>
          <li>
            We may suspend or terminate accounts that violate these Terms.
          </li>
        </ul>
      </Section>

      <Section title="4. Credits &amp; billing">
        <p className="font-medium">Free tier</p>
        <p>
          Every registered user receives 50 free credits per day (UTC), reset
          automatically. Free credits are use-it-or-lose-it; unused credits
          expire at midnight UTC.
        </p>

        <p className="mt-4 font-medium">PRO plan</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Price:</b> {PRO_PRICE} per month (INR, inclusive of applicable
            taxes).
          </li>
          <li>
            <b>Billing:</b> Charged monthly on your subscription anniversary via
            Razorpay. Your first charge is processed immediately on upgrade.
          </li>
          <li>
            <b>Credits:</b> 5,000 plan credits are granted at the start of each
            billing cycle. Unused plan credits expire at the end of the cycle
            and do not roll over.
          </li>
          <li>
            <b>Cancellation:</b> You may cancel at any time. Your subscription
            remains active until the end of the current billing period, after
            which you revert to the free tier. We do not provide prorated
            refunds for unused days in a cycle.
          </li>
        </ul>

        <p className="mt-4 font-medium">Promo codes</p>
        <p>
          Promotional credits credited via promo codes are non-expiring and
          non-refundable. Each code may be redeemed once per account.
        </p>
      </Section>

      <Section title="5. Refund &amp; cancellation policy">
        <p>
          <b>Subscriptions:</b> We do not offer prorated refunds for subscription
          periods that have already begun. If you cancel, you retain access to
          PRO features and plan credits through the end of the paid period.
        </p>
        <p className="mt-2">
          <b>Billing errors:</b> If you believe you were charged in error, contact
          us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-indigo-400 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          within 7 days of the charge. We will review and, where applicable,
          issue a refund via your original payment method within 5–7 business
          days.
        </p>
        <p className="mt-2">
          <b>Exceptional circumstances:</b> If there is a verified service
          outage of more than 72 hours affecting your account, you may request a
          proportional credit or refund by contacting support.
        </p>
        <p className="mt-2">
          <b>Free credits and promo credits</b> have no monetary value and are
          not refundable under any circumstances.
        </p>
        <p className="mt-2">
          <b>How to cancel:</b> Sign in → go to{" "}
          <Link to="/billing" className="text-indigo-400 hover:underline">
            Credits &amp; Billing
          </Link>{" "}
          → click "Cancel subscription". Your plan remains active until the
          current period ends.
        </p>
      </Section>

      <Section title="6. Acceptable use">
        <p>You may not use tau to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Generate malware, spyware, ransomware, or similar harmful software.</li>
          <li>Produce content that is illegal, defamatory, or infringes third-party rights.</li>
          <li>Attempt to reverse-engineer, probe, or attack our infrastructure.</li>
          <li>Resell or sublicense access to tau without our written permission.</li>
          <li>Automate account creation or attempt to circumvent credit limits.</li>
        </ul>
        <p className="mt-2">
          Violations may result in immediate account termination without refund.
        </p>
      </Section>

      <Section title="7. Intellectual property">
        <p>
          <b>Your content:</b> You retain all rights to the prompts you provide
          and the code generated for you. We do not claim ownership of your
          projects.
        </p>
        <p className="mt-2">
          <b>Our service:</b> The tau platform, branding, and underlying
          technology remain our intellectual property. You may not copy, scrape,
          or redistribute our UI or product without permission.
        </p>
      </Section>

      <Section title="8. Disclaimer &amp; limitation of liability">
        <p>
          The service is provided "as is" without warranty of any kind. AI-generated
          code may contain errors; you are responsible for reviewing and testing any
          code before deploying it in a production environment.
        </p>
        <p className="mt-2">
          To the fullest extent permitted by applicable law, our total liability
          for any claim arising from these Terms shall not exceed the amount you
          paid to us in the 30 days preceding the claim.
        </p>
      </Section>

      <Section title="9. Governing law">
        <p>
          These Terms are governed by the laws of India. Any disputes shall be
          subject to the exclusive jurisdiction of courts in India.
        </p>
      </Section>

      <Section title="10. Changes">
        <p>
          We may update these Terms from time to time. We will provide at least
          7 days notice of material changes by email before they take effect.
          Continued use of tau after the effective date constitutes acceptance.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          For questions, billing disputes, or cancellation help:{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-indigo-400 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      <div className="space-y-2 leading-relaxed text-foreground/80">
        {children}
      </div>
    </section>
  );
}
