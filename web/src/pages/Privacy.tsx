import { Link } from "react-router-dom";

const CONTACT_EMAIL = "support@usetau.dev";
const EFFECTIVE_DATE = "June 29, 2025";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-sm text-foreground/90">
      <Link
        to="/"
        className="mb-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to tau
      </Link>

      <h1 className="mb-2 text-2xl font-semibold">Privacy Policy</h1>
      <p className="mb-10 text-xs text-muted-foreground">
        Effective date: {EFFECTIVE_DATE}
      </p>

      <Section title="1. Who we are">
        <p>
          Tau ("<b>we</b>", "<b>us</b>", or "<b>our</b>") is an AI-powered web
          application builder. This Privacy Policy explains how we collect, use,
          and share information when you use our services at{" "}
          <span className="font-mono text-xs">usetau.dev</span>.
        </p>
      </Section>

      <Section title="2. Information we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Account data</b> — email address and hashed password when you
            create an account, or your Google profile when you sign in with
            Google OAuth.
          </li>
          <li>
            <b>Usage data</b> — the prompts you submit, the projects and files
            generated for you, and AI token usage per job.
          </li>
          <li>
            <b>Billing data</b> — subscription status and credit balance. Payment
            card details are handled entirely by Razorpay and are never stored on
            our servers.
          </li>
          <li>
            <b>Log data</b> — IP address, browser type, pages visited, and error
            reports collected automatically.
          </li>
        </ul>
      </Section>

      <Section title="3. How we use your information">
        <ul className="list-disc space-y-1 pl-5">
          <li>Provide, operate, and improve the tau service.</li>
          <li>Authenticate your account and secure access.</li>
          <li>
            Process payments and manage your subscription through Razorpay.
          </li>
          <li>Send transactional emails (account verification, receipts).</li>
          <li>
            Detect abuse and enforce usage limits (credit metering, rate
            limiting).
          </li>
          <li>Comply with legal obligations.</li>
        </ul>
        <p className="mt-3">
          We do <b>not</b> sell or rent your personal data to third parties, and
          we do not use your prompts or generated code to train AI models.
        </p>
      </Section>

      <Section title="4. Third-party services">
        <p>
          We share limited data with the following sub-processors to deliver the
          service:
        </p>
        <table className="mt-3 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Processor</th>
              <th className="pb-2 pr-4 font-medium">Purpose</th>
              <th className="pb-2 font-medium">Data shared</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {[
              ["Razorpay", "Payment processing & subscriptions", "Email, subscription metadata"],
              ["DeepSeek", "AI code generation", "Prompts, conversation context"],
              ["E2B", "Secure sandboxed code execution", "Generated code"],
              ["Cloudflare R2", "File storage", "Generated project files"],
              ["Neon / PostgreSQL", "Database", "All account & billing data"],
            ].map(([p, pu, d]) => (
              <tr key={p}>
                <td className="py-2 pr-4 font-medium">{p}</td>
                <td className="py-2 pr-4 text-muted-foreground">{pu}</td>
                <td className="py-2 text-muted-foreground">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="5. Data retention">
        <p>
          We retain your account data for as long as your account is active.
          Generated project files are retained to allow you to access your work.
          You may request deletion of your account and all associated data by
          emailing{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-indigo-400 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          . We will complete deletion within 30 days.
        </p>
      </Section>

      <Section title="6. Cookies">
        <p>
          We use a single HTTP-only session cookie to keep you signed in. We do
          not use third-party advertising cookies or tracking pixels.
        </p>
      </Section>

      <Section title="7. Security">
        <p>
          All data is transmitted over HTTPS. Passwords are hashed with bcrypt
          and are never stored in plain text. Payment card data is tokenised by
          Razorpay and never reaches our servers.
        </p>
      </Section>

      <Section title="8. Your rights">
        <p>
          You may access, correct, or delete your personal data at any time. To
          exercise these rights, email us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-indigo-400 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          . We respond within 14 business days.
        </p>
      </Section>

      <Section title="9. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. We will notify
          registered users by email at least 7 days before material changes take
          effect.
        </p>
      </Section>

      <Section title="10. Contact us">
        <p>
          Questions? Email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-indigo-400 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
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
