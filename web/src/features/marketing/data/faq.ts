/**
 * §4.11 — the FAQ.
 *
 * Every answer is checked against the truth table in §9. Two are load-bearing:
 *
 *  • Deploy. §9 says "Must say 'not yet.' Never a Deploy verb on the landing
 *    page" and "Do not soften this". The answer below is the softest it is
 *    allowed to get.
 *
 *  • Training. §13's open question #4 said this needed a real answer rather
 *    than a guess — and it already has one: /privacy states plainly that
 *    prompts and generated code are not used to train models. The answer here
 *    quotes that, and links to it, rather than inventing a position.
 */

export interface FaqItem {
  question: string;
  answer: string;
  /** Optional internal link rendered after the answer. */
  link?: { label: string; to: string };
}

export const FAQ: FaqItem[] = [
  {
    question: "Do I own the code?",
    answer:
      "Yes. It's yours. Connect GitHub and push it to a repo of your own whenever you want — a new pull request, an update to an existing one, or straight to a branch.",
  },
  {
    question: "What is it actually running?",
    answer:
      "A real Linux sandbox, provisioned per project on E2B, with Node and Bun, a package manager, and a live port. Not a simulation and not a preview renderer — the agent runs commands in it and your app serves from it.",
  },
  {
    question: "Can I edit the code by hand?",
    answer:
      "Yes, in the browser. The editor autosaves to the sandbox and to storage, and the agent is told what you changed — so your edit survives its next turn instead of being overwritten.",
  },
  {
    question: "Which models does it use?",
    answer:
      "DeepSeek on Low and High effort, and Kimi K2.7 Code on Max. Effort also decides how many turns the agent gets, how many sub-agents it can run at once, and how long it may work.",
  },
  {
    question: "What happens if I run out of credits?",
    answer:
      "The build stops cleanly and tells you. Nothing is lost — your project, its files and the conversation are all still there. Top up with a credit pack or upgrade, and carry on from where it stopped.",
  },
  {
    question: "Can I cancel a build?",
    answer:
      "Any time, mid-turn. You are not charged for work that didn't happen.",
  },
  {
    question: "Do my prompts train a model?",
    answer:
      "No. Our privacy policy states it plainly: we do not use your prompts or generated code to train AI models. Prompts are sent to our model providers to generate your app, and to nobody else.",
    link: { label: "Read the privacy policy", to: "/privacy" },
  },
  {
    question: "Can I deploy the app from tau?",
    answer:
      "Not yet. Tau builds and runs your app in its sandbox, but it does not publish it to a domain of your own. Push to GitHub and deploy from there — Vercel, Netlify, Fly, or anywhere else that reads a repo.",
  },
];
