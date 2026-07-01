import type Sandbox from "e2b";
import { asString } from "./utils";

export async function readFile(input: unknown, sandbox: Sandbox) {
  const p = asString((input as { path?: unknown }).path, "path");
  const content = await sandbox.files.read(p);
  return { content };
}
