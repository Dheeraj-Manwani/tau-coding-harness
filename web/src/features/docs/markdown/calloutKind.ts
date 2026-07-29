/**
 * The GitHub-alert markers the docs renderer recognises.
 *
 * Split from `Callout.tsx` so that file exports only its component — the
 * detector is used by `Markdown.tsx` while walking blockquotes, before it knows
 * whether a `Callout` is involved at all.
 */

export type CalloutKind = "NOTE" | "TIP" | "WARNING";

/** Recognises the marker at the head of a blockquote, e.g. `> [!NOTE]`. */
export function calloutKindOf(text: string): CalloutKind | null {
  const match = /^\s*\[!(NOTE|TIP|WARNING)\]\s*/i.exec(text);
  return match ? (match[1]!.toUpperCase() as CalloutKind) : null;
}
