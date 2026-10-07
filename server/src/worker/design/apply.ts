/**
 * Putting a design into an app.
 *
 * The sandbox image ships one neutral look, and a design is applied on top of
 * it: no image per style, and no model tokens spent typing out a stylesheet.
 * Five small, idempotent steps:
 *
 *   1. install the design's font packages;
 *   2. give the stock `<Button>` `data-variant` and `data-size` attributes, so
 *      the skin can tell a primary button from a ghost one — the one place the
 *      stock components do not already say what they are;
 *   3. set `<html class="dark">` or remove it, to match the mode;
 *   4. write `.tau/DESIGN.md`;
 *   5. write `src/index.css` — last, so its font imports already resolve when
 *      the dev server reloads.
 *
 * The same steps serve two moments. When an app is created they run in the
 * worker, against the new sandbox. When a user restyles an app they run from
 * the API, against whatever the project has — a live sandbox, or only its
 * stored files. So the steps are written against a `DesignTarget`, which is
 * just "read a file, write a file, install a package", and each caller
 * supplies its own. A restyle also carries over what the app added to the two
 * files since they were first written (`restyle.ts`).
 *
 * Nothing here is allowed to fail the creation of an app. A step that cannot
 * be done is skipped and reported; the worst case is an app that keeps the
 * look it had.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §5.
 */
import { log } from "../lib/log";
import {
  bunAdd,
  hasDependency,
  readOrNull,
  writeTracked,
  type StackContext,
} from "../lib/appStack";
import { DESIGN_PATH } from "./designMd";
import { fontSlug } from "./importDesign";
import { designFiles, resolveDesign } from "./index";
import { carryOverCss, keptNotes, withKeptNotes } from "./restyle";
import { variableFont } from "./styles/fonts";
import { STYLES, fontsFor } from "./styles";
import type { DesignChoice, FontSet, Mode } from "./types";

const BUTTON_PATH = "src/components/ui/button.tsx";
const INDEX_HTML = "index.html";
const INDEX_CSS = "src/index.css";

/** Somewhere a design can be put: a sandbox, a project's stored files, or both. */
export interface DesignTarget {
  /** A file's text, or null when the app has no such file. */
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  /** Add packages to the app. Resolves to the reason when it could not. */
  addPackages(packages: string[]): Promise<{ ok: true } | { ok: false; detail: string }>;
  /**
   * Whether a failed install is reported at once. False where packages are
   * only written into `package.json` for a later install: a name that does not
   * exist would break that install, so only known packages may be added.
   */
  installsNow: boolean;
}

/** The sandbox of a running job, with every write recorded in the project. */
export function sandboxTarget(ctx: StackContext): DesignTarget {
  return {
    read: (path) => readOrNull(ctx.sandbox, path),
    write: (path, content) => writeTracked(ctx, path, content),
    addPackages: (packages) => bunAdd(ctx, packages.join(" ")),
    installsNow: true,
  };
}

/**
 * Add `data-variant` / `data-size` to the stock button. Returns the file
 * unchanged if it already has them, or null if it is not the file expected.
 */
export function tagButton(source: string): string | null {
  if (source.includes("data-variant={variant}")) return source;
  const anchor = /^(\s*)data-slot="button"$/m.exec(source);
  if (!anchor || !/\bvariant\b/.test(source) || !/\bsize\b/.test(source)) return null;
  const indent = anchor[1]!;
  return source.replace(
    anchor[0],
    `${anchor[0]}\n${indent}data-variant={variant}\n${indent}data-size={size}`,
  );
}

/** Make `<html>` open in `mode`, leaving any other class on it alone. */
export function setHtmlMode(html: string, mode: Mode): string {
  return html.replace(/<html\b([^>]*)>/i, (_whole, attrs: string) => {
    const match = /\sclass=(["'])(.*?)\1/i.exec(attrs);
    const classes = (match?.[2] ?? "").split(/\s+/).filter((c) => c && c !== "dark");
    if (mode === "dark") classes.push("dark");
    const rest = match ? attrs.replace(match[0], "") : attrs;
    return `<html${rest}${classes.length > 0 ? ` class="${classes.join(" ")}"` : ""}>`;
  });
}

export interface ApplyResult {
  /** Whether the stylesheet and DESIGN.md were written. */
  applied: boolean;
  fontsInstalled: boolean;
  /** Steps that could not be done, for the run log. */
  skipped: string[];
}

function packagesOf(fonts: FontSet): string[] {
  return [
    ...new Set(
      Object.values(fonts)
        .map((f) => f.pkg)
        .filter((p): p is string => !!p),
    ),
  ];
}

/**
 * The typefaces an imported design names, where they can be had.
 *
 * A name in someone's file is not a package: it may be a font Fontsource does
 * not carry, a licensed face, a typo. So each is tried — installed as the
 * variable-font package of that name — and kept only if the install worked.
 * A role whose font cannot be had falls back to the matching one of the style
 * the design was fitted to. Not attempted where an install cannot be checked.
 */
async function importedFonts(
  target: DesignTarget,
  choice: DesignChoice,
  packageJson: string | null,
  skipped: string[],
): Promise<FontSet> {
  const base = fontsFor(STYLES[choice.style], choice.fonts);
  const named = choice.imported?.tokens.fonts;
  if (!named) return base;

  const fonts: FontSet = { ...base };
  for (const role of ["display", "body", "mono"] as const) {
    const family = named[role];
    if (!family || family === base[role].name) continue;
    const slug = fontSlug(family);
    if (!slug) continue;
    const pkg = `@fontsource-variable/${slug}`;
    const have =
      hasDependency(packageJson, pkg) ||
      (target.installsNow && (await target.addPackages([pkg])).ok);
    // If it fails to load, fall back as the style's own face for the role
    // would: a serif to a serif, a monospace to a monospace.
    const fallback = base[role].stack.includes(",")
      ? base[role].stack.slice(base[role].stack.indexOf(",") + 1).trim()
      : base[role].stack;
    if (have) fonts[role] = variableFont(family, slug, fallback);
    else skipped.push(`font ${family} (not available)`);
  }
  return fonts;
}

/**
 * Apply a design to an app.
 *
 * @param opts.restyle  the app already had a design: keep what it added to
 *                      the stylesheet and to `DESIGN.md` since
 */
export async function applyDesignTo(
  target: DesignTarget,
  choice: DesignChoice,
  opts: { restyle?: boolean; logWith?: Record<string, unknown> } = {},
): Promise<ApplyResult> {
  const skipped: string[] = [];

  // 1. Fonts.
  const packageJson = await target.read("package.json");
  const fonts = await importedFonts(target, choice, packageJson, skipped);
  const design = resolveDesign(choice, fonts);
  const afterProbe = choice.imported ? await target.read("package.json") : packageJson;
  const missing = packagesOf(design.style.fonts).filter((p) => !hasDependency(afterProbe, p));
  let fontsInstalled = true;
  if (missing.length > 0) {
    const added = await target.addPackages(missing);
    if (!added.ok) {
      fontsInstalled = false;
      skipped.push(`fonts (${added.detail.slice(0, 200)})`);
    }
  }

  // 2. Button attributes.
  try {
    const button = await target.read(BUTTON_PATH);
    const tagged = button === null ? null : tagButton(button);
    if (tagged === null) skipped.push("button attributes");
    else if (tagged !== button) await target.write(BUTTON_PATH, tagged);
  } catch (err) {
    skipped.push(`button attributes (${String(err).slice(0, 120)})`);
  }

  // 3. Light or dark.
  try {
    const html = await target.read(INDEX_HTML);
    if (html === null) skipped.push("html mode");
    else {
      const next = setHtmlMode(html, choice.mode);
      if (next !== html) await target.write(INDEX_HTML, next);
    }
  } catch (err) {
    skipped.push(`html mode (${String(err).slice(0, 120)})`);
  }

  // 4 and 5. The two files that are the design.
  const files = designFiles(design, { fontsInstalled });
  let applied = false;
  try {
    let { designMd, css } = files;
    if (opts.restyle) {
      designMd = withKeptNotes(designMd, keptNotes(await target.read(DESIGN_PATH)));
      const before = await target.read(INDEX_CSS);
      if (before) css = carryOverCss(before, css);
    }
    await target.write(DESIGN_PATH, designMd);
    await target.write(INDEX_CSS, css);
    applied = true;
  } catch (err) {
    skipped.push(`design files (${String(err).slice(0, 200)})`);
  }

  log.info(opts.restyle ? "design.restyled" : "design.applied", {
    ...opts.logWith,
    style: choice.style,
    accent: choice.accent,
    mode: choice.mode,
    variance: choice.dials.variance,
    motion: choice.dials.motion,
    density: choice.dials.density,
    ...(choice.fonts ? { fonts: choice.fonts } : {}),
    source: choice.source,
    applied,
    fontsInstalled,
    ...(skipped.length > 0 ? { skipped } : {}),
  });
  return { applied, fontsInstalled, skipped };
}

/** Apply a new app's design in its sandbox. */
export function applyDesign(ctx: StackContext, choice: DesignChoice): Promise<ApplyResult> {
  return applyDesignTo(sandboxTarget(ctx), choice, {
    logWith: { jobId: ctx.jobId, projectId: ctx.projectId },
  });
}
