/**
 * Putting a design into a running app.
 *
 * The sandbox image ships one neutral look, and a design is applied on top of
 * it when the app is created: no image per style, and no model tokens spent
 * typing out a stylesheet. Five small, idempotent steps:
 *
 *   1. install the style's font packages (already in the image's package
 *      cache, so this does not wait on the network);
 *   2. give the stock `<Button>` `data-variant` and `data-size` attributes, so
 *      the skin can tell a primary button from a ghost one — the one place the
 *      stock components do not already say what they are;
 *   3. set `<html class="dark">` or remove it, to match the mode;
 *   4. write `.tau/DESIGN.md`;
 *   5. write `src/index.css` — last, so its font imports already resolve when
 *      the dev server reloads.
 *
 * Every file goes through the manifest as well as the sandbox, like anything
 * else tau writes, so the design survives a rebuilt sandbox and is pushed with
 * the project.
 *
 * Nothing here is allowed to fail the creation of an app. A step that cannot
 * be done is skipped and reported; the worst case is an app that keeps the
 * neutral look it booted with.
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
import { designFiles, resolveDesign } from "./index";
import type { DesignChoice, Mode } from "./types";

const BUTTON_PATH = "src/components/ui/button.tsx";
const INDEX_HTML = "index.html";
const INDEX_CSS = "src/index.css";

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

export async function applyDesign(
  ctx: StackContext,
  choice: DesignChoice,
): Promise<ApplyResult> {
  const design = resolveDesign(choice);
  const skipped: string[] = [];

  // 1. Fonts.
  const packages = [
    ...new Set(
      Object.values(design.style.fonts)
        .map((f) => f.pkg)
        .filter((p): p is string => !!p),
    ),
  ];
  const packageJson = await readOrNull(ctx.sandbox, "package.json");
  const missing = packages.filter((p) => !hasDependency(packageJson, p));
  let fontsInstalled = true;
  if (missing.length > 0) {
    const added = await bunAdd(ctx, missing.join(" "));
    if (!added.ok) {
      fontsInstalled = false;
      skipped.push(`fonts (${added.detail.slice(0, 200)})`);
    }
  }

  // 2. Button attributes.
  try {
    const button = await readOrNull(ctx.sandbox, BUTTON_PATH);
    const tagged = button === null ? null : tagButton(button);
    if (tagged === null) skipped.push("button attributes");
    else if (tagged !== button) await writeTracked(ctx, BUTTON_PATH, tagged);
  } catch (err) {
    skipped.push(`button attributes (${String(err).slice(0, 120)})`);
  }

  // 3. Light or dark.
  try {
    const html = await readOrNull(ctx.sandbox, INDEX_HTML);
    if (html === null) skipped.push("html mode");
    else {
      const next = setHtmlMode(html, choice.mode);
      if (next !== html) await writeTracked(ctx, INDEX_HTML, next);
    }
  } catch (err) {
    skipped.push(`html mode (${String(err).slice(0, 120)})`);
  }

  // 4 and 5. The two files that are the design.
  const files = designFiles(design, { fontsInstalled });
  let applied = false;
  try {
    await writeTracked(ctx, DESIGN_PATH, files.designMd);
    await writeTracked(ctx, INDEX_CSS, files.css);
    applied = true;
  } catch (err) {
    skipped.push(`design files (${String(err).slice(0, 200)})`);
  }

  log.info("design.applied", {
    jobId: ctx.jobId,
    projectId: ctx.projectId,
    style: choice.style,
    accent: choice.accent,
    mode: choice.mode,
    variance: choice.dials.variance,
    motion: choice.dials.motion,
    density: choice.dials.density,
    source: choice.source,
    applied,
    fontsInstalled,
    ...(skipped.length > 0 ? { skipped } : {}),
  });
  return { applied, fontsInstalled, skipped };
}
