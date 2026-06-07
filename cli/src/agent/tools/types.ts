/** A JSON-schema-ish description of a tool's input, in the shape both
 *  Anthropic and OpenAI expect (a plain JSON Schema object). */
export interface ToolSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolContext {
  /** Directory the agent treats as the project root. */
  cwd: string;
}

export interface Tool {
  name: string;
  description: string;
  schema: ToolSchema;
  /** Whether this tool mutates the filesystem / runs commands. Read-only
   *  tools stay enabled in plan mode. */
  mutating: boolean;
  /** One-line summary of a call, shown before it runs. */
  summarize(input: any): string;
  /** Execute the tool, returning text to feed back to the model. */
  run(input: any, ctx: ToolContext): Promise<string>;
}

/** Thrown by a tool to surface a clean, model-readable error. */
export class ToolError extends Error {}
