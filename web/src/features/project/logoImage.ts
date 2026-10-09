/**
 * A logo, resized in the owner's browser.
 *
 * Tau's server takes two PNGs and needs no image library: a canvas draws
 * whatever the owner picked (a PNG, an SVG, a generated picture) and exports a
 * small favicon and a 512-pixel icon (doc/PUBLISHING.md D7). An uploaded SVG is
 * rasterised here and never sent, so it can never be served as a script.
 */

export const FAVICON_SIZE = 64;
export const ICON_SIZE = 512;
/** The server refuses a file over this; checked here first so the owner is told before saving. */
export const LOGO_MAX_BYTES = 300 * 1024;

/** What a picked file may be. A browser's `file.type` is a hint; the canvas decides. */
export const LOGO_ACCEPT = "image/png,image/svg+xml,image/jpeg,image/webp";

export interface LogoDraft {
  /** Base64 of the PNGs, with no `data:` prefix: the shape the API takes. */
  favicon: string;
  icon512: string;
  /** An object URL of the 512 picture, to show before anything is charged. */
  previewUrl: string;
  /** Set when the picture came from the generator: its fee is already paid. */
  generationId?: string;
}

/** Where to draw a source of this size so it fits a square without stretching, centred. */
export function containRect(
  width: number,
  height: number,
  size: number,
): { x: number; y: number; w: number; h: number } {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, w: size, h: size };
  const scale = Math.min(size / width, size / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (size - w) / 2, y: (size - h) / 2, w, h };
}

/** Base64 from bytes, in chunks: `String.fromCharCode(...bytes)` overflows the stack on a large file. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The base64 of a `data:` URI or of the payload itself. */
export function stripDataUri(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma !== -1 ? value.slice(comma + 1) : value;
}

/** Decoded size of a base64 string, without decoding it. */
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error("That file isn't a picture the browser can read.");
  }
  return img;
}

async function drawPng(img: HTMLImageElement, size: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize pictures.");
  ctx.imageSmoothingQuality = "high";
  // An SVG with no intrinsic size reports 0 by 0; draw it as a square.
  const { x, y, w, h } = containRect(img.naturalWidth || size, img.naturalHeight || size, size);
  ctx.drawImage(img, x, y, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The picture couldn't be exported.");
  return blob;
}

async function blobBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Turn a picture into the two PNGs the server stores.
 *
 * Throws a plain sentence when the file is not a picture or the result is too
 * detailed to fit the limit, so the panel can print it as it is.
 */
export async function logoFromSource(
  source: Blob | string,
  generationId?: string,
): Promise<LogoDraft> {
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const [small, large] = await Promise.all([
      drawPng(img, FAVICON_SIZE),
      drawPng(img, ICON_SIZE),
    ]);
    if (large.size > LOGO_MAX_BYTES) {
      throw new Error(
        `That picture is too detailed for an icon (${Math.round(large.size / 1024)} KB, the limit is ${LOGO_MAX_BYTES / 1024} KB). Try a simpler one.`,
      );
    }
    return {
      favicon: await blobBase64(small),
      icon512: await blobBase64(large),
      previewUrl: URL.createObjectURL(large),
      ...(generationId ? { generationId } : {}),
    };
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(url);
  }
}
