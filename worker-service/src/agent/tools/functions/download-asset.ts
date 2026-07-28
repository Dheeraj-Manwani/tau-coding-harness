import type Sandbox from "e2b";
import {
  asString,
  chunkString,
  CHUNK_SIZE,
  isBinaryPath,
  persistBinaryFile,
  persistFile,
  SECRET_NOT_PERSISTED_WARNING,
  toRelativePath,
  toWorkdirPath,
} from "./utils";
import { publish } from "@/lib/publish";

const TIMEOUT_MS = 30_000;
// Guard against a runaway download filling the sandbox / a huge hero video.
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Download a remote asset (image, font, media) INTO the project so it survives.
 *
 * This is the durable alternative to `run_command("curl -o …")`: a curl'd file
 * lives only in the ephemeral sandbox and is lost the next time the sandbox
 * rehydrates (it never reaches R2 or the manifest). This tool fetches the bytes
 * in the worker, writes them to the sandbox, AND persists them as a binary blob
 * — so the asset shows in the file tree, reloads with the project, and pushes to
 * GitHub. Pair it with `search_images` (find the URL) + `image_dimensions`
 * (check resolution). Requires a provisioned sandbox.
 */
export async function downloadAsset(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  const { url, path } = input as { url?: unknown; path?: unknown };
  const src = asString(url, "url");
  const dest = asString(path, "path");
  const relPath = toRelativePath(dest);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(src, {
      headers: { Accept: "*/*" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { error: `Download failed (${res.status}) for ${src}` };
    }

    const arrayBuf = await res.arrayBuffer();
    const buf = new Uint8Array(arrayBuf);
    if (buf.byteLength === 0) {
      return { error: "Downloaded file was empty." };
    }
    if (buf.byteLength > MAX_BYTES) {
      return {
        error: `Asset is too large (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB, limit ${MAX_BYTES / 1024 / 1024} MB). Pick a smaller image.`,
      };
    }

    // Surface the write in the file tree immediately. e2b's write takes an
    // ArrayBuffer.
    await publish(jobId, { type: "file_start", path: relPath });
    await sandbox.files.write(toWorkdirPath(dest), arrayBuf);

    // Persist through the matching pipeline: bytes for binary assets (the common
    // case), UTF-8 text for a text asset saved with a text extension (e.g. .svg).
    let persisted: boolean;
    if (isBinaryPath(relPath)) {
      // No content stream — binary isn't rendered in the text editor.
      ({ persisted } = await persistBinaryFile(
        jobId,
        projectId,
        userId,
        relPath,
        buf,
        indexer,
      ));
    } else {
      const text = new TextDecoder().decode(buf);
      // Stream the text so it shows in the editor this session, like create_file.
      for (const chunk of chunkString(text, CHUNK_SIZE)) {
        await publish(jobId, {
          type: "file_chunk",
          path: relPath,
          content: chunk,
        });
      }
      ({ persisted } = await persistFile(
        jobId,
        projectId,
        userId,
        relPath,
        text,
        indexer,
      ));
    }

    return {
      success: true,
      path: dest,
      bytes: buf.byteLength,
      contentType: res.headers.get("content-type") ?? null,
      ...(persisted ? {} : { persisted, warning: SECRET_NOT_PERSISTED_WARNING }),
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Download timed out after ${TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return { error: message };
  } finally {
    clearTimeout(timeout);
  }
}
