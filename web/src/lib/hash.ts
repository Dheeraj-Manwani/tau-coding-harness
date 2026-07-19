/**
 * SHA-256 of a UTF-8 string, hex-encoded.
 *
 * Must agree byte-for-byte with the server's `sha256Hex` (api/src/lib/projectFiles.ts
 * and the worker's equivalent) — the value is sent back as `baseHash` to decide
 * whether a file moved underneath the editor.
 *
 * `crypto.subtle` needs a secure context; that's satisfied by https in prod and
 * by localhost in dev.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
