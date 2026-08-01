import type Sandbox from "e2b";
import { asString, toWorkdirPath } from "./utils";

export async function readFile(input: unknown, sandbox: Sandbox) {
  const p = asString((input as { path?: unknown }).path, "path");
  const content = await sandbox.files.read(toWorkdirPath(p));
  return { content };
}
