/**
 * Choosing an app's design from its brief.
 *
 * When a new app is created and the user has not chosen a look, something has
 * to. Leaving it to the agent that builds the app does not work: it is busy
 * with the build, and a model asked to pick a style in passing picks the same
 * safe one every time. So the choice is its own small step — one cheap model
 * call whose whole job is the design decision — made while the sandbox boots,
 * so it adds no time.
 *
 * ## Fit from the model, variety from tau
 *
 * A model asked for *the* right style and *the* right colour converges just as
 * the building agent does: in the first real runs, three of seven unrelated
 * briefs came back "editorial" and five came back with an orange-brown accent.
 * Its judgement of what *suits* a brief is good; its first choice among the
 * things that suit is always the same one.
 *
 * So it is asked for a shortlist — three styles and three accent colours that
 * would each suit the subject, best first — and tau picks from the shortlist,
 * weighted toward the top, using the project's id. Everything picked is
 * something the model judged a fit, and two similar briefs no longer get the
 * same answer. The same project always gets the same pick.
 *
 * Three smaller things push the same way: the styles are listed as equals in
 * an order that differs per project; each says what it is *not* for; and the
 * usual default colours are named as things to avoid.
 *
 * It can fail — a timeout, a malformed reply — and must never hold up or break
 * the creation of an app. `fallbackChoice` picks deterministically from the
 * project's id, which is at least different from one project to the next.
 *
 * ## What the user chose is not up for discussion
 *
 * A user can choose any part of the look before the app is built — a style, a
 * colour, light or dark, a font pairing, the feel — or bring a whole
 * `DESIGN.md` (`DesignConfig`). The director still runs, because whatever they
 * left open still has to suit the subject, and it is told what is already
 * settled. But nothing it says can change a choice: `chooseFrom` takes each
 * part from the user first and from the director only where the user said
 * nothing. A chosen colour is used exactly as given; a chosen dial is not
 * averaged with the style's.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import { clientForModel } from "@/lib/kimi";
import { env } from "@/lib/env";
import { log } from "@/worker/lib/log";
import { hexToOklch, isHexColor } from "./color";
import { importedMode, splitFrontMatter } from "./importDesign";
import { ALL_STYLES, GENERAL_STYLES, STYLES, chosenPairing } from "./styles";
import {
  isStyleKey,
  type DesignChoice,
  type DesignConfig,
  type Dials,
  type ImportedDesign,
  type Mode,
  type StyleKey,
  type StyleSpec,
} from "./types";

/** The sandbox takes longer than this to boot, so the call is free until then. */
const DIRECTOR_TIMEOUT_MS = 20_000;

/**
 * The model thinks before answering unless told not to. Measured on sixteen
 * briefs: with thinking it took 4 to 19 seconds and 600 to 3,500 output
 * tokens, and one reply in three came back empty because the thinking had used
 * the whole token limit. Without it: about 1.2 seconds, 110 tokens, every reply
 * usable, and shortlists no worse. This is a judgement call, not a derivation.
 */
const NO_THINKING = { thinking: { type: "disabled" } } as object;
const MAX_BRIEF_CHARS = 4_000;
/** How much of an imported design the director reads to find the closest style. */
const MAX_IMPORT_BRIEF_CHARS = 3_000;

/** How often the first, second and third shortlisted style is the one used. */
const STYLE_WEIGHTS = [0.5, 0.3, 0.2] as const;
const ACCENT_WEIGHTS = [0.4, 0.35, 0.25] as const;

/** Two accents closer in hue than this are the same colour for our purposes. */
const DISTINCT_HUE_DEGREES = 30;

/** Accents for when nothing chose one: spread round the wheel, none a default blue or purple. */
const FALLBACK_ACCENTS = [
  "#c2410c",
  "#0f766e",
  "#a16207",
  "#be123c",
  "#4d7c0f",
  "#0e7490",
  "#b91c1c",
  "#15803d",
  "#9d174d",
  "#b45309",
] as const;

/** A small, stable hash of a string. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A number in [0, 1) fixed by the seed. */
function unit(seed: string): number {
  // mulberry32, one step
  let t = (hash(seed) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A deterministic shuffle: the same seed always gives the same order. */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(unit(`${seed}:${i}`) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Pick one of a ranked shortlist, weighted toward the front, by seed.
 * With one option there is nothing to pick; with two, the weights of the
 * missing places are shared out in proportion.
 */
export function pickRanked<T>(options: readonly T[], weights: readonly number[], seed: string): T {
  if (options.length === 0) throw new Error("Nothing to pick from");
  const w = weights.slice(0, options.length);
  const total = w.reduce((a, b) => a + b, 0);
  let roll = unit(seed) * total;
  for (let i = 0; i < w.length; i++) {
    roll -= w[i]!;
    if (roll < 0) return options[i]!;
  }
  return options[w.length - 1]!;
}

function clampDial(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function defaultRead(styleName: string): string {
  return `Reading this as: a new app for the people who will use it, which should feel ${styleName.toLowerCase()}.`;
}

/** Where a choice came from, given what the user supplied. */
function sourceOf(
  config: DesignConfig,
  imported: ImportedDesign | undefined,
  otherwise: "director" | "fallback",
): DesignChoice["source"] {
  if (imported) return "import";
  return config.style || config.accent || config.mode || config.fonts || config.dials
    ? "user"
    : otherwise;
}

/**
 * A choice made without a model: varied between projects, never random within
 * one. Whatever the user chose is still honoured; only the rest is picked here.
 *
 * Nothing here has judged what suits the app, so the style comes from the
 * general-purpose ones only. A strong look is right when a brief calls for it
 * and wrong, loudly, when a hash does.
 */
export function fallbackChoice(
  seed: string,
  config: DesignConfig = {},
  imported?: ImportedDesign,
): DesignChoice {
  const h = hash(seed);
  const style = config.style ? STYLES[config.style] : GENERAL_STYLES[h % GENERAL_STYLES.length]!;
  const given = config.accent ?? imported?.tokens.colors.primary;
  return {
    style: style.key,
    accent: given ?? FALLBACK_ACCENTS[(h >>> 8) % FALLBACK_ACCENTS.length]!,
    accentExact: given !== undefined,
    mode: config.mode ?? (imported ? importedMode(imported.tokens) : null) ?? style.defaultMode,
    dials: { ...style.dials, ...config.dials },
    ...(chosenPairing(style, config.fonts) ? { fonts: config.fonts } : {}),
    read: defaultRead(style.name),
    source: sourceOf(config, imported, "fallback"),
    ...(imported ? { imported } : {}),
  };
}

/**
 * What the director is told about a brief whose look is partly settled, added
 * after the brief itself. Empty when the user chose nothing.
 */
export function settledNote(config: DesignConfig, imported?: ImportedDesign): string {
  const lines: string[] = [];
  if (imported) {
    const prose = splitFrontMatter(imported.text).body.trim().slice(0, MAX_IMPORT_BRIEF_CHARS);
    lines.push(
      `The user has brought their own written design, below. List only the one style whose shapes, borders, shadows and density are closest to what it describes.

<their_design>
${prose}
</their_design>`,
    );
  }
  if (config.style) {
    const style = STYLES[config.style];
    lines.push(
      `The user has chosen the style "${style.key}" (${style.look}). List only that style, and choose the rest to suit it.`,
    );
  }
  if (config.accent) lines.push(`The user has chosen the accent colour ${config.accent}. List only that colour.`);
  if (config.mode) lines.push(`The user has chosen ${config.mode} mode.`);
  return lines.join("\n\n");
}

/**
 * The names a style is also known by, for the catalog the director reads. A
 * brief that says "glassmorphism" or "neo-brutalist" is naming a style, and
 * the director can only honour that if it knows which one is meant.
 */
function alsoCalled(style: StyleSpec): string {
  return style.aka?.length ? ` Also called: ${style.aka.join(", ")}.` : "";
}

/** The instructions, with the catalog in this project's order. */
export function directorPrompt(seed: string): string {
  const catalog = shuffled(ALL_STYLES, seed)
    .map((s) => `- ${s.key}: ${s.look} Suits: ${s.suits} ${s.avoid}${alsoCalled(s)}`)
    .join("\n");

  return `You are the design director for an app builder. You are given the brief for a web app. Decide how it could look, before anyone builds it.

These are the styles available. They are equally good; none is the default.

${catalog}

Reply with:
- styles: up to three styles that would each genuinely suit this subject and this audience, best first. They should be different answers to the brief, not three versions of the safest one. List two, or one, when that is all that really fits: every style you list may be the one used. Never list a style whose "Not for" describes this brief — a tool people work in all day is not a magazine, and a page that sells something is not an admin panel. If the brief itself names a style, by its key or by one of the names it is also called, or describes a look that only one of them matches, list only that one.
- accents: three colours, as hex values, each of which would suit this subject, from three clearly different parts of the colour wheel, best first. Take them from the world of the subject — what the thing is made of, where it happens, what its audience already associates with it — not from what websites usually look like. Blue, indigo and purple are what every other app uses, and warm orange-brown is the next most common default: use those only when the subject really is that colour. If the brief names a colour, list only that one.
- accent_exact: true only if the brief gives a specific colour or a brand colour that has to be used exactly as given.
- mode: "light" or "dark" — how the app opens. Decide from the subject and from where and when it will be used.
- variance, motion, density: whole numbers from 1 to 10.
  - variance: 1 is symmetric and predictable, 10 is asymmetric and surprising.
  - motion: 1 is still, 10 is highly animated.
  - density: 1 is airy, with little on each screen; 10 is packed with information. A page that sells something is airy; a tool used all day is packed.
- read: one sentence in exactly this form, which must not name a style or a colour: "Reading this as: <what it is> for <who uses it>, which should feel <two or three adjectives>."

Anything the brief itself says about the look — a colour, light or dark, a named style, a mood — overrides your own judgement.

Reply with one JSON object and nothing else:
{"styles": ["<key>", "<key>", "<key>"], "accents": ["#rrggbb", "#rrggbb", "#rrggbb"], "accent_exact": false, "mode": "light", "variance": 5, "motion": 5, "density": 5, "read": "Reading this as: …"}`;
}

/** What the director offered: shortlists, best first, not yet a decision. */
export interface DirectorOptions {
  styles: StyleKey[];
  accents: string[];
  accentExact: boolean;
  /** Null when the reply did not say; the chosen style's own default applies. */
  mode: Mode | null;
  dials: { variance: number | null; motion: number | null; density: number | null };
  read: string | null;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Turn the model's reply into shortlists, or null if it names no usable style.
 *
 * Lenient about everything else: a missing dial or mode is filled in later
 * from the style that ends up chosen, and a bad colour is simply dropped,
 * because a design that is mostly chosen is better than discarding the choice.
 * Also accepts the single-valued `style` / `accent` form.
 */
export function parseDirectorReply(text: string): DirectorOptions | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const list = (many: unknown, one: unknown): unknown[] =>
    Array.isArray(many) ? many : one !== undefined ? [one] : [];

  const styles: StyleKey[] = [];
  for (const item of list(raw.styles, raw.style)) {
    const key = typeof item === "string" ? item.trim().toLowerCase() : item;
    if (isStyleKey(key) && !styles.includes(key)) styles.push(key);
  }
  if (styles.length === 0) return null;

  // Keep accents that are real colours and are not a near-repeat of one
  // already kept — three shades of one brown are one option, not three.
  const accents: string[] = [];
  for (const item of list(raw.accents, raw.accent)) {
    if (!isHexColor(item)) continue;
    const hex = item.trim().toLowerCase();
    const normal = hex.startsWith("#") ? hex : `#${hex}`;
    const { h, c } = hexToOklch(normal);
    const repeat = accents.some((kept) => {
      const k = hexToOklch(kept);
      return c > 0.03 && k.c > 0.03 && hueDistance(k.h, h) < DISTINCT_HUE_DEGREES;
    });
    if (!repeat) accents.push(normal);
  }

  const read =
    typeof raw.read === "string" && raw.read.trim().length > 20
      ? raw.read.trim().replace(/\s+/g, " ").slice(0, 400)
      : null;

  return {
    styles: styles.slice(0, 3),
    accents: accents.slice(0, 3),
    accentExact: accents.length > 0 && raw.accent_exact === true,
    mode: raw.mode === "dark" || raw.mode === "light" ? raw.mode : null,
    dials: {
      variance: clampDial(raw.variance),
      motion: clampDial(raw.motion),
      density: clampDial(raw.density),
    },
    read,
  };
}

/**
 * Decide from the shortlists.
 *
 * The dials are the mean of what the brief calls for and what the chosen style
 * is built for. The director set them before a style was picked, and a style
 * has a range it works in: an "editorial" app at the density a dashboard asked
 * for stops being editorial.
 */
export function chooseFrom(
  options: DirectorOptions,
  seed: string,
  config: DesignConfig = {},
  imported?: ImportedDesign,
): DesignChoice {
  // A user's style is the style. An imported design gets the closest fit, not
  // a varied one: variety between projects is no use to someone who has
  // already said exactly what they want.
  const key =
    config.style ??
    (imported ? options.styles[0]! : pickRanked(options.styles, STYLE_WEIGHTS, `${seed}:style`));
  const style = STYLES[key];

  const given = config.accent ?? imported?.tokens.colors.primary;
  const accent =
    given ??
    (options.accents.length === 0
      ? FALLBACK_ACCENTS[hash(`${seed}:accent`) % FALLBACK_ACCENTS.length]!
      : options.accentExact
        ? options.accents[0]!
        : pickRanked(options.accents, ACCENT_WEIGHTS, `${seed}:accent`));

  const blend = (asked: number | null, own: number) =>
    asked === null ? own : Math.round((asked + own) / 2);
  const dials: Dials = {
    variance: config.dials?.variance ?? blend(options.dials.variance, style.dials.variance),
    motion: config.dials?.motion ?? blend(options.dials.motion, style.dials.motion),
    density: config.dials?.density ?? blend(options.dials.density, style.dials.density),
  };

  return {
    style: key,
    accent,
    accentExact: given !== undefined || options.accentExact,
    mode:
      config.mode ??
      (imported ? importedMode(imported.tokens) : null) ??
      options.mode ??
      style.defaultMode,
    dials,
    ...(chosenPairing(style, config.fonts) ? { fonts: config.fonts } : {}),
    read: options.read ?? defaultRead(style.name),
    source: sourceOf(config, imported, "director"),
    ...(imported ? { imported } : {}),
  };
}

export interface DirectorResult {
  choice: DesignChoice;
  /** What the call cost, when one was made — the caller meters it. */
  usage: { model: string; inputTokens: number; outputTokens: number } | null;
}

/**
 * Decide the design for a new app. Never throws and never takes longer than
 * `DIRECTOR_TIMEOUT_MS`: on any failure the fallback is returned.
 *
 * @param brief     what is being built, in the user's words (and the agent's)
 * @param seed      the project id — orders the catalog, picks from the
 *                  shortlists, and seeds the fallback
 * @param config    what the user chose, if anything; never overridden
 * @param imported  a design the user brought, if any
 */
export async function directDesign(
  brief: string,
  seed: string,
  config: DesignConfig = {},
  imported?: ImportedDesign,
): Promise<DirectorResult> {
  const settled = settledNote(config, imported);
  const text = [brief.trim().slice(0, MAX_BRIEF_CHARS), settled].filter(Boolean).join("\n\n");
  if (!text) return { choice: fallbackChoice(seed, config, imported), usage: null };

  const model = env.DEEPSEEK_MODEL_FLASH;
  try {
    const completion = await clientForModel(model).chat.completions.create(
      {
        model,
        max_tokens: 600,
        temperature: 1,
        response_format: { type: "json_object" },
        ...NO_THINKING,
        messages: [
          { role: "system", content: directorPrompt(seed) },
          { role: "user", content: `The brief:\n\n${text}` },
        ],
      },
      { timeout: DIRECTOR_TIMEOUT_MS, maxRetries: 0 },
    );

    const usage = {
      model,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    };
    const options = parseDirectorReply(completion.choices[0]?.message.content ?? "");
    if (!options) {
      log.warn("design.director.unusable", { seed });
      return { choice: fallbackChoice(seed, config, imported), usage };
    }
    const choice = chooseFrom(options, seed, config, imported);
    log.info("design.director", {
      projectId: seed,
      offeredStyles: options.styles.join(","),
      offeredAccents: options.accents.join(","),
      chose: choice.style,
      accent: choice.accent,
      source: choice.source,
    });
    return { choice, usage };
  } catch (err) {
    log.warn("design.director.failed", { seed, error: String(err) });
    return { choice: fallbackChoice(seed, config, imported), usage: null };
  }
}
