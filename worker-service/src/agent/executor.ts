import type { Sandbox } from "../lib/sandbox";

export interface ToolStubResult {
  stub: true;
}

export async function executeTool(
  name: string,
  input: unknown,
  sandbox: Sandbox,
): Promise<ToolStubResult> {
  void sandbox;
  console.log(`[executor] (stub) ${name}`, input);
  return { stub: true };
}
