import type OpenAI from "openai";
import { kimi } from "@/lib/kimi";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getObjectBytes } from "@/lib/s3";
import {
  isLocallyParsable,
  parseDocumentLocally,
  MIN_USEFUL_CHARS,
} from "./documentParsers";
import { AttachmentKind, AttachmentStatus } from "@/generated/prisma/enums";

/** Cap on what any single attachment may contribute to a prompt. */
export const MAX_ATTACHMENT_CHARS = 8_000;

/** Denormalised chip preview — keeps the transcript off the full body. */
export const PREVIEW_CHARS = 240;

const EXTRACT_MAX_TOKENS = 1_500;

/** How long a send waits for an in-flight extraction before giving up. */
export const EXTRACTION_WAIT_MS = 20_000;

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

/** Read directly as UTF-8 — no model call. */
const PLAIN_TEXT_MIME = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/sql",
]);

/**
 * Extensions we treat as text no matter what the browser claims. Browsers are
 * bad at this: `.log` and `.env` come through as `application/octet-stream`,
 * and `.ts` is reported as `video/mp2t` (MPEG transport stream) — so a MIME-only
 * allowlist turns away exactly the files a coding tool most wants.
 */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "csv", "tsv", "json", "jsonl", "xml", "yaml",
  "yml", "toml", "ini", "conf", "cfg", "env", "sql", "sh", "bash", "zsh",
  "ps1", "bat", "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "go",
  "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "php",
  "css", "scss", "less", "html", "htm", "svg", "vue", "svelte", "graphql",
  "gql", "prisma", "lock", "diff", "patch",
  // Matched via textToken(): dotfiles and extensionless names.
  "dockerfile", "makefile", "gitignore", "dockerignore", "npmrc", "nvmrc",
  "editorconfig", "prettierrc", "eslintrc", "babelrc", "readme", "license",
]);

/** Formats Kimi's file-extract can read that we don't parse ourselves. */
const KIMI_DOCUMENT_EXTENSIONS = new Set([
  "xls", "xlsx", "ppt", "pptx", "doc", "epub", "rtf", "odt", "ods", "odp",
]);

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * The token to match against {@link TEXT_EXTENSIONS}. Not the same thing as an
 * extension: `.env` and `.gitignore` are dotfiles whose *name* is the type, and
 * `Dockerfile` / `Makefile` have no dot at all. Matching on extension alone
 * turns all of those away.
 */
function textToken(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const ext = fileExtension(base);
  if (ext) return ext;
  return base.replace(/^\./, "").toLowerCase();
}

export function isImageMime(mime: string): boolean {
  return IMAGE_MIME.has(mime.toLowerCase());
}

/** MIME-only check — use {@link isTextLike} when a filename is available. */
export function isPlainTextMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith("text/") || PLAIN_TEXT_MIME.has(m);
}

/** Text by MIME *or* by filename, so a badly-typed `.log` still gets through. */
export function isTextLike(filename: string, mime: string): boolean {
  return isPlainTextMime(mime) || TEXT_EXTENSIONS.has(textToken(filename));
}

export function isAllowedUpload(filename: string, mime: string): boolean {
  const ext = fileExtension(filename);
  return (
    isImageMime(mime) ||
    isTextLike(filename, mime) ||
    isLocallyParsable(mime) ||
    ext === "pdf" ||
    ext === "docx" ||
    KIMI_DOCUMENT_EXTENSIONS.has(ext)
  );
}

export function kindForMime(mime: string): AttachmentKind {
  return isImageMime(mime) ? AttachmentKind.IMAGE : AttachmentKind.FILE;
}

export function maxBytesForMime(mime: string): number {
  return isImageMime(mime)
    ? env.ATTACHMENT_MAX_IMAGE_BYTES
    : env.ATTACHMENT_MAX_BYTES;
}

export function truncate(text: string, max = MAX_ATTACHMENT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated, ${text.length - max} more characters]`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// The consumer is a coding agent building a web app, not a human reader —
// generic OCR output is close to useless here.
const IMAGE_SYSTEM_PROMPT = `You are converting an attachment into text for a coding agent that builds web apps. Describe everything a developer would need to reproduce or act on this image: layout and structure, component hierarchy, exact visible text (verbatim), colors, spacing, states, and any data shown. Transcribe all text exactly. If it is a screenshot of an error, a terminal, or code, transcribe it verbatim and do not summarize. If it is a photo or a non-UI image, describe the subject plainly. Output plain text or markdown. No preamble.`;

const DOCUMENT_SYSTEM_PROMPT = `You are converting a document into text for a coding agent that builds web apps. Extract the content faithfully and preserve its structure (headings, lists, tables). Transcribe text exactly rather than summarizing. Output plain text or markdown. No preamble.`;

/** The typed message says what the attachment is for: "fix this error" wants
 *  verbatim transcription, "build this" wants layout. */
function intentHint(userMessage?: string): string {
  const trimmed = userMessage?.trim();
  if (!trimmed) return "";
  return `\n\nThe user's request, for context on what matters in this attachment: "${truncate(trimmed, 500)}"`;
}

export interface ExtractionResult {
  text: string;
  model: string | null;
  tokens: number;
}

/** `image/jpg` isn't a real MIME type and a data URI carrying it is rejected. */
function normalizeImageMime(mime: string): string {
  const m = mime.toLowerCase();
  return m === "image/jpg" ? "image/jpeg" : m;
}

/**
 * Kimi-specific request fields the OpenAI-typed params don't model.
 *
 * K2.6 thinks by default, and left on it spends the WHOLE `max_tokens` budget
 * on reasoning — `finish_reason: "length"` with empty content and
 * `reasoning_tokens: 1499/1500`. Extraction is transcription, not reasoning, so
 * the thinking pass buys nothing and costs the entire output.
 */
const NO_THINKING = { thinking: { type: "disabled" } };

type CompletionParams =
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type UserContent = OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"];

/** One completion against the extraction model, shared by every input type. */
async function runKimiExtraction(
  systemPrompt: string,
  userContent: UserContent,
): Promise<ExtractionResult> {
  if (!kimi) throw new Error("Attachment extraction is not configured");
  const model = env.KIMI_EXTRACT_MODEL;

  const completion = await kimi.chat.completions.create({
    model,
    max_tokens: EXTRACT_MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    ...NO_THINKING,
  } as CompletionParams);

  const choice = completion.choices[0];
  const text = choice?.message.content?.trim();
  if (!text) {
    throw new Error(
      `Extraction returned no text (finish_reason: ${choice?.finish_reason ?? "unknown"})`,
    );
  }

  return { text, model, tokens: completion.usage?.total_tokens ?? 0 };
}

async function extractImage(
  key: string,
  mimeType: string,
  userMessage?: string,
): Promise<ExtractionResult> {
  // Kimi's vision models reject remote URLs outright ("unsupported image url")
  // — they take a base64 data URI or an ms://<file-id>. So we pull the bytes
  // back through this process rather than handing over a presigned link.
  // Base64 inflates ~33%, which ATTACHMENT_MAX_IMAGE_BYTES already bounds.
  const bytes = await getObjectBytes(key);
  const dataUri = `data:${normalizeImageMime(mimeType)};base64,${Buffer.from(bytes).toString("base64")}`;

  return runKimiExtraction(IMAGE_SYSTEM_PROMPT + intentHint(userMessage), [
    { type: "image_url", image_url: { url: dataUri } },
  ]);
}

/**
 * Kimi's file-extract service: upload the raw file, read back its text.
 * Covers the formats we deliberately don't parse in-process (xlsx, pptx, legacy
 * .doc, epub) and rescues a scanned PDF that yielded no text locally.
 *
 * `purpose: "file-extract"` is Moonshot-specific and absent from the
 * OpenAI-typed union, hence the cast.
 */
async function extractViaKimiFiles(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<ExtractionResult> {
  if (!kimi) throw new Error("Attachment extraction is not configured");

  // Kimi reports empty uploads as "File size is zero, please confirm and
  // re-upload" — which reads like a client problem and sent us the wrong way
  // once already. If the bytes are empty here, something upstream consumed
  // them (pdf.js detaches arrays it's handed), so say that instead.
  if (bytes.byteLength === 0) {
    throw new Error(
      `Refusing to upload 0 bytes for ${filename} — the buffer was consumed before reaching file-extract`,
    );
  }

  const uploaded = await kimi.files.create({
    file: new File([bytes as BlobPart], filename, { type: mimeType }),
    purpose: "file-extract" as OpenAI.FilePurpose,
  });

  try {
    const res = await kimi.files.content(uploaded.id);
    const raw = await res.text();

    // Moonshot returns JSON with the text under `content`; tolerate plain text
    // in case that ever changes.
    let text = raw;
    try {
      const parsed = JSON.parse(raw) as { content?: string };
      if (typeof parsed.content === "string") text = parsed.content;
    } catch {
      // not JSON — use the body as-is
    }

    text = text.trim();
    if (text.length < MIN_USEFUL_CHARS) {
      throw new Error("File extraction returned no usable text");
    }
    // Not a chat model — label it for what it is so cost debugging stays honest.
    return { text, model: "kimi-file-extract", tokens: 0 };
  } finally {
    // Don't accumulate uploads on Moonshot's side; we already hold the bytes.
    await kimi.files.delete(uploaded.id).catch(() => undefined);
  }
}

/** Bytes that don't decode as text — a binary file mislabelled by extension. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

/**
 * Route one attachment to the cheapest thing that can actually read it:
 *
 *   image            → Kimi vision
 *   text-like        → decoded in-process, no model, no cost
 *   pdf / docx       → parsed in-process; falls through to Kimi if it yields
 *                      nothing usable (a scanned PDF has no text layer)
 *   everything else  → Kimi file-extract (xlsx, pptx, legacy .doc, epub)
 *
 * Only if Kimi is unavailable or also fails do we fall back to a stub, so the
 * agent is told plainly rather than handed silence.
 */
async function extractByType(
  blobKey: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
  userMessage?: string,
): Promise<ExtractionResult> {
  if (isImageMime(mimeType)) {
    return extractImage(blobKey, mimeType, userMessage);
  }

  const bytes = await getObjectBytes(blobKey);

  if (isTextLike(filename, mimeType)) {
    const text = decodeUtf8(bytes);
    // An extension can lie. If it isn't really text, treat it as a document.
    if (text !== null) return { text, model: null, tokens: 0 };
  }

  if (isLocallyParsable(mimeType)) {
    const parsed = await parseDocumentLocally(bytes, mimeType);
    if (parsed?.usable) {
      return { text: parsed.text, model: "local", tokens: 0 };
    }
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "attachment.localParse.empty",
        filename,
        mimeType,
        note: "falling back to Kimi file-extract",
      }),
    );
  }

  if (kimi) {
    try {
      return await extractViaKimiFiles(bytes, filename, mimeType);
    } catch (err) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "attachment.kimiFileExtract.failed",
          filename,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return {
    text: `[Attachment: ${filename} (${formatBytes(sizeBytes)}, ${mimeType}) — contents could not be read. The user can still download it.]`,
    model: null,
    tokens: 0,
  };
}

/** Never throws — failures are recorded as FAILED so the send path can degrade
 *  to a stub instead of blocking the message. */
export async function runExtraction(
  attachmentId: string,
  userMessage?: string,
): Promise<void> {
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
  });
  if (!row || row.status === AttachmentStatus.READY) return;

  try {
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { status: AttachmentStatus.EXTRACTING, extractionError: null },
    });

    // Same bytes, same model, same user — reuse rather than re-extract.
    if (row.contentHash) {
      const cached = await prisma.attachment.findFirst({
        where: {
          userId: row.userId,
          contentHash: row.contentHash,
          status: AttachmentStatus.READY,
          extractionModel: env.KIMI_EXTRACT_MODEL,
          id: { not: attachmentId },
          extractedText: { not: null },
        },
        orderBy: { createdAt: "desc" },
      });
      if (cached?.extractedText) {
        await prisma.attachment.update({
          where: { id: attachmentId },
          data: {
            status: AttachmentStatus.READY,
            extractedText: cached.extractedText,
            extractionModel: cached.extractionModel,
            extractionTokens: 0,
          },
        });
        return;
      }
    }

    if (!row.blobKey) throw new Error("Attachment has no stored object");

    const result = await extractByType(
      row.blobKey,
      row.filename,
      row.mimeType,
      row.sizeBytes,
      userMessage,
    );

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: {
        status: AttachmentStatus.READY,
        extractedText: truncate(result.text),
        preview: result.text.slice(0, PREVIEW_CHARS),
        extractionModel: result.model,
        extractionTokens: result.tokens,
        extractionError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "attachment.extract.failed",
        attachmentId,
        error: message,
      }),
    );
    await prisma.attachment
      .update({
        where: { id: attachmentId },
        data: {
          status: AttachmentStatus.FAILED,
          extractionError: message.slice(0, 500),
        },
      })
      .catch(() => undefined);
  }
}

export interface ResolvedAttachment {
  id: string;
  kind: AttachmentKind;
  filename: string;
  status: AttachmentStatus;
  extractedText: string | null;
  extractionError: string | null;
}

/**
 * Wait for extraction to settle, then return the rows in the caller's order.
 * Usually returns on the first poll — extraction started at upload time. The
 * ownership check matters: `attachmentIds` comes straight from the client.
 */
export async function waitForExtraction(
  userId: string,
  attachmentIds: string[],
  timeoutMs = EXTRACTION_WAIT_MS,
): Promise<ResolvedAttachment[]> {
  const deadline = Date.now() + timeoutMs;
  const select = {
    id: true,
    kind: true,
    filename: true,
    status: true,
    extractedText: true,
    extractionError: true,
    userId: true,
    messageId: true,
    feedbackId: true,
  } as const;

  for (;;) {
    const rows = await prisma.attachment.findMany({
      where: { id: { in: attachmentIds } },
      select,
    });

    if (rows.length !== attachmentIds.length) {
      throw new Error("ATTACHMENT_NOT_FOUND");
    }
    if (rows.some((r) => r.userId !== userId)) {
      throw new Error("ATTACHMENT_FORBIDDEN");
    }
    // Stops one upload being replayed into many messages.
    if (rows.some((r) => r.messageId !== null || r.feedbackId != null)) {
      throw new Error("ATTACHMENT_ALREADY_USED");
    }

    const settled = rows.every(
      (r) =>
        r.status === AttachmentStatus.READY ||
        r.status === AttachmentStatus.FAILED,
    );

    if (settled || Date.now() >= deadline) {
      const byId = new Map(rows.map((r) => [r.id, r]));
      return attachmentIds.map((id) => {
        const r = byId.get(id)!;
        return {
          id: r.id,
          kind: r.kind,
          filename: r.filename,
          status: r.status,
          extractedText: r.extractedText,
          extractionError: r.extractionError,
        };
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** The wrapper marks the boundary between the user's own words and
 *  machine-generated description. */
export function attachmentBlock(a: ResolvedAttachment): string {
  const body =
    a.status === AttachmentStatus.READY && a.extractedText
      ? truncate(a.extractedText)
      : `(could not be read: ${a.extractionError ?? "extraction did not finish"})`;

  const kind = a.kind.toLowerCase();
  return `<attachment id="${a.id}" name="${escapeAttr(a.filename)}" kind="${kind}">\n${body}\n</attachment>`;
}

// `>` matters as much as `<` here: the model reads these tags as text, so an
// unescaped `>` in a filename closes the tag early and the rest reads as body.
// Exported for `visualContext.ts`, which emits a sibling tag into the same
// content array and needs exactly this rule, not a second opinion on it.
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
