import { asString } from "./utils";

const TIMEOUT_MS = 12_000;
// Enough to cover the header of any common format — JPEG's SOF marker can sit a
// little way in, but well within this. We never buffer the whole (possibly
// multi-MB) image just to read its width and height.
const HEADER_CAP_BYTES = 256 * 1024;

interface ImageMeta {
  width: number;
  height: number;
  format: string;
}

/** Read only the leading bytes of the response, so a huge image doesn't get
 *  fully buffered just to parse a header. Stops early once the cap is hit. */
async function readHeader(
  res: Response,
  cap: number,
): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.from(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks);
}

function parsePng(buf: Buffer): ImageMeta | null {
  // 8-byte signature, then an IHDR chunk whose width/height are big-endian
  // uint32 at offsets 16 and 20.
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    format: "png",
  };
}

function parseGif(buf: Buffer): ImageMeta | null {
  // "GIF87a" / "GIF89a", then width/height as little-endian uint16 at 6 and 8.
  if (buf.length < 10) return null;
  if (buf.toString("ascii", 0, 3) !== "GIF") return null;
  return {
    width: buf.readUInt16LE(6),
    height: buf.readUInt16LE(8),
    format: "gif",
  };
}

function parseJpeg(buf: Buffer): ImageMeta | null {
  // Starts with FFD8. Walk the marker segments until a Start-Of-Frame (SOFn),
  // whose payload is [precision(1)][height(2 BE)][width(2 BE)].
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1]!;
    // SOF0..SOF15, excluding DHT(C4), JPG(C8), DAC(CC) which aren't frames.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
        format: "jpeg",
      };
    }
    // Skip this segment: 2-byte marker + 2-byte length that covers the payload.
    const segLen = buf.readUInt16BE(offset + 2);
    if (segLen < 2) return null;
    offset += 2 + segLen;
  }
  return null;
}

function parseWebp(buf: Buffer): ImageMeta | null {
  // RIFF container: "RIFF"...."WEBP", then a chunk of type VP8 / VP8L / VP8X.
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);

  if (chunk === "VP8X") {
    // Extended: 24-bit little-endian (value - 1) for width and height at 24/27.
    const width = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
    const height = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
    return { width, height, format: "webp" };
  }
  if (chunk === "VP8 ") {
    // Lossy: 14-bit dimensions in the frame header after the start code at 26.
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height, format: "webp" };
  }
  if (chunk === "VP8L") {
    // Lossless: 14-bit (value - 1) dimensions packed from byte 21 onward.
    const b = buf;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >> 14) & 0x3fff);
    return { width, height, format: "webp" };
  }
  return null;
}

function parseImageMeta(buf: Buffer): ImageMeta | null {
  return (
    parsePng(buf) ??
    parseGif(buf) ??
    parseJpeg(buf) ??
    parseWebp(buf) ??
    null
  );
}

/**
 * Return `{ width, height, format, fileSize }` for an image URL — no AI, no
 * sandbox, and without downloading the whole file (only the header is read).
 * Lets the agent confirm an asset is high-resolution enough for a fullscreen
 * hero/parallax before committing to it. `fileSize` comes from the
 * Content-Length header when the server sends one, else null.
 */
export async function imageDimensions(input: unknown) {
  const { url } = input as { url?: unknown };
  const target = asString(url, "url");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      headers: { Accept: "image/*" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { error: `Could not fetch image (${res.status})` };
    }

    const contentLength = res.headers.get("content-length");
    const fileSize = contentLength ? Number(contentLength) : null;

    const header = await readHeader(res, HEADER_CAP_BYTES);
    const meta = parseImageMeta(header);
    if (!meta) {
      const contentType = res.headers.get("content-type") ?? "unknown";
      return {
        error: `Unrecognized or unsupported image format (content-type: ${contentType}). Supported: png, jpeg, gif, webp.`,
      };
    }

    return {
      width: meta.width,
      height: meta.height,
      format: meta.format,
      fileSize: Number.isFinite(fileSize) ? fileSize : null,
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Image fetch timed out after ${TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return { error: message };
  } finally {
    clearTimeout(timeout);
  }
}
