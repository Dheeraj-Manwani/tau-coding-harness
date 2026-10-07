/**
 * Mechanical design checks: things a program can see in the source that mean
 * the app has stepped outside its design.
 *
 * A written design is a request. An agent in the middle of a build drifts from
 * it in small, predictable ways — a `text-blue-500` here, a `rounded-full` on a
 * button there, "Lorem ipsum" left in a card — and none of them is worth a
 * model's attention to find, because all of them are visible to a regular
 * expression. Public "taste" skills ask the model to tick eighty such boxes for
 * itself; here tau ticks them and hands back the failures, so the model spends
 * its effort fixing rather than auditing (doc/CONTEXT_AND_MEMORY_PLAN.md §5).
 *
 * ## What is checked, and what is deliberately not
 *
 * Every rule has to be right nearly every time, because a wrong report costs a
 * turn and teaches the agent to ignore the next one. So the rules look for the
 * unambiguous form of each fault and leave the rest to the screenshot review:
 *
 *   - a colour literal *in a class or a style prop*, not any `#abc` in a file
 *     (an app can legitimately hold colours as data);
 *   - Tailwind's own palette (`bg-blue-500`), which never follows the theme —
 *     but not `white` and `black`, which text over a photograph needs;
 *   - shape, shadow and font classes on the components the skin controls,
 *     where they have no effect anyway;
 *   - placeholder names and filler phrases as whole words in visible text.
 *
 * Only an app with a `.tau/DESIGN.md` is checked: without one there is no
 * design to step outside of.
 *
 * Pure: text in, findings out. The loop decides when to run it (`agent/loop.ts`).
 */
import type { StyleSpec } from "./types";

export type RuleId =
  | "color-literal"
  | "palette-color"
  | "font"
  | "skin-bypass"
  | "shape-literal"
  | "gradient-text"
  | "emoji-icon"
  | "placeholder"
  | "filler-copy"
  | "hotlinked-image"
  | "dependency"
  | "stylesheet";

export interface Finding {
  rule: RuleId;
  path: string;
  /** 1-based line in the file, or 0 when the fault is about the file as a whole. */
  line: number;
  /** What is wrong and what to do instead, in one sentence. */
  message: string;
  /** The offending text, short enough to find. */
  excerpt: string;
}

export interface CheckContext {
  /** The app's style, when tau chose it. Unknown for an imported design. */
  style?: StyleSpec;
  /**
   * The app's `DESIGN.md` as it stands. A typeface it names is part of the
   * design, whoever added it — which is how a font the user asked for stops
   * being reported once the agent has written it down.
   */
  designText?: string;
}

/** `./x`, `/home/user/app/x` and `x` are the same file. */
function rel(path: string): string {
  return path.trim().replace(/^\/home\/user\/app\//, "").replace(/^\.\//, "");
}

/** Source files an agent writes screens in. The stock components are not its to lint. */
export function isScreenSource(path: string): boolean {
  const p = rel(path);
  return (
    p.startsWith("src/") &&
    /\.(tsx|jsx)$/.test(p) &&
    !p.startsWith("src/components/ui/")
  );
}

/** Whether `path` is a file any rule here looks at. */
export function isCheckedPath(path: string): boolean {
  const p = rel(path);
  return isScreenSource(p) || p === "package.json" || p === "src/index.css" || p === "index.html";
}

const COLOR_UTILS =
  "bg|text|border|ring|fill|stroke|from|via|to|decoration|divide|outline|shadow|accent|caret|placeholder";

const TAILWIND_HUES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";

/** `bg-[#1a1a1a]`, `text-[rgb(0,0,0)]`, `border-[oklch(...)]`. */
const ARBITRARY_COLOR = new RegExp(
  `\\b(?:${COLOR_UTILS})-\\[(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\\()[^\\]]*\\]`,
);

/** `bg-blue-500`, `text-slate-400/80`, `from-purple-600`. */
const PALETTE_COLOR = new RegExp(
  `\\b(?:${COLOR_UTILS})-(?:${TAILWIND_HUES})-(?:50|[1-9]00|950)\\b`,
);

/** `color: "#fff"`, `backgroundColor: 'rgb(…)'` inside a style prop. */
const STYLE_COLOR =
  /\b(?:color|background|backgroundColor|borderColor|fill|stroke|outlineColor)\s*:\s*["'`](?:#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\()/;

const STYLE_FONT = /\bfontFamily\s*:/;
const STYLE_SHAPE = /\b(?:borderRadius|boxShadow)\s*:\s*["'`\d]/;
// `font-[650]` is a weight, which is fine; `font-['Inter']` is a typeface.
const ARBITRARY_SHAPE = /\b(?:(?:rounded(?:-[trblse]{1,2})?|shadow)-\[[^\]]+\]|font-\[(?!\d)[^\]]+\])/;
const SERIF_CLASS = /(?<![\w-])font-serif\b/;
const GRADIENT_TEXT = /\bbg-clip-text\b[^"'`]*\btext-transparent\b|\btext-transparent\b[^"'`]*\bbg-clip-text\b/;

/** Characters that are emoji by default — 🚀 ✨ ✅ — not the plain symbols a terminal style uses. */
const EMOJI = /\p{Emoji_Presentation}/u;

const PLACEHOLDER = [
  /\blorem ipsum\b/i,
  /\b(?:John|Jane) (?:Doe|Smith)\b/,
  /\bAcme(?: Inc\.?| Corp\.?| Co\.?)?\b/,
  /\bYour (?:Company|Brand|Name|Logo|Title|Text) Here\b/i,
  /\bFeature (?:One|Two|Three|[1-3])\b/,
  /\b(?:Card|Item|Section) Title\b/,
];

const FILLER = [
  /\bElevate\b/,
  /\bSeamless(?:ly)?\b/i,
  /\bUnleash\b/i,
  /\bSupercharge\b/i,
  /\bRevolutioni[sz]e\b/i,
  /\bunlock the (?:power|potential)\b/i,
  /\bto the next level\b/i,
  /\bcutting[- ]edge\b/i,
  /\bgame[- ]chang(?:er|ing)\b/i,
  /\bworld[- ]class\b/i,
  /\bbest[- ]in[- ]class\b/i,
];

const PLACEHOLDER_IMAGE_HOST =
  /https?:\/\/(?:via\.placeholder\.com|placehold\.co|placekitten\.com|picsum\.photos|source\.unsplash\.com|dummyimage\.com|loremflickr\.com)/i;

/** `<img src="https://…">`, `src={"https://…"}`. */
const HOTLINKED_IMG = /\bsrc=\{?\s*["'`]https?:\/\/[^"'`]+\.(?:png|jpe?g|webp|gif|avif|svg)\b/i;

const ROUNDED = "rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|4xl|full))?";
const SHADOW = "shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|none))?";
const FONT = "font-(?:sans|serif|mono|heading|display)";
const owned = (...parts: string[]) =>
  new RegExp(`(?<![\\w:-])(?:${parts.join("|")})(?![\\w-])`);

/**
 * For each component the skin controls, the classes that do nothing on it
 * because the skin sets that property in a layer that outranks utilities.
 * Only what the shared skin really sets for every style is listed — the
 * message says "has no effect", and it has to be true.
 */
const SKIN_OWNED: Record<string, RegExp> = {
  Button: owned(ROUNDED, FONT),
  Badge: owned(ROUNDED, FONT),
  Card: owned(ROUNDED, SHADOW),
  DialogContent: owned(ROUNDED, SHADOW),
  Input: owned(ROUNDED),
  Textarea: owned(ROUNDED),
  SelectTrigger: owned(ROUNDED),
  TabsList: owned(ROUNDED),
  TabsTrigger: owned(ROUNDED),
};
const SKINNED = Object.keys(SKIN_OWNED);

function excerptOf(line: string, match: string): string {
  const text = match.trim() || line.trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/**
 * Every opening tag of the named components, whole, with the line it starts
 * on. Tracks braces and quotes so `onClick={() => x > 1}` does not end the tag.
 */
function openingTags(
  src: string,
  names: readonly string[],
): { name: string; text: string; line: number }[] {
  const out: { name: string; text: string; line: number }[] = [];
  const re = new RegExp(`<(${names.join("|")})(?=[\\s/>])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const ch = src[i]!;
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    out.push({
      name: m[1]!,
      text: src.slice(m.index, i + 1),
      line: src.slice(0, m.index).split("\n").length,
    });
    re.lastIndex = i;
  }
  return out;
}

function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*");
}

/** A screen's source: classes, inline styles, and the words on the page. */
export function checkScreenSource(path: string, text: string): Finding[] {
  const p = rel(path);
  const findings: Finding[] = [];
  const add = (rule: RuleId, line: number, message: string, excerpt: string) =>
    findings.push({ rule, path: p, line, message, excerpt });

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((line, index) => {
    const n = index + 1;
    if (isComment(line)) return;
    const isImport = /^\s*import\b/.test(line);

    let m = ARBITRARY_COLOR.exec(line);
    if (m) {
      add("color-literal", n, "A colour written into a class does not follow the theme or switch between light and dark. Use a token class (`bg-primary`, `text-muted-foreground`, `border-border`, …).", excerptOf(line, m[0]));
    }
    m = STYLE_COLOR.exec(line);
    if (m) {
      add("color-literal", n, "A colour written into a style prop does not follow the theme. Use a token class, or `var(--primary)` and the like if it has to be a style.", excerptOf(line, m[0]));
    }
    m = PALETTE_COLOR.exec(line);
    if (m) {
      add("palette-color", n, "Tailwind's own palette is not this app's palette. Use a token class instead (`bg-primary`, `bg-muted`, `text-muted-foreground`, `bg-chart-2`, `text-destructive`, …).", excerptOf(line, m[0]));
    }
    m = STYLE_FONT.exec(line) ?? SERIF_CLASS.exec(line);
    if (m) {
      add("font", n, "Typefaces come from the design: use `font-sans`, `font-heading` or `font-mono`, and nothing else.", excerptOf(line, m[0]));
    }
    m = ARBITRARY_SHAPE.exec(line) ?? STYLE_SHAPE.exec(line);
    if (m) {
      add("shape-literal", n, "A one-off radius, shadow or font value steps outside the design's scale. Use the scale (`rounded-lg`, `shadow-md`, `font-heading`); to change the scale itself, change `src/index.css`.", excerptOf(line, m[0]));
    }
    m = GRADIENT_TEXT.exec(line);
    if (m) {
      add("gradient-text", n, "Gradient-filled text is one of the defaults this app avoids. Set the text in one colour.", excerptOf(line, "bg-clip-text text-transparent"));
    }
    if (!isImport) {
      m = EMOJI.exec(line);
      if (m) {
        add("emoji-icon", n, "An emoji is standing where an icon should be. Use a `lucide-react` icon. (Ignore this if the emoji is the content itself — a reaction the user picks, say.)", excerptOf(line, line.trim().slice(0, 60)));
      }
      for (const re of PLACEHOLDER) {
        m = re.exec(line);
        if (m) {
          add("placeholder", n, "Placeholder text. Write the real thing: a name, title or sentence that belongs to this app's subject.", excerptOf(line, m[0]));
          break;
        }
      }
      for (const re of FILLER) {
        m = re.exec(line);
        if (m) {
          add("filler-copy", n, "Stock marketing filler. Say what this actually does, in plain words specific to the subject.", excerptOf(line, m[0]));
          break;
        }
      }
      m = PLACEHOLDER_IMAGE_HOST.exec(line);
      if (m) {
        add("hotlinked-image", n, "A placeholder-image service. Find a real image with `search_images` and save it with `download_asset`.", excerptOf(line, m[0]));
      } else {
        m = HOTLINKED_IMG.exec(line);
        if (m) {
          add("hotlinked-image", n, "An image loaded straight from another site can disappear or be blocked. Save it into the project with `download_asset` and use the local path.", excerptOf(line, m[0]));
        }
      }
    }
  });

  // Classes on a skinned component that the skin overrides: they do nothing,
  // and an agent that does not know that will keep adding them.
  for (const tag of openingTags(text, SKINNED)) {
    const classes = [...tag.text.matchAll(/className=(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/g)]
      .map((c) => c[1] ?? c[2] ?? c[3] ?? "")
      .join(" ");
    const m = SKIN_OWNED[tag.name]!.exec(classes);
    if (m) {
      add(
        "skin-bypass",
        tag.line,
        `\`${m[0]}\` on <${tag.name}> has no effect: the skin in \`src/index.css\` decides that for this component. Remove the class; if every ${tag.name} should look different, change the skin.`,
        excerptOf("", `<${tag.name} … ${m[0]}`),
      );
    }
  }

  return findings;
}

/** Libraries that would put a second design system, or a second icon set, in the app. */
const FOREIGN_UI = [
  /^@mui\//, /^@material-ui\//, /^@chakra-ui\//, /^antd$/, /^@ant-design\//, /^@mantine\//,
  /^react-bootstrap$/, /^bootstrap$/, /^@nextui-org\//, /^@heroui\//, /^daisyui$/, /^flowbite/,
  /^@headlessui\//, /^@radix-ui\/themes$/, /^semantic-ui/, /^primereact$/, /^@blueprintjs\//,
  /^bulma$/, /^styled-components$/, /^@emotion\//, /^@fluentui\//, /^@carbon\//,
];
const FOREIGN_ICONS = [
  /^react-icons$/, /^@heroicons\//, /^@phosphor-icons\//, /^phosphor-react$/, /^@tabler\/icons/,
  /^@fortawesome\//, /^feather-icons$/, /^react-feather$/, /^@iconify\//, /^@remixicon\//, /^remixicon$/,
];

/** `@fontsource-variable/playfair-display` → `playfair display`. */
function fontFamilyOf(pkg: string): string {
  return pkg.replace(/^@fontsource(-variable)?\//, "").replace(/-/g, " ").toLowerCase();
}

export function checkPackageJson(text: string, ctx: CheckContext = {}): Finding[] {
  let deps: Record<string, string>;
  try {
    const pkg = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return [];
  }

  const allowedFonts = new Set(
    ctx.style
      ? Object.values(ctx.style.fonts).map((f) => f.pkg).filter((p): p is string => !!p)
      : [],
  );
  // The scaffold ships with this one; it is not something the agent added.
  allowedFonts.add("@fontsource-variable/geist");
  const design = ctx.designText?.toLowerCase() ?? "";

  const findings: Finding[] = [];
  for (const name of Object.keys(deps)) {
    if (FOREIGN_UI.some((re) => re.test(name))) {
      findings.push({
        rule: "dependency", path: "package.json", line: 0, excerpt: name,
        message: `\`${name}\` is a second component or styling library. This app is built on the shadcn components in \`src/components/ui/\` and Tailwind only — remove it (\`bun remove ${name}\`) and use those.`,
      });
    } else if (FOREIGN_ICONS.some((re) => re.test(name))) {
      findings.push({
        rule: "dependency", path: "package.json", line: 0, excerpt: name,
        message: `\`${name}\` is a second icon set. Icons come from \`lucide-react\` — remove it (\`bun remove ${name}\`).`,
      });
    } else if (
      ctx.style &&
      /^@fontsource(-variable)?\//.test(name) &&
      !allowedFonts.has(name) &&
      !design.includes(fontFamilyOf(name))
    ) {
      findings.push({
        rule: "font", path: "package.json", line: 0, excerpt: name,
        message: `\`${name}\` is a typeface the design does not use. The design's fonts are already installed; remove this one unless the user asked for a different typeface, in which case name it in \`.tau/DESIGN.md\` — a typeface the design names is part of the design.`,
      });
    }
  }
  return findings;
}

/** The stylesheet still has the parts everything else depends on. */
export function checkStylesheet(text: string): Finding[] {
  const findings: Finding[] = [];
  const whole = (message: string, excerpt: string) =>
    findings.push({ rule: "stylesheet", path: "src/index.css", line: 0, message, excerpt });

  if (!/(^|[\s}]):root\s*\{/.test(text) || !/(^|[\s}])\.dark\s*\{/.test(text)) {
    whole("The `:root` and `.dark` palette blocks must both be there: the theme panel edits them, and light and dark mode depend on them. Restore the one that is missing.", ":root / .dark");
  }
  if (!text.includes("@layer skin")) {
    whole("The `@layer skin` block is gone. It is what gives the components this app's shape; without it they fall back to stock shadcn. Restore it — change rules inside it rather than removing it.", "@layer skin");
  }
  if (!text.includes("prefers-reduced-motion")) {
    whole("The `prefers-reduced-motion` rule is gone. Restore it at the end of the file so people who ask for less motion get none.", "prefers-reduced-motion");
  }
  if (!text.includes('@import "shadcn/tailwind.css"')) {
    whole('`@import "shadcn/tailwind.css";` is gone. The components rely on it; without it tabs lay out sideways and menus stop animating. Put it back after the tailwind import.', "shadcn/tailwind.css");
  }
  // Palette values the theme panel cannot write.
  const palette = /(^|[\s}])(?::root|\.dark)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = palette.exec(text))) {
    const bad = /--(?!radius)[\w-]+\s*:\s*((?:oklch|oklab|hsl|hsla|rgb|rgba|lab|lch)\([^;]*)/.exec(m[2]!);
    if (bad) {
      whole("A palette colour is written in a functional notation. Write palette colours as hex (`#1a1a1a`): the theme panel can only edit hex.", bad[0].trim().slice(0, 80));
      break;
    }
  }
  return findings;
}

/** Fonts pulled in from a CDN bypass the design, and the self-hosting that goes with it. */
export function checkIndexHtml(text: string): Finding[] {
  const m = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net/.exec(text);
  if (!m) return [];
  return [{
    rule: "font", path: "index.html", line: text.slice(0, m.index).split("\n").length,
    excerpt: m[0],
    message: "A typeface loaded from a font CDN. The design's fonts are installed with the app and imported in `src/index.css`; remove this link. To use a different typeface, install its `@fontsource` package and follow the `theme` guide.",
  }];
}

/** Run whichever checks apply to `path`. */
export function checkFile(path: string, text: string, ctx: CheckContext = {}): Finding[] {
  const p = rel(path);
  if (p === "package.json") return checkPackageJson(text, ctx);
  if (p === "src/index.css") return checkStylesheet(text);
  if (p === "index.html") return checkIndexHtml(text);
  if (isScreenSource(p)) return checkScreenSource(p, text);
  return [];
}

/** Two findings about the same thing in the same file, wherever its line has moved to. */
export function findingKey(f: Finding): string {
  return `${f.path}|${f.rule}|${f.excerpt}`;
}

/**
 * Findings as text for the model: grouped by file, most files first cut off at
 * `max` so a badly drifted app gets a list it can act on rather than a wall.
 */
export function formatFindings(findings: readonly Finding[], max = 12): string {
  const shown = findings.slice(0, max);
  const lines = shown.map((f) => {
    const where = f.line > 0 ? `${f.path}:${f.line}` : f.path;
    return `- ${where} — \`${f.excerpt}\` — ${f.message}`;
  });
  if (findings.length > max) {
    lines.push(`- …and ${findings.length - max} more of the same kinds. Fix these, and the same faults wherever else they appear.`);
  }
  return lines.join("\n");
}
