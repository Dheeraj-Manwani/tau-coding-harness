import type Sandbox from "e2b";
import { asString, toWorkdirPath } from "./utils";
import { pageOf } from "./output";

/**
 * Read a file, a page at a time if it is long.
 *
 * A file that fits comes back whole as `{ content }`. A longer one comes back
 * as its first page with the line range and a note on how to read on —
 * see `pageOf` for the limits and for why the content carries no line numbers.
 */
export async function readFile(input: unknown, sandbox: Sandbox) {
  const { path, offset, limit } = input as {
    path?: unknown;
    offset?: unknown;
    limit?: unknown;
  };
  const p = asString(path, "path");
  const content = await sandbox.files.read(toWorkdirPath(p));
  return pageOf(content, { offset, limit });
}
