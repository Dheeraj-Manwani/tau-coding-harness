import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";

/**
 * A syntax-highlighted code block with a copy button.
 *
 * Shiki is loaded with a dynamic `import()` *inside the effect*, and with an
 * explicit list of languages, for two reasons: the highlighter never touches
 * the marketing chunk, and a docs page that contains no code never downloads it
 * at all. Highlighting is progressive — the block renders as plain monospace
 * immediately and upgrades when the highlighter lands, so a slow network costs
 * you colour, not content.
 */

/** The languages the docs actually use. Every extra one is grammar weight. */
const LANGS = [
  "ts",
  "tsx",
  "js",
  "json",
  "bash",
  "md",
] as const;

type Lang = (typeof LANGS)[number];

/** One highlighter for the whole session, created at most once. */
let highlighterPromise: Promise<{
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
}> | null = null;

function getHighlighter() {
  highlighterPromise ??= import("shiki").then((shiki) =>
    shiki.createHighlighter({
      themes: ["github-dark-default"],
      langs: [...LANGS],
    }),
  );
  return highlighterPromise;
}

function normaliseLang(raw: string | undefined): Lang | null {
  if (!raw) return null;
  const lang = raw.toLowerCase();
  const alias: Record<string, Lang> = {
    typescript: "ts",
    javascript: "js",
    shell: "bash",
    sh: "bash",
    markdown: "md",
  };
  const resolved = alias[lang] ?? (lang as Lang);
  return (LANGS as readonly string[]).includes(resolved) ? resolved : null;
}

interface CodeBlockProps {
  code: string;
  /** From the fence info string, e.g. ```ts. */
  language?: string;
  /** Rendered as a tab above the block. */
  filename?: string;
}

export function CodeBlock({ code, language, filename }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lang = normaliseLang(language);

  useEffect(() => {
    if (!lang) return;
    let cancelled = false;
    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        setHtml(
          highlighter.codeToHtml(code, {
            lang,
            theme: "github-dark-default",
          }),
        );
      })
      .catch(() => {
        // Plain monospace is a perfectly good code block. Never let a failed
        // highlighter take the content down with it.
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard denied (insecure context, or the user said no). The code is
      // still selectable; there is nothing useful to say about it.
    }
  };

  return (
    <div className="group relative my-6 overflow-hidden rounded-xl border border-silver-200 bg-space-void">
      {filename && (
        <div className="border-b border-silver-200 px-4 py-2 font-mono text-xs text-silver-400">
          {filename}
        </div>
      )}

      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy code"}
        className={cn(
          "absolute right-2 z-10 flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-all",
          filename ? "top-11" : "top-2",
          copied
            ? "border-flux/60 text-flux"
            : "border-silver-200 text-silver-600 opacity-0 hover:text-silver-900 focus-visible:opacity-100 group-hover:opacity-100",
        )}
      >
        {copied ? (
          <>
            <CheckIcon className="size-3" />
            Copied
          </>
        ) : (
          <>
            <CopyIcon className="size-3" />
            Copy
          </>
        )}
      </button>

      {html ? (
        <div
          className="docs-shiki overflow-x-auto p-4 text-[0.8rem] leading-relaxed"
          // Shiki's output. The input is markdown from our own content
          // directory, not user input.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 font-mono text-[0.8rem] leading-relaxed text-silver-600">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

export default CodeBlock;
