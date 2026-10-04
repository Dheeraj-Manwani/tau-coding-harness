/**
 * `tau-tagger` — the Vite plugin behind visual edit (doc/VISUAL_EDIT_PLAN.md §5.1).
 *
 * Stamps every JSX *host* element with its source position:
 *
 *     <button className="…">      →    <button data-tau-loc="src/App.tsx:5:7" className="…">
 *
 * That attribute is the entire bridge between "the user clicked this pixel" and
 * "this is the byte range to edit". Everything else in the feature is plumbing.
 *
 * These are the real bytes, in three places at once: the template build bakes
 * them into the E2B images as `.tau/tagger.ts` (`writeVisualEdit`),
 * `retrofitVisualEdit` writes them into the manifest of projects that predate
 * the feature, and `scripts/spike-visual-edit.ts` installs them into a throwaway
 * sandbox to check them against a real browser. Edit here, nowhere else.
 *
 * Four properties that are not optional:
 *
 *   1. `enforce: "pre"` — @vitejs/plugin-react rewrites JSX into `jsxDEV(...)`
 *      calls. After that there is no JSX left to tag. We must run first.
 *   2. `apply: "serve"` — dev only. Production builds are byte-for-byte
 *      unaffected, so nothing ships to the user's deployed app.
 *   3. Parse failures return `null`. The agent streams files in character by
 *      character, so this transform *will* be handed syntactically invalid TSX
 *      many times per build. Throwing would break the whole preview.
 *   4. Lowercase tags only. `data-tau-loc` on `<Card>` lands in the component's
 *      props and is usually dropped rather than forwarded to the DOM.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import MagicString from "magic-string";

export const TAU_LOC_ATTR = "data-tau-loc";

/** Placeholder inside runtime.js, swapped for the real origin at inject time. */
const ORIGIN_PLACEHOLDER = "__TAU_PARENT_ORIGIN__";

export interface TauTaggerOptions {
  /**
   * Origin allowed to drive the runtime over postMessage — the tau app.
   * `"*"` disables the check; only acceptable in the spike.
   */
  parentOrigin?: string;
  /** Project root. Defaults to Vite's resolved root. */
  root?: string;
}

interface BabelNode {
  type: string;
  start?: number;
  end?: number;
  loc?: { start: { line: number; column: number } };
  [key: string]: unknown;
}

/**
 * Walk every node in the AST.
 *
 * Deliberately hand-rolled rather than pulling in `@babel/traverse`: we need
 * exactly one node type and traverse is a heavy dependency to add to every
 * generated project for a `node.type ===` check.
 */
function walk(node: unknown, visit: (n: BabelNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as BabelNode;
  if (typeof n.type === "string") visit(n);
  for (const key of Object.keys(n)) {
    // `loc` is position metadata, not a child node — walking it wastes time on
    // every single node in the file.
    if (key === "loc") continue;
    walk(n[key], visit);
  }
}

/** A host element is a lowercase-initial plain identifier: div, button, h1. */
function hostTagName(nameNode: unknown): string | null {
  const n = nameNode as BabelNode | undefined;
  if (!n || n.type !== "JSXIdentifier") return null; // skips Foo.Bar, ns:tag
  const name = n.name as string;
  return /^[a-z]/.test(name) ? name : null; // skips <Card>, <App>
}

function readPreviewScript(root: string, name: string): string {
  try {
    return readFileSync(path.join(root, "..", name), "utf8");
  } catch {
    return "";
  }
}

export function tauTagger(options: TauTaggerOptions = {}) {
  const parentOrigin =
    options.parentOrigin ?? process.env.TAU_PARENT_ORIGIN ?? "*";

  let root = options.root ?? process.cwd();
  let runtime = "";

  return {
    name: "tau-tagger",
    apply: "serve" as const,
    enforce: "pre" as const,

    configResolved(config: { root: string }) {
      root = options.root ?? config.root;
      // Read the runtime from a path derived from the project root, NOT from
      // `import.meta.url`: Vite bundles vite.config.ts (and everything it
      // imports, including this file) into a temp module beside the config, so
      // a path relative to this source file resolves to the wrong place.
      const runtimePath = path.join(root, ".tau", "runtime.js");
      try {
        runtime = readFileSync(runtimePath, "utf8").replaceAll(
          ORIGIN_PLACEHOLDER,
          parentOrigin,
        );
      } catch {
        // Loud, but non-fatal: the app must still run without visual edit.
        console.warn(`[tau-tagger] runtime not found at ${runtimePath}`);
        runtime = "";
      }
    },

    transform(code: string, id: string) {
      const file = id.split("?")[0];
      if (!/\.[jt]sx$/.test(file)) return null;
      if (file.includes("node_modules")) return null;

      let ast: unknown;
      try {
        ast = parse(code, {
          sourceType: "module",
          allowReturnOutsideFunction: true,
          plugins: file.endsWith(".tsx")
            ? ["jsx", "typescript"]
            : ["jsx", "flow"],
        });
      } catch {
        return null; // half-written file mid-stream — pass through untouched
      }

      const rel = path.relative(root, file).split(path.sep).join("/");
      const s = new MagicString(code);
      let tagged = 0;

      walk(ast, (node) => {
        if (node.type !== "JSXOpeningElement") return;
        if (!hostTagName(node.name)) return;

        // Don't double-tag if this file somehow already carries attributes.
        const attrs = (node.attributes ?? []) as BabelNode[];
        const already = attrs.some((a) => {
          const name = a?.name as BabelNode | undefined;
          return a?.type === "JSXAttribute" && name?.name === TAU_LOC_ATTR;
        });
        if (already) return;

        const start = node.loc?.start;
        const nameEnd = (node.name as BabelNode).end;
        if (!start || typeof nameEnd !== "number") return;

        // Babel columns are 0-based; the wire format is 1-based to match what
        // editors and the TypeScript AST both use.
        const loc = `${rel}:${start.line}:${start.column + 1}`;

        // Insert right after the tag name, which is correct for `<div>`,
        // `<div className="x">` and `<div />` alike.
        s.appendLeft(nameEnd, ` ${TAU_LOC_ATTR}="${loc}"`);
        tagged++;
      });

      if (tagged === 0) return null;

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: file }),
      };
    },

    transformIndexHtml() {
      const tags: Array<{
        tag: string;
        attrs?: Record<string, string>;
        children: string;
        injectTo: "body" | "head-prepend";
      }> = [];
      const health = readPreviewScript(root, ".tau-preview-health.js");
      if (health) {
        tags.push({ tag: "script", children: health, injectTo: "head-prepend" });
      }
      // Injected here rather than written into the project: it never enters the
      // file manifest, never reaches GitHub, and the agent cannot see it (and
      // so cannot "tidy it up").
      if (runtime) {
        tags.push({
          tag: "script",
          attrs: { type: "module" },
          children: runtime,
          injectTo: "body",
        });
      }
      // The "Built with tau" badge, for free-plan projects. tau writes it beside
      // the app, not in it (`PREVIEW_BADGE_SANDBOX_PATH` in the server's
      // lib/badge), and deletes it for Pro. Read on every page load rather than
      // once at boot, so a plan change shows up on the next reload without
      // restarting Vite. Absent file = no badge.
      const badge = readPreviewScript(root, ".tau-badge.js");
      if (badge) {
        tags.push({ tag: "script", children: badge, injectTo: "body" });
      }
      // Independent of plan: the script itself skips embedded previews.
      const banner = readPreviewScript(root, ".tau-preview-banner.js");
      if (banner) {
        tags.push({ tag: "script", children: banner, injectTo: "body" });
      }
      return tags;
    },
  };
}

export default tauTagger;
