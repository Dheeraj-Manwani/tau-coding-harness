/**
 * The two files `enable_storage` writes into an app (doc/TAU_CLOUD_STORAGE.md
 * D7). They are real, typechecked source under `templates/storage/` and are read
 * as text, the way the visual-edit assets are: they ship into the generated app
 * and nothing in this service imports them.
 *
 * Like `addDatabase`'s files they are written at call time, so no sandbox image
 * rebuild is involved. They have no dependencies and nothing is installed.
 */
import { readFileSync } from "node:fs";

/** Where each helper lands in the app. */
export const STORAGE_SERVER_PATH = "server/storage.ts";
export const STORAGE_CLIENT_PATH = "src/lib/uploadFile.ts";

function asset(name: "server-storage.ts" | "upload-file.ts"): string {
  // Same bytes wherever the server runs, as the guides do.
  return readFileSync(new URL(`../templates/storage/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

export const STORAGE_SCAFFOLD: readonly { path: string; content: () => string }[] = [
  { path: STORAGE_SERVER_PATH, content: () => asset("server-storage.ts") },
  { path: STORAGE_CLIENT_PATH, content: () => asset("upload-file.ts") },
];
