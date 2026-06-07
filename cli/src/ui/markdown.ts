import chalk from "chalk";

/** Brand violet — matches the τ mark; used for headings and list markers. */
const VIOLET = "#8075E8";
/** Lighter violet for inline code, so it reads as a chip without shouting. */
const CODE_VIOLET = "#B8B0F4";

/**
 * Apply inline markdown styling to a single line of text: inline code,
 * bold, italics, and links. Inline code spans are pulled out first so their
 * contents aren't re-styled by the emphasis rules.
 */
function inline(text: string): string {
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
        return chalk.hex(CODE_VIOLET)(part.slice(1, -1));
      }
      return (
        part
          // **bold** / __bold__
          .replace(/\*\*([^*]+)\*\*/g, (_, t) => chalk.bold(t))
          .replace(/__([^_]+)__/g, (_, t) => chalk.bold(t))
          // *italic* / _italic_
          .replace(/\*([^*]+)\*/g, (_, t) => chalk.italic(t))
          .replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, (_, t) =>
            chalk.italic(t),
          )
          // [text](url)
          .replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            (_, label, url) =>
              `${chalk.underline(label)} ${chalk.dim(`(${url})`)}`,
          )
      );
    })
    .join("");
}

/**
 * Render a markdown string for the terminal: headings, bold/italic, inline
 * code, fenced code blocks, bullet/numbered lists, blockquotes, and horizontal
 * rules. Intentionally small — it covers what a coding agent's replies use,
 * without pulling in a full markdown engine.
 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    // Fenced code blocks: ```lang … ```
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(`${chalk.hex(VIOLET).dim("│")} ${chalk.dim(raw)}`);
      continue;
    }

    // Headings: # … ######
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push(chalk.hex(VIOLET).bold(inline(heading[2] ?? "")));
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^\s*([-*_])\1\1+\s*$/.test(raw)) {
      out.push(chalk.dim("─".repeat(40)));
      continue;
    }

    // Blockquote: > …
    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) {
      out.push(`${chalk.dim("│")} ${chalk.dim(inline(quote[1] ?? ""))}`);
      continue;
    }

    // Bullet list: -, *, +
    const bullet = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      out.push(
        `${bullet[1]}${chalk.hex(VIOLET)("•")} ${inline(bullet[2] ?? "")}`,
      );
      continue;
    }

    // Numbered list: 1. …
    const numbered = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numbered) {
      out.push(
        `${numbered[1]}${chalk.hex(VIOLET)(`${numbered[2]}.`)} ${inline(
          numbered[3] ?? "",
        )}`,
      );
      continue;
    }

    out.push(inline(raw));
  }

  return out.join("\n");
}
