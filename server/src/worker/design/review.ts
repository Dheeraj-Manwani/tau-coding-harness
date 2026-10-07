/**
 * Design review: a model looks at the app and says what is wrong with it.
 *
 * The mechanical checks (`checks.ts`) read source and catch what a regular
 * expression can. What they cannot see is the result: a heading that wraps
 * into the image beside it, a column that collapses to nothing on a phone, a
 * page that is technically inside the design and still looks like every other
 * generated page. That takes eyes. The agent building the app has none — it
 * writes markup and never sees it rendered — so this step renders the app,
 * takes pictures of it at desktop and phone width, and asks a model that can
 * read images about them.
 *
 * It is one model call, not a tool-using sub-agent: everything the reviewer
 * needs is in the pictures, and there is nothing for it to go and look up.
 *
 * Three things here were learned from the first real runs, in which the
 * builder reviewed the same three pages four times, each report at the
 * maximum length, the third undoing what the first had asked for and the
 * fourth asking for it back.
 *
 * ## Questions, not "what is wrong?"
 *
 * Asked what is wrong with a screen, the model always finds something: on an
 * app with nothing wrong it returned as many findings as it was allowed, a
 * different set each run. Asked seven yes-or-no questions (`QUESTIONS`), each
 * about a fault that is either in the picture or is not, the same model
 * answers "no" six or seven times on that app, the same way every run, and
 * still says "yes" to every planted fault on a broken one. "No" has to be an
 * answer it can give. The report the builder reads is put together here from
 * the answers, so its shape and its verdict do not depend on the model's prose.
 *
 * ## The reviewer is told what shows, and what tau measured
 *
 * A `DESIGN.md` is written for the builder, and most of it is instruction no
 * picture can confirm. Given all of it, the reviewer reported a "violation"
 * for each line it could loosely attach to something on screen. It now gets
 * only what the app is, its colours, its typefaces, its depth and its shapes
 * (`designForReview`). And what a still picture cannot show — that a table
 * scrolls sideways rather than being cut off, that the whole page is wider
 * than its window — is measured in the browser and written into the caption.
 *
 * ## Two looks per screen, and no more
 *
 * How many times a screen is looked at is tau's decision, not either model's
 * (`planReview`): the first look is a review, the second a re-check against
 * what the first one said, and there is no third.
 *
 * Needs two things an installation may lack — a headless browser and a model
 * that reads images — so `designReviewAvailable` is checked before anything
 * asks for a review.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import type OpenAI from "openai";
import { env } from "@/lib/env";
import { kimi } from "@/lib/kimi";
import { capturePageView, type PageCapture, type PageView } from "../lib/screenshot";

/** A browser to take the pictures and a model to look at them. */
export function designReviewAvailable(): boolean {
  return env.SCREENSHOT_ENABLED && kimi !== null;
}

/** The model that looks. Has to be one that accepts images. */
export function designReviewModel(): string {
  return env.DESIGN_REVIEW_MODEL ?? env.KIMI_EXTRACT_MODEL;
}

/** Screens in one review. Each is two pictures. */
export const MAX_REVIEW_PATHS = 4;
/** A review, then a re-check. */
export const MAX_LOOKS_PER_SCREEN = 2;
/** Reviews in one run, however many screens the app has. */
export const MAX_REVIEWS_PER_RUN = 4;

/**
 * The two views of each screen.
 *
 * Sized for a model's eyes rather than a person's: an image much taller than
 * it is wide gets shrunk until its text cannot be read, so each view keeps the
 * top of the page — the first two or three screens — at a scale where body
 * text is still legible, rather than the whole of a long page as a ribbon.
 */
const DESKTOP: PageView = { width: 1280, height: 800, mobile: false, maxHeight: 2000, scale: 0.8 };
const PHONE: PageView = { width: 390, height: 844, mobile: true, maxHeight: 1500, scale: 1.3 };
const VIEWS = [["desktop", DESKTOP], ["phone", PHONE]] as const;

/** Pictures in one review, across all its screens. */
const MAX_PICTURES = 12;
/** Pictures of one view of one screen, however long the page is. */
const MAX_SECTIONS = 4;

/**
 * How many pictures each view of each screen may take. A long page is
 * photographed in sections, top to bottom; the fewer screens a review covers,
 * the further down each one it can go. One screen gets four pictures a view —
 * 8,000 pixels of a desktop page — and four screens get one each.
 */
export function sectionsPerView(screens: number): number {
  return Math.max(1, Math.min(MAX_SECTIONS, Math.floor(MAX_PICTURES / (Math.max(1, screens) * VIEWS.length))));
}

/** Pages photographed at once. They share one browser and one dev server. */
const CAPTURE_CONCURRENCY = 3;
const REVIEW_TIMEOUT_MS = 120_000;
const REVIEW_MAX_TOKENS = 1_200;
/** A page this much wider than its window is rounding, not a fault. */
const PAGE_OVERFLOW_TOLERANCE = 8;

// ── The questions ────────────────────────────────────────────────────────────

/**
 * What the reviewer is asked. Each is a fault that is either visible in a
 * picture or is not; none asks for an opinion of the screen as a whole.
 *
 * `broken` answers must be fixed and make the verdict "fix". `polish` is the
 * one matter of taste asked about, and is optional for the builder.
 */
export const QUESTIONS = [
  {
    label: "Overflow",
    kind: "broken",
    ask: "Is any content cut off by its container or running off the side of the screen, or is a page wider than its window? Captions say when an area scrolls sideways: content stopping at the right edge of such an area is reached by scrolling and is not cut off. Captions say when a picture shows only part of a longer page: content stopping at the top or bottom edge of such a picture is not cut off.",
  },
  {
    label: "Overlap",
    kind: "broken",
    ask: "Does anything sit on top of something it should not: text over text, text running into an image, a control covering content?",
  },
  {
    label: "Missing at one width",
    kind: "broken",
    ask: "Is there something in the desktop picture of a screen with no counterpart at all in the phone picture, or the reverse? The same content arranged differently is not missing: a table that becomes stacked rows, a nav bar that becomes a menu button, anything inside an area that scrolls sideways.",
  },
  {
    label: "Unreadable",
    kind: "broken",
    ask: "Is any text too small, too pale against its background, or laid over too busy an image, to be read?",
  },
  {
    label: "Bad content",
    kind: "broken",
    ask: 'Is there placeholder text (lorem ipsum, "Feature one", "John Doe"), a broken image, an image with a watermark, or an empty area where content plainly failed to load? Embedded maps and videos from other sites often fail in these captures and work for real users: ignore them.',
  },
  {
    label: "Off-style",
    kind: "broken",
    ask: "Does a screen depart from the intended look in a way anyone would see at a glance: corners rounded where the style is square or the reverse, soft heavy shadows where it is flat, a serif where it names a sans, a second accent colour, gradient-filled text? Not shades of one colour, and never the size of type or the amount of spacing: neither can be judged from these pictures.",
  },
  {
    label: "Template",
    kind: "polish",
    ask: "Does a screen look like a stock template rather than something made for its subject: a centred headline over three equal cards, every section built the same way?",
  },
] as const;

const SYSTEM_PROMPT = `You are checking screenshots of a web app as it actually renders — each screen at desktop width, then at phone width. The app's builder cannot see what it builds; your answers are how it finds out whether something is broken. A note on what the app is meant to look like comes first, so you know the intended style.

Most screens you are shown are fine. A wrong "yes" costs the builder a rewrite of a screen that worked, so answer "yes" only to what is plainly visible in a picture and "no" to everything else. "No" to every question is the usual result.

Answer these ${QUESTIONS.length} questions about the screenshots as a set, in order.

${QUESTIONS.map((q, i) => `Q${i + 1}. ${q.label}. ${q.ask}`).join("\n")}

Reply in plain text with exactly ${QUESTIONS.length} lines, one per question, each in one of these two shapes:
Q1: no
Q1: yes — \`/route\` phone, which part of the page: what is wrong. Fix: the smallest change that fixes it.

If a question has more than one "yes", put the clearest two on its line, separated by " | ". Add nothing before or after the ${QUESTIONS.length} lines. Do not report what you cannot see in the pictures, what only shows on hover or click, or the blue notice bar at the very top of a screenshot if there is one. If the screenshots show an app with no data yet, judge the empty state as a user would first meet it.`;

const RECHECK_RULES = `For a re-check screen, answer "yes" only for a fault that is in the picture now: one from the earlier report that is still there, or one that was not there before. A change made to fix an earlier finding is not itself a fault — a table that now scrolls sideways or stacks, filters that now wrap onto two lines. Answer "no" to the last question for a re-check screen.`;

export type Verdict = "pass" | "fix" | "unknown";

export interface Answer {
  /** 1-based, matching `QUESTIONS`. */
  question: number;
  yes: boolean;
  /** Where, what, and the fix, as the reviewer wrote it. Empty for a "no". */
  detail: string;
}

/**
 * The reviewer's answers, read line by line. Lines that are not an answer are
 * ignored; a question it skipped is simply absent.
 */
export function parseAnswers(text: string): Answer[] {
  const answers: Answer[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*\**Q(\d)\**\s*[:.]\s*\**\s*(yes|no)\b\**\s*[—–:-]*\s*(.*)$/i.exec(line);
    if (!m) continue;
    const question = Number(m[1]);
    if (question < 1 || question > QUESTIONS.length) continue;
    if (answers.some((a) => a.question === question)) continue;
    const yes = m[2]!.toLowerCase() === "yes";
    answers.push({ question, yes, detail: yes ? m[3]!.trim() : "" });
  }
  return answers;
}

/**
 * The report the builder reads: a verdict, then one numbered finding for each
 * "yes", each marked `[broken]` or `[polish]`.
 *
 * @param measured     faults tau measured itself, already written as findings
 * @param withPolish   false on a re-check, where taste is not asked about
 */
export function composeReport(
  answers: readonly Answer[],
  measured: readonly string[] = [],
  withPolish = true,
): { review: string; verdict: Verdict } {
  const findings = [...measured];
  for (const kind of ["broken", "polish"] as const) {
    if (kind === "polish" && !withPolish) continue;
    for (const a of answers) {
      const q = QUESTIONS[a.question - 1]!;
      if (!a.yes || q.kind !== kind) continue;
      findings.push(`[${kind}] ${q.label} — ${a.detail || "the reviewer did not say where."}`);
    }
  }
  const verdict: Verdict = findings.some((f) => f.startsWith("[broken]")) ? "fix" : "pass";
  return {
    review: [`VERDICT: ${verdict}`, ...findings.map((f, i) => `${i + 1}. ${f}`)].join("\n"),
    verdict,
  };
}

/**
 * The verdict of a report whose answers could not be read — the reviewer
 * ignored the format. A `[broken]` mark means fix, a `[polish]` mark alone
 * means pass, and otherwise a line announcing the verdict decides.
 */
export function parseVerdict(review: string): Verdict {
  if (/\[broken\]/i.test(review)) return "fix";
  if (/\[polish\]/i.test(review)) return "pass";
  const m = /VERDICT:\s*(pass|fix)/i.exec(review);
  return m ? (m[1]!.toLowerCase() as "pass" | "fix") : "unknown";
}

export interface ReviewedScreen {
  path: string;
  view: "desktop" | "phone";
  /** The page's full height, and how much of it the pictures show, in CSS pixels. */
  pageHeight: number;
  capturedHeight: number;
  /** How far the page is wider than its window, in CSS pixels. */
  overflowX: number;
}

export interface DesignReview {
  /** The report for the builder: a verdict and the findings. */
  review: string;
  verdict: Verdict;
  screens: ReviewedScreen[];
  /** Screens that could not be photographed, and why. */
  skipped: string[];
  usage: { model: string; inputTokens: number; outputTokens: number };
  /** How long the pictures took, and the model. */
  captureMs: number;
  modelMs: number;
}

/** `/about`, `about`, `https://…/about` → `/about`. */
export function normalizeRoute(path: string): string {
  let p = path.trim();
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    // not a URL after all — treat it as a path
  }
  p = p.split(/[?#]/)[0] ?? "";
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/{2,}/g, "/");
}

/** The routes asked for, tidied and de-duplicated; `/` when none were. */
export function reviewRoutes(paths: unknown): string[] {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
  const unique = [...new Set(list.map(normalizeRoute))];
  return unique.length > 0 ? unique : ["/"];
}

// ── How many looks a screen gets ─────────────────────────────────────────────

/** A review made earlier in the same run. */
export interface PastReview {
  routes: string[];
  review: string;
}

export interface ReviewPlan {
  /** Screens being looked at for the first time. */
  fresh: string[];
  /** Screens looked at once already: checked against what was said then. */
  recheck: string[];
  /** Screens that have had both looks. Not looked at again. */
  closed: string[];
  /** Screens that did not fit in this review. */
  overLimit: string[];
  /** What was said about the re-check screens, oldest first. */
  earlier: string[];
  /** The run has had all the reviews it gets. */
  exhausted: boolean;
}

/**
 * Decide what a review request gets, given the reviews already made this run.
 * Pure, so the limits can be tested without a browser or a model.
 */
export function planReview(requested: unknown, past: readonly PastReview[]): ReviewPlan {
  const routes = reviewRoutes(requested);
  const looks = (route: string) => past.filter((p) => p.routes.includes(route)).length;

  const closed = routes.filter((r) => looks(r) >= MAX_LOOKS_PER_SCREEN);
  const open = routes.filter((r) => looks(r) < MAX_LOOKS_PER_SCREEN);
  const taken = open.slice(0, MAX_REVIEW_PATHS);
  const recheck = taken.filter((r) => looks(r) > 0);

  return {
    fresh: taken.filter((r) => looks(r) === 0),
    recheck,
    closed,
    overLimit: open.slice(MAX_REVIEW_PATHS),
    earlier: past.filter((p) => p.routes.some((r) => recheck.includes(r))).map((p) => p.review),
    exhausted: past.length >= MAX_REVIEWS_PER_RUN,
  };
}

function listed(routes: readonly string[]): string {
  return routes.map((r) => `\`${r}\``).join(", ");
}

/** What the builder should do with a report, said by tau rather than left to it. */
export function nextStep(plan: Pick<ReviewPlan, "fresh" | "recheck">, verdict: Verdict): string {
  if (verdict === "pass") {
    return "Nothing on these screens is broken, so they need no second look. A [polish] point is optional: take it if it is a small change, leave it otherwise.";
  }
  const parts = [
    "Fix every [broken] finding with the smallest change that does it — do not rebuild a screen that mostly works. A [polish] finding is optional.",
  ];
  if (plan.fresh.length > 0) {
    parts.push(
      `You may call this once more for ${listed(plan.fresh)} to confirm the fixes; that will be the last look ${plan.fresh.length === 1 ? "it gets" : "they get"} this run.`,
    );
  }
  if (plan.recheck.length > 0) {
    parts.push(
      `${listed(plan.recheck)} ${plan.recheck.length === 1 ? "has" : "have"} now had both looks and will not be reviewed again this run: fix what is still listed, if it is a small change, and move on.`,
    );
  }
  return parts.join(" ");
}

/** Why nothing was looked at, when a request asks only for what it cannot have. */
export function refusal(plan: ReviewPlan): string | null {
  if (plan.exhausted) {
    return "Not reviewed: this run has had all its design reviews. Do not call this again. If the last report still lists something broken that is a small fix, make it, then finish.";
  }
  if (plan.fresh.length + plan.recheck.length === 0) {
    return `Not reviewed: a screen gets one review and one re-check in a run, and ${listed(plan.closed)} ${plan.closed.length === 1 ? "has" : "have"} had both. Do not call this again for ${plan.closed.length === 1 ? "it" : "them"}. If the last report still lists something broken that is a small fix, make it, then finish.`;
  }
  return null;
}

// ── What the reviewer is told ────────────────────────────────────────────────

/** The sections of a DESIGN.md that say what the app looks like at a glance. */
const VISIBLE_SECTIONS = ["overview", "colors", "typography", "elevation & depth", "shapes"];

/**
 * The part of a design a reviewer of pictures can use: what the app is, its
 * colours, its typefaces, its depth and its shapes.
 *
 * Left out is everything written as instruction to the builder — which
 * classes to use, which layouts are allowed, how much variance a screen should
 * have, what size the type is in pixels. None of it can be confirmed from a
 * picture, and all of it reads as a rule to find a breach of.
 *
 * A design that does not use those section names — one a user brought from
 * another tool — is passed whole.
 */
export function designForReview(prose: string): string {
  const [head, ...sections] = prose.split(/^(?=## )/m);
  const kept: string[] = [];
  for (const section of sections) {
    const title = /^## (.*)$/m.exec(section)?.[1]?.trim().toLowerCase() ?? "";
    if (!VISIBLE_SECTIONS.includes(title)) continue;
    if (title !== "typography") {
      kept.push(section);
      continue;
    }
    // The typefaces are named in a list; the paragraph after it is about sizes.
    const lines = section.split("\n");
    const faces = lines.filter((line) => line.startsWith("- "));
    kept.push(faces.length > 0 ? `${lines[0]}\n${faces.join("\n")}\n\n` : section);
  }
  if (kept.length < 2) return prose;
  return [head, ...kept]
    .join("")
    // The three dials are instructions on how to build, scored out of ten.
    .replace(/^- \*\*(?:Variance|Motion|Density) \d+\/10\*\*.*\n?/gm, "")
    // So is which class carries which colour.
    .replace(/^- Colour only through tokens:.*\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A page that is wider than its window, said as a finding; null when it fits. */
export function pageOverflowFault(screen: Pick<ReviewedScreen, "path" | "view" | "overflowX">): string | null {
  if (screen.overflowX <= PAGE_OVERFLOW_TOLERANCE) return null;
  return `[broken] Overflow — \`${screen.path}\` ${screen.view}: tau measured the page as ${screen.overflowX}px wider than the window, so the whole page scrolls sideways. Fix: find the element that is too wide and contain it (\`min-w-0\`, \`overflow-x-auto\` on that element, or let it wrap).`;
}

/** Which stretch of a page a picture shows, when the page took more than one. */
export interface SectionOf {
  /** 0-based. */
  index: number;
  count: number;
  from: number;
  to: number;
}

/**
 * The line of text that goes with a picture: which screen, at what width, how
 * much of it — and what tau measured that the picture cannot show.
 */
export function screenCaption(
  screen: ReviewedScreen & { width: number; sideScrollers: readonly string[] },
  recheck: boolean,
  section?: SectionOf,
): string {
  const name = `Screen \`${screen.path}\`${recheck ? " (re-check)" : ""} — ${screen.view}, ${screen.width}px wide`;
  const unseen = screen.capturedHeight < screen.pageHeight;
  if (section && section.count > 1) {
    const last = section.index === section.count - 1;
    const first = `${name}, part ${section.index + 1} of ${section.count}: from ${section.from}px to ${section.to}px down a page ${screen.pageHeight}px tall.${last && unseen ? " The page goes on below this picture." : ""}`;
    // What was measured is about the whole screen; say it once.
    return section.index === 0 ? [first, ...measuredLines(screen)].join("\n") : first;
  }
  const cut = unseen
    ? `the top ${screen.capturedHeight}px of a page ${screen.pageHeight}px tall`
    : "the whole page";
  return [`${name}, ${cut}.`, ...measuredLines(screen)].join("\n");
}

function measuredLines(screen: { overflowX: number; sideScrollers: readonly string[] }): string[] {
  const lines: string[] = [];
  if (screen.overflowX > PAGE_OVERFLOW_TOLERANCE) {
    lines.push(
      `Measured: the page is ${screen.overflowX}px wider than the window, so the whole page scrolls sideways. That is a fault.`,
    );
  }
  if (screen.sideScrollers.length > 0) {
    const n = screen.sideScrollers.length;
    lines.push(
      `Measured: ${n === 1 ? "one area" : `${n} areas`} on this screen ${n === 1 ? "scrolls" : "scroll"} sideways, beginning ${screen.sideScrollers.map((w) => `"${w}"`).join("; ")}. What stops at the right edge there is reached by scrolling.`,
    );
  }
  return lines;
}

/** The text the reviewer reads before the pictures. */
export function reviewBrief(input: {
  designProse: string | null;
  focus?: string;
  recheck: readonly string[];
  earlier: readonly string[];
}): string {
  const parts = [
    input.designProse
      ? `What this app is meant to look like, from its written design:\n\n${designForReview(input.designProse)}`
      : "This app has no written design, so the answer to the question about style is \"no\".",
  ];
  if (input.recheck.length > 0 && input.earlier.length > 0) {
    parts.push(
      `Some of the screens below are marked "re-check": ${listed(input.recheck)}. They were reviewed earlier in this build, with the report that follows, and the builder has changed them since.\n\n<earlier_report>\n${input.earlier.join("\n\n---\n\n")}\n</earlier_report>\n\n${RECHECK_RULES}`,
    );
  }
  if (input.focus?.trim()) {
    parts.push(`The builder asks you to look in particular at: ${input.focus.trim().slice(0, 500)}`);
  }
  parts.push("The screenshots follow.");
  return parts.join("\n\n");
}

// ── The review itself ────────────────────────────────────────────────────────

type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;

/** Run `task` over `items`, a few at a time, keeping the results in order. */
async function pooled<T, R>(items: readonly T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

/**
 * Photograph the given screens and have them reviewed.
 *
 * @param previewUrl   the app's origin, e.g. `https://5173-….e2b.app`
 * @param fresh        routes being looked at for the first time
 * @param recheck      routes looked at before, judged against `earlier`
 * @param designProse  the app's `DESIGN.md` prose, or null when it has none
 * @param focus        what the agent wants looked at in particular
 *
 * Throws when no screen could be photographed or the model returned nothing;
 * the caller turns that into a tool result.
 */
export async function reviewDesign(input: {
  previewUrl: string;
  fresh: readonly string[];
  recheck?: readonly string[];
  earlier?: readonly string[];
  designProse: string | null;
  focus?: string;
}): Promise<DesignReview> {
  if (!kimi) throw new Error("No model that reads images is configured");
  const base = input.previewUrl.replace(/\/+$/, "");
  const recheck = input.recheck ?? [];

  const shots = [...input.fresh, ...recheck].flatMap((path) =>
    VIEWS.map(([name, view]) => ({ path, name, view })),
  );
  const perView = sectionsPerView(input.fresh.length + recheck.length);
  const captureStart = Date.now();
  const captured = await pooled(shots, CAPTURE_CONCURRENCY, async (shot) => {
    try {
      return await capturePageView(`${base}${shot.path}`, shot.view, perView);
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  });
  const captureMs = Date.now() - captureStart;

  const parts: Part[] = [];
  const screens: ReviewedScreen[] = [];
  const skipped: string[] = [];
  shots.forEach((shot, i) => {
    const result = captured[i] as PageCapture | Error;
    if (result instanceof Error) {
      skipped.push(`${shot.path} (${shot.name}): ${result.message}`);
      return;
    }
    const screen: ReviewedScreen = {
      path: shot.path,
      view: shot.name,
      pageHeight: result.pageHeight,
      capturedHeight: result.capturedHeight,
      overflowX: result.overflowX,
    };
    result.sections.forEach((section, index) => {
      parts.push({
        type: "text",
        text: screenCaption(
          { ...screen, width: shot.view.width, sideScrollers: result.sideScrollers },
          recheck.includes(shot.path),
          { index, count: result.sections.length, from: section.from, to: section.to },
        ),
      });
      parts.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${section.jpeg.toString("base64")}` },
      });
    });
    screens.push(screen);
  });
  if (screens.length === 0) {
    throw new Error(`No screen could be captured. ${skipped.join("; ")}`);
  }

  const brief = reviewBrief({
    designProse: input.designProse,
    focus: input.focus,
    recheck,
    earlier: input.earlier ?? [],
  });

  const model = designReviewModel();
  const modelStart = Date.now();
  const completion = await kimi.chat.completions.create(
    {
      model,
      max_tokens: REVIEW_MAX_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: [{ type: "text", text: brief }, ...parts] },
      ],
      // This model reasons before answering unless told not to, and the
      // reasoning counts against `max_tokens`: left on, it can spend the whole
      // limit thinking and return nothing (see api/lib/attachments.ts).
      ...({ thinking: { type: "disabled" } } as object),
    },
    // Retries cover a rate limit: a small account allows one request at a time.
    { timeout: REVIEW_TIMEOUT_MS, maxRetries: 4 },
  );

  const written = completion.choices[0]?.message.content?.trim();
  if (!written) {
    throw new Error(
      `The reviewer returned nothing (finish_reason: ${completion.choices[0]?.finish_reason ?? "unknown"})`,
    );
  }

  const answers = parseAnswers(written);
  // A page wider than its window is a measurement, not an opinion: it is
  // reported whether or not the reviewer said so.
  const overflowSeen = answers.some((a) => a.question === 1 && a.yes);
  const measured = overflowSeen ? [] : screens.map(pageOverflowFault).filter((f): f is string => f !== null);
  const report =
    answers.length > 0
      ? composeReport(answers, measured, input.fresh.length > 0)
      : // The format was ignored; pass on what was written rather than nothing.
        { review: [...measured, written].join("\n\n"), verdict: parseVerdict([...measured, written].join("\n")) };

  return {
    ...report,
    screens,
    skipped,
    usage: {
      model,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
    captureMs,
    modelMs: Date.now() - modelStart,
  };
}
