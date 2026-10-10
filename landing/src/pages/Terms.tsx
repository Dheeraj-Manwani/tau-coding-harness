import { Link } from "react-router-dom";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { APP_BILLING } from "@/src/lib/routes";
import { PRO_PRICE_INR } from "@/src/features/marketing/data/effortTiers";

const CONTACT_EMAIL = "iammadfortech@gmail.com";
const EFFECTIVE_DATE = "October 10, 2026";
const PRO_PRICE = `₹${PRO_PRICE_INR.toLocaleString("en-IN")}`;

export default function TermsPage() {
  useDocumentMeta({
    title: "Terms & Cancellation Policy",
    description:
      "The terms of using tau, including subscriptions, credits, cancellation, refunds, acceptable use, published apps and stored files.",
    canonical: "/terms",
  });

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
          keep and deploy. Tau can also publish an app to a public address and
          store files for it, as described in section 7.
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
            We may suspend or terminate accounts that violate these Terms, as
            set out in section 9.
          </li>
        </ul>
      </Section>

      <Section title="4. Credits &amp; billing">
        <p className="font-medium">Free tier</p>
        <p>
          Every registered user receives a one-time grant of 300 free credits
          when they sign up. There is no daily or recurring refill of free
          credits; additional credits can be obtained via a promo code or the
          PRO plan.
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
          <Link to={APP_BILLING} className="text-indigo-400 hover:underline">
            Credits &amp; Billing
          </Link>{" "}
          → click "Cancel subscription". Your plan remains active until the
          current period ends.
        </p>
      </Section>

      <Section title="6. Acceptable use">
        <p>
          You are responsible for everything you build with tau, everything your
          apps do, and everything that is stored or published through them,
          including what other people upload to your apps. You may not use tau,
          or let your apps be used, to:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Create, store, host, distribute or link to child sexual abuse
            material, or any sexual content involving minors, in any form. This
            is reported to the authorities and is never reversed.
          </li>
          <li>
            Create, store, host or distribute malware, spyware, ransomware,
            exploit kits, botnet or command-and-control software, or any code
            meant to damage, disrupt or gain unauthorised access to a system.
          </li>
          <li>
            Run phishing, fraud, scams, impersonation, fake storefronts, fake
            login or payment pages, or anything that imitates another person,
            brand, bank, government body or service to deceive.
          </li>
          <li>
            Store, host or share content that is illegal where you or the people
            it reaches live, including content that is defamatory, threatening,
            harassing, hateful, that incites violence, promotes terrorism or
            self-harm, or that sells or promotes illegal goods or services.
          </li>
          <li>
            Infringe copyright, trademarks, trade secrets, privacy or any other
            right of a third party, including storing or distributing pirated
            software, films, music, books or leaked material.
          </li>
          <li>
            Collect, store or publish other people&apos;s personal data without
            their lawful consent or another lawful basis, including government
            identity numbers, financial account or payment card data, health
            records or biometric data, unless you are legally allowed to and have
            taken the security measures the law requires.
          </li>
          <li>
            Send spam or unsolicited bulk messages, run scraping or credential
            stuffing, mine cryptocurrency, run proxies or open relays, or take
            part in or support denial-of-service or other attacks.
          </li>
          <li>
            Use tau&apos;s file storage as a general file host, content delivery
            network, backup service or software distribution point for other
            people, or to serve files at a stable public address for use outside
            your own app.
          </li>
          <li>
            Attempt to reverse-engineer, probe, scan, overload or attack our
            infrastructure, other users&apos; apps or stored files, or circumvent
            any authentication, rate limit, quota, credit limit, file-size
            limit, suspension or other control, including by using several
            accounts or projects to do so.
          </li>
          <li>
            Share, sell or expose a key issued to your app (including a storage
            key) or use one issued to another app.
          </li>
          <li>
            Resell or sublicense access to tau without our written permission, or
            automate account creation.
          </li>
          <li>Use tau in any way that breaks the law that applies to you or to us.</li>
        </ul>
        <p className="mt-2">
          We decide, acting reasonably but at our sole discretion, what breaks
          this section. You may not rely on the fact that tau&apos;s tools
          produced or allowed something as permission for it.
        </p>
      </Section>

      <Section title="7. Published apps and stored files">
        <p>
          When you publish an app, or turn on file storage for it, you act as the
          publisher of that app and of everything it serves or stores. Tau only
          provides the infrastructure.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>You are responsible for your visitors.</b> Anything uploaded to
            your app by anyone is treated as yours for the purposes of these
            Terms. If your app lets people upload files, you must restrict who
            can upload (for example by requiring sign-in), limit file size and
            count per person, and remove anything unlawful or abusive promptly.
          </li>
          <li>
            <b>Any file type can be stored, and tau does not review files.</b>{" "}
            That is not approval of any file. Tau may nevertheless inspect stored
            files and app content when we receive a report, suspect a breach of
            these Terms, are required to by law, or need to protect the service
            or other users.
          </li>
          <li>
            <b>Files are private and are not a backup.</b> Stored files are
            reachable only through your app. Keep your own copy of anything you
            cannot afford to lose; we do not promise that files will never be
            lost, corrupted or unavailable.
          </li>
          <li>
            <b>Limits.</b> Storage is limited by plan (stored total, size of a
            single file, and the preview environment). Over a limit, new uploads
            are refused. Limits may change, and we may apply per-app and
            per-visitor rate limits at any time.
          </li>
          <li>
            <b>Deletion.</b> Deleting a project deletes its stored files, and
            deleted files cannot be recovered. We may delete files that break
            these Terms, and the files and apps of accounts that have been
            terminated.
          </li>
          <li>
            <b>Your key is your responsibility.</b> Anything done with an
            app&apos;s storage key is done by you. If you suspect it has leaked,
            replace it from Tools → Storage at once.
          </li>
        </ul>
      </Section>

      <Section title="8. Reporting abuse and takedown">
        <p>
          To report content stored or published through tau, or to tell us about
          an infringement, a phishing page, malware or any other breach of
          section 6, email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-indigo-400 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          with the address of the app or the file, what is wrong, and how we can
          reach you. For a copyright claim include the work concerned, where the
          infringing copy is, and a statement that you are the owner or are
          authorised to act for the owner. This is the only contact we have for
          reports; reports sent elsewhere may not be seen.
        </p>
        <p className="mt-2">
          We act on reports as quickly as we can, but we do not promise a
          response time or a particular outcome. Knowingly false or abusive
          reports may themselves lead to action against the sender. Where the law
          requires it, we respond to valid notices from courts and authorities
          within the time they set.
        </p>
      </Section>

      <Section title="9. Enforcement">
        <p>
          If we believe, in our reasonable judgement, that you or your app have
          broken these Terms, or that your app puts the service, other users or
          anyone else at risk, we may do any or all of the following, at any time,
          with or without notice, and without liability to you:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Suspend an app&apos;s storage, so nothing can be uploaded or opened.</li>
          <li>Take a published app offline or suspend its address.</li>
          <li>Delete specific files, apps or whole projects.</li>
          <li>Limit, suspend or terminate your account.</li>
          <li>Refuse to restore, return or export anything.</li>
          <li>
            Preserve evidence and disclose your account details, content and logs
            to the authorities, to affected parties where the law allows or
            requires it, and to protect our rights.
          </li>
        </ul>
        <p className="mt-2">
          Where we suspend something we usually keep it for a short time, but we
          are not obliged to, and we may delete content that is plainly unlawful
          straight away. A suspension or termination for breaching these Terms
          does not entitle you to a refund, and you stay responsible for what was
          done under your account. We may act on a first offence if it is serious,
          without warning.
        </p>
      </Section>

      <Section title="10. Your responsibility to us">
        <p>
          You agree to indemnify and hold us, our operators and our service
          providers harmless from any claim, loss, penalty, cost or expense
          (including reasonable legal fees) arising from your apps, the content
          stored or published through them, your breach of these Terms, or your
          breach of the law or of anyone&apos;s rights.
        </p>
      </Section>

      <Section title="11. Intellectual property">
        <p>
          <b>Your content:</b> You retain all rights to the prompts you provide
          and the code generated for you. We do not claim ownership of your
          projects. You give us the limited right to store, copy, process and
          serve your content only as needed to run the service, enforce these
          Terms and meet our legal duties.
        </p>
        <p className="mt-2">
          <b>Our service:</b> The tau platform, branding, and underlying
          technology remain our intellectual property. You may not copy, scrape,
          or redistribute our UI or product without permission.
        </p>
      </Section>

      <Section title="12. Disclaimer &amp; limitation of liability">
        <p>
          The service is provided &quot;as is&quot; and &quot;as available&quot;
          without warranty of any kind. AI-generated code may contain errors or
          security flaws; you are responsible for reviewing and testing any code
          before deploying it in a production environment, and for how your apps
          handle other people&apos;s data and files. We do not guarantee that the
          service, a preview, a published app or stored files will be available,
          uninterrupted, secure or free of loss.
        </p>
        <p className="mt-2">
          To the fullest extent permitted by applicable law, our total liability
          for any claim arising from these Terms shall not exceed the amount you
          paid to us in the 30 days preceding the claim, and we are not liable for
          indirect, incidental or consequential loss, loss of data, profit or
          goodwill, or for anything done by you, your visitors or third parties.
        </p>
      </Section>

      <Section title="13. Governing law">
        <p>
          These Terms are governed by the laws of India. Any disputes shall be
          subject to the exclusive jurisdiction of courts in India.
        </p>
      </Section>

      <Section title="14. Changes">
        <p>
          We may update these Terms from time to time. We will provide at least
          7 days notice of material changes by email before they take effect,
          except that changes needed to meet a legal requirement, or to deal with
          abuse or a risk to the service, may take effect immediately. Continued
          use of tau after the effective date constitutes acceptance.
        </p>
      </Section>

      <Section title="15. Contact">
        <p>
          For questions, billing disputes, cancellation help, and reports of
          abuse or infringement:{" "}
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
