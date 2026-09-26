/** Paste this long or longer becomes a chip instead of filling the textarea -
 *  clear of a normal snippet, below the point the composer gets unusable. */
export const PASTE_THRESHOLD = 1_500;

export interface PasteIntent {
  kind: "files" | "large-text" | "default";
  files: File[];
  text: string;
}

/** Clipboard files become attachments, long text becomes a chip, anything else
 *  falls through to the browser's own paste. */
export function classifyPaste(clipboard: DataTransfer | null): PasteIntent {
  if (!clipboard) return { kind: "default", files: [], text: "" };

  const files = Array.from(clipboard.files ?? []);
  if (files.length > 0) {
    return { kind: "files", files, text: "" };
  }

  const text = clipboard.getData("text/plain");
  if (text.length >= PASTE_THRESHOLD) {
    return { kind: "large-text", files: [], text };
  }

  return { kind: "default", files: [], text };
}

export function filesFromDrop(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  return Array.from(dataTransfer.files ?? []);
}
