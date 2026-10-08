/**
 * Taking an app's design from a picture.
 *
 * Someone who attaches a screenshot and says "make it look like this" is
 * describing a design more exactly than any sentence could. What tau did with
 * that before was describe the picture in words and hand the words to the
 * agent: the sections and their order survived, and the look — the actual
 * colours, the corner shapes, light or dark — mostly did not, because prose
 * about a colour is not a colour.
 *
 * So the picture is read for values instead. A model that can see is asked a
 * fixed set of questions with fixed answers — what colour is the page, are the
 * buttons square or pill-shaped, is the heading a serif — and tau writes the
 * answers out as a `DESIGN.md`, front matter and all. From there it is an
 * imported design like any other (`importDesign.ts`): its colours become the
 * palette, its shapes are laid over the skin of the closest style, its
 * typefaces are installed. Nothing downstream knows the file began as a
 * picture, apart from one flag that says its pictures were not copied.
 *
 * ## What is read, and what is not
 *
 * How it looks: colour, shape, type, density, arrangement. Not what it shows.
 * A screenshot is usually of somebody's product, and the look of a product is
 * something an app can share; its logo, its name, its photographs and its
 * copy are not. The model is told not to report them and the design that
 * comes out says they are not part of it.
 *
 * ## A typeface is matched, not identified
 *
 * Naming the exact face in a screenshot is not something a model does
 * reliably, and the face is usually not one an app could install anyway. The
 * model is asked what *kind* of face it is, from a short list, and each kind
 * has one family tau knows it can install (`CLOSEST_FACE`). The design says
 * the face is a closest match, because it is.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §10, part B.
 */
import type OpenAI from "openai";
import { clientForModel, isKimiModel, kimi } from "@/lib/kimi";
import { hexToOklch, normalizeHex, readableOn } from "./color";
import { designReviewModel } from "./review";
import type { Mode } from "./types";

/** A model that reads images is configured. */
export function imageReadingAvailable(): boolean {
  return kimi !== null || !isKimiModel(designReviewModel());
}

// Includes time spent waiting for a turn at Moonshot (lib/kimi.ts).
const READ_TIMEOUT_MS = 90_000;
const READ_MAX_TOKENS = 900;
const MAX_MESSAGE_CHARS = 600;

// ── The vocabulary ───────────────────────────────────────────────────────────

const CONTROL_CORNERS = ["square", "slight", "rounded", "very-rounded", "pill"] as const;
const CARD_CORNERS = ["square", "slight", "rounded", "very-rounded"] as const;
const BORDERS = ["none", "hairline", "thick"] as const;
const SHADOWS = ["none", "soft", "hard"] as const;
const FIELDS = ["outlined", "underline", "filled"] as const;

/**
 * The kinds of typeface the model chooses between, and the family that stands
 * for each. Every family is one a tau style already uses, so it is in the
 * sandbox image and installs without a download.
 */
export const CLOSEST_FACE = {
  "sans-neutral": { says: "a plain, neutral sans-serif", family: "Instrument Sans" },
  "sans-geometric": { says: "a geometric sans-serif with round letters", family: "Outfit" },
  "sans-humanist": { says: "a warm, humanist sans-serif", family: "Source Sans 3" },
  "sans-condensed": { says: "a tall, condensed sans-serif", family: "Teko" },
  "sans-wide": { says: "a wide, extended sans-serif", family: "Unbounded" },
  rounded: { says: "a sans-serif with rounded ends", family: "Nunito" },
  "serif-classic": { says: "a classic book serif", family: "Source Serif 4" },
  "serif-elegant": { says: "a high-contrast, elegant serif", family: "Playfair Display" },
  slab: { says: "a slab serif", family: "Bitter" },
  mono: { says: "a monospace", family: "JetBrains Mono" },
  tech: { says: "a squared, technical face", family: "Oxanium" },
  pixel: { says: "a pixel face", family: "Pixelify Sans" },
  handwritten: { says: "an informal, hand-drawn face", family: "Grandstander" },
} as const;

export type FaceKind = keyof typeof CLOSEST_FACE;

/** Kinds that work as running text. A heading can be any kind. */
const BODY_KINDS: readonly FaceKind[] = [
  "sans-neutral",
  "sans-geometric",
  "sans-humanist",
  "rounded",
  "serif-classic",
  "mono",
];

const CONTROL_RADIUS: Record<(typeof CONTROL_CORNERS)[number], string> = {
  square: "0",
  slight: "0.25rem",
  rounded: "0.5rem",
  "very-rounded": "0.875rem",
  pill: "9999px",
};

const CARD_RADIUS: Record<(typeof CARD_CORNERS)[number], string> = {
  square: "0",
  slight: "0.375rem",
  rounded: "0.75rem",
  "very-rounded": "1.25rem",
};

/** `--radius`, which drives the `rounded-*` utilities: taken from the cards, the commonest shape on a page. */
const BASE_RADIUS: Record<(typeof CARD_CORNERS)[number], string> = {
  square: "0",
  slight: "0.25rem",
  rounded: "0.5rem",
  "very-rounded": "0.875rem",
};

/** What a picture's design was read as. */
export interface ImageReading {
  /** A screenshot or mockup of an app, a site or a page — as opposed to a photo, a logo, a chart. */
  isInterface: boolean;
  /**
   * Whether the message that came with the picture asks for an app that looks
   * like it. Null when there was no message to judge by.
   */
  wanted: boolean | null;
  mode: Mode;
  colors: {
    background: string;
    surface: string;
    text: string;
    mutedText: string | null;
    primary: string;
    onPrimary: string;
    border: string | null;
  };
  controlCorners: (typeof CONTROL_CORNERS)[number];
  cardCorners: (typeof CARD_CORNERS)[number];
  borders: (typeof BORDERS)[number];
  shadows: (typeof SHADOWS)[number];
  fields: (typeof FIELDS)[number];
  uppercaseLabels: boolean;
  /** 1 airy … 10 packed. */
  density: number;
  heading: FaceKind;
  body: FaceKind;
  /** Two sentences on the look. */
  summary: string;
  /** How the page is arranged, a line each. */
  layout: string[];
}

// ── Asking ───────────────────────────────────────────────────────────────────

/** The instructions. `withMessage` adds the question about what the user asked for. */
export function readingPrompt(withMessage: boolean): string {
  const kinds = Object.entries(CLOSEST_FACE)
    .map(([key, face]) => `"${key}" (${face.says})`)
    .join(", ");
  return `You are reading the visual design of a picture so that a different app can be built to look the same. Report how it looks, not what it says or shows.

Reply with one JSON object and nothing else:
{
  "is_interface": true if the picture is a screenshot or mockup of an app, a website or a page; false if it is something else, such as a photograph, a logo, a chart or a document,${
    withMessage
      ? `
  "wanted": true if the user's request asks for an app that looks like this picture — to copy, clone, match or recreate it, or to use its design, style, colours or look; false if the picture is there for another reason, such as content to include, data to use, or an error to fix,`
      : ""
  }
  "mode": "light" or "dark", from the page background,
  "colors": {
    "background": the page,
    "surface": cards and panels,
    "text": the main text,
    "muted_text": secondary text,
    "primary": the one colour used for the main buttons, links and highlights,
    "on_primary": the text on a main button,
    "border": lines and outlines
  },
  "control_corners": the corners of buttons and inputs: ${CONTROL_CORNERS.map((c) => `"${c}"`).join(", ")},
  "card_corners": the corners of cards and panels: ${CARD_CORNERS.map((c) => `"${c}"`).join(", ")},
  "borders": the edge of cards and panels: ${BORDERS.map((c) => `"${c}"`).join(", ")},
  "shadows": "none", "soft" (a blurred shadow) or "hard" (a solid block offset behind),
  "fields": how text inputs are drawn: ${FIELDS.map((c) => `"${c}"`).join(", ")},
  "uppercase_labels": true if buttons or small labels are set in capitals,
  "density": a whole number from 1 (airy, little on screen) to 10 (packed with information),
  "heading_type": the kind of typeface the headings are in, one of: ${kinds},
  "body_type": the kind of typeface the running text is in, one of: ${BODY_KINDS.map((k) => `"${k}"`).join(", ")},
  "summary": two plain sentences on the overall look and feel,
  "layout": up to six short lines on how the page is arranged — what sits where, and in what proportion
}

Every colour is a hex value, "#rrggbb", as you see it in the picture. If the picture shows several screens, read the main one. Name no brand, product, company or person, and do not describe any logo, photograph or illustration: say "a wide photograph" or "a logo", never what it is of.`;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], otherwise: T): T {
  const v = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_]+/g, "-") : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : otherwise;
}

function sentence(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * The model's reply as a reading, or null when it gives no usable colours.
 *
 * Lenient about everything else, like the director's reply: a missing answer
 * takes the plainest value, because a design that is mostly read is better
 * than none. What cannot be done without is the page and the accent.
 */
export function parseImageReading(text: string): ImageReading | null {
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

  const c = (raw.colors && typeof raw.colors === "object" ? raw.colors : {}) as Record<string, unknown>;
  const background = normalizeHex(c.background);
  const primary = normalizeHex(c.primary);
  if (!background || !primary) return null;

  const dark = hexToOklch(background).l < 0.5;
  const text_ = normalizeHex(c.text) ?? (dark ? "#f5f5f5" : "#141414");
  const density = Number(raw.density);
  const heading = oneOf(raw.heading_type, Object.keys(CLOSEST_FACE) as FaceKind[], "sans-neutral");

  return {
    isInterface: raw.is_interface !== false,
    wanted: typeof raw.wanted === "boolean" ? raw.wanted : null,
    // The page colour decides; a "mode" that disagrees with it is a slip.
    mode: dark ? "dark" : "light",
    colors: {
      background,
      surface: normalizeHex(c.surface) ?? background,
      text: text_,
      mutedText: normalizeHex(c.muted_text),
      primary,
      // A guess at white-on-white helps nobody: checked, and replaced if it cannot be read.
      onPrimary: readableOnPrimary(normalizeHex(c.on_primary), primary),
      border: normalizeHex(c.border),
    },
    controlCorners: oneOf(raw.control_corners, CONTROL_CORNERS, "rounded"),
    cardCorners: oneOf(raw.card_corners, CARD_CORNERS, "rounded"),
    borders: oneOf(raw.borders, BORDERS, "hairline"),
    shadows: oneOf(raw.shadows, SHADOWS, "none"),
    fields: oneOf(raw.fields, FIELDS, "outlined"),
    uppercaseLabels: raw.uppercase_labels === true,
    density: Number.isFinite(density) ? Math.min(10, Math.max(1, Math.round(density))) : 5,
    heading,
    body: oneOf(raw.body_type, BODY_KINDS, BODY_KINDS.includes(heading) ? heading : "sans-neutral"),
    summary: sentence(raw.summary, 500),
    layout: (Array.isArray(raw.layout) ? raw.layout : [])
      .map((line) => sentence(line, 200).replace(/^[-•*]\s*/, ""))
      .filter(Boolean)
      .slice(0, 6),
  };
}

/** The text colour reported for a primary button, if it can be read on it; a readable one if not. */
function readableOnPrimary(reported: string | null, primary: string): string {
  if (!reported) return readableOn(primary);
  const a = hexToOklch(reported).l;
  const b = hexToOklch(primary).l;
  return Math.abs(a - b) >= 0.4 ? reported : readableOn(primary);
}

// ── Writing it down ──────────────────────────────────────────────────────────

const CORNER_WORDS: Record<string, string> = {
  square: "square",
  slight: "slightly rounded",
  rounded: "rounded",
  "very-rounded": "generously rounded",
  pill: "pill-shaped",
};

function densityWords(density: number): string {
  return density <= 3 ? "airy, with little on each screen" : density <= 6 ? "comfortably spaced" : "dense, with a lot on each screen";
}

const NOT_COPIED =
  "This design was read from a screenshot. It records how that screen looks, not what it shows: its photographs, illustrations, logos, brand names and wording are not part of it. Use this app's own name and content, and images found for its own subject.";

/** What a design read from a picture leaves out, for whoever is choosing one. */
export const NOT_COPIED_NOTICE =
  "tau takes the colours, shapes, type and layout from a screenshot. Photos, illustrations, logos and brand names in it are not copied.";

/**
 * A reading as a `DESIGN.md`: tokens in the front matter, in the names
 * `importDesign.ts` reads, and prose for the agent and the design director.
 *
 * A picture that is not of an interface has colours worth taking and nothing
 * else — a photograph has no buttons — so only its palette is written.
 */
export function designMdFromReading(reading: ImageReading): string {
  const c = reading.colors;
  const ui = reading.isInterface;
  const heading = CLOSEST_FACE[reading.heading];
  const body = CLOSEST_FACE[reading.body];
  const quoted = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  const front = [
    "---",
    "version: alpha",
    'name: "From a screenshot"',
    "source: screenshot",
    ...(reading.summary ? [`description: ${quoted(reading.summary)}`] : []),
    "colors:",
    `  primary: "${c.primary}"`,
    `  on-primary: "${c.onPrimary}"`,
    `  background: "${c.background}"`,
    `  on-background: "${c.text}"`,
    `  surface: "${c.surface}"`,
    `  on-surface: "${c.text}"`,
    ...(c.mutedText ? [`  on-muted: "${c.mutedText}"`] : []),
    ...(c.border ? [`  border: "${c.border}"`] : []),
    ...(ui
      ? [
          "typography:",
          "  display:",
          `    fontFamily: "${heading.family}"`,
          "  body:",
          `    fontFamily: "${body.family}"`,
          "rounded:",
          `  base: ${BASE_RADIUS[reading.cardCorners]}`,
          `  control: ${CONTROL_RADIUS[reading.controlCorners]}`,
          `  card: ${CARD_RADIUS[reading.cardCorners]}`,
          "shapes:",
          `  borders: ${reading.borders}`,
          `  shadows: ${reading.shadows}`,
          `  fields: ${reading.fields}`,
          `  labels: ${reading.uppercaseLabels ? "uppercase" : "none"}`,
          `density: ${reading.density}`,
        ]
      : []),
    "---",
  ];

  const prose = [
    "# Design, read from a screenshot",
    "",
    "## Overview",
    reading.summary || "A design taken from a screenshot the user gave.",
    "",
    `- Opens in ${reading.mode} mode${ui ? `, and is ${densityWords(reading.density)}` : ""}.`,
    "",
    "## Colors",
    `- The page is \`${c.background}\` and the main text is \`${c.text}\`. Panels are \`${c.surface}\`.`,
    `- One accent, \`${c.primary}\`, for the main buttons, links and highlights.`,
  ];

  if (ui) {
    prose.push(
      "",
      "## Typography",
      `- Headings are in ${heading.says}: **${heading.family}**, the closest match tau can install to the one in the screenshot.`,
      reading.heading === reading.body
        ? "- Running text is in the same face."
        : `- Running text is in ${body.says}: **${body.family}**, again a closest match.`,
      "",
      "## Shapes",
      `- Buttons and fields have ${CORNER_WORDS[reading.controlCorners]} corners. Fields are ${reading.fields === "underline" ? "underlined" : reading.fields}.`,
      `- Cards have ${CORNER_WORDS[reading.cardCorners]} corners, ${
        reading.borders === "none" ? "no border" : reading.borders === "hairline" ? "a thin border" : "a heavy border"
      } and ${reading.shadows === "none" ? "no shadow" : reading.shadows === "soft" ? "a soft shadow" : "a hard, offset shadow"}.`,
      ...(reading.uppercaseLabels ? ["- Buttons and small labels are set in capitals."] : []),
    );
    if (reading.layout.length > 0) {
      prose.push("", "## Layout", ...reading.layout.map((line) => `- ${line}`));
    }
  }

  prose.push("", "## Not copied", NOT_COPIED);
  return `${front.join("\n")}\n${prose.join("\n")}\n`;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface ImageDesign {
  reading: ImageReading;
  /** The reading written out, ready to be imported. */
  designMd: string;
}

export interface ImageReadResult {
  /** Null when the reply could not be used. */
  design: ImageDesign | null;
  usage: { model: string; inputTokens: number; outputTokens: number };
}

/** `image/jpg` is not a real type, and a data URI carrying it is rejected. */
function imageMime(mime: string): string {
  const m = mime.toLowerCase();
  return m === "image/jpg" ? "image/jpeg" : m;
}

/**
 * Read a picture's design. Throws when the model cannot be reached; the caller
 * decides whether that is an error to show or a design to do without.
 *
 * @param message  what the user said when they gave the picture. With it, the
 *                 reading also says whether they were asking for its look.
 */
export async function readDesignImage(input: {
  bytes: Uint8Array;
  mimeType: string;
  message?: string;
}): Promise<ImageReadResult> {
  if (!imageReadingAvailable()) throw new Error("No model that reads images is configured");
  const model = designReviewModel();
  const message = input.message?.trim().slice(0, MAX_MESSAGE_CHARS);

  // Moonshot takes a data URI, not a link (see api/lib/attachments.ts).
  const image = `data:${imageMime(input.mimeType)};base64,${Buffer.from(input.bytes).toString("base64")}`;
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    ...(message ? [{ type: "text" as const, text: `The user's request:\n\n${message}` }] : []),
    { type: "image_url" as const, image_url: { url: image } },
  ];

  const completion = await clientForModel(model).chat.completions.create(
    {
      model,
      max_tokens: READ_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: readingPrompt(Boolean(message)) },
        { role: "user", content },
      ],
      // Left on, the model can spend the whole limit thinking and answer nothing.
      ...({ thinking: { type: "disabled" } } as object),
    },
    // A rate limit is waited out by the Kimi client itself, not retried here.
    { timeout: READ_TIMEOUT_MS, maxRetries: 0 },
  );

  const usage = {
    model,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
  const reading = parseImageReading(completion.choices[0]?.message.content ?? "");
  return { design: reading ? { reading, designMd: designMdFromReading(reading) } : null, usage };
}
