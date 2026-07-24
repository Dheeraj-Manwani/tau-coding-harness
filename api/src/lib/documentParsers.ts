/** Below this many characters we treat a parse as failed and fall back. */
export const MIN_USEFUL_CHARS = 20;

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Legacy binary Word. Mammoth can't read it — it only handles OOXML. */
export const DOC_MIME = "application/msword";

export function isLocallyParsable(mime: string): boolean {
  const m = mime.toLowerCase();
  return m === PDF_MIME || m === DOCX_MIME;
}

export interface ParsedDocument {
  text: string;
  /** False when the file parsed but yielded nothing usable (e.g. a scan). */
  usable: boolean;
}

function verdict(text: string): ParsedDocument {
  const trimmed = text.trim();
  return { text: trimmed, usable: trimmed.length >= MIN_USEFUL_CHARS };
}

/**
 * A scanned PDF is images of paper with no text layer, so this returns ~nothing
 * and `usable: false` — the caller then retries through Kimi, which can
 * actually look at the pages.
 */
async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js TRANSFERS the array it's handed and detaches the underlying buffer,
  // leaving the caller holding a zero-length view. Our caller still needs these
  // bytes to fall back to Kimi when the parse comes up empty — which is exactly
  // the scanned-PDF path — so give pdf.js a copy and keep the original intact.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return verdict(Array.isArray(text) ? text.join("\n\n") : text);
}

async function parseDocx(bytes: Uint8Array): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  // Buffer.from(TypedArray) already copies, so the caller's bytes survive.
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(bytes),
  });
  return verdict(value);
}

/**
 * Parse locally if we can. Returns null when the format isn't ours to handle,
 * so the caller can tell "not supported here" apart from "parsed but empty".
 * Never throws — a library blowing up on a malformed file is a fallback
 * trigger, not a job failure.
 */
export async function parseDocumentLocally(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ParsedDocument | null> {
  const mime = mimeType.toLowerCase();
  try {
    if (mime === PDF_MIME) return await parsePdf(bytes);
    if (mime === DOCX_MIME) return await parseDocx(bytes);
    return null;
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "attachment.localParse.failed",
        mimeType,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { text: "", usable: false };
  }
}
