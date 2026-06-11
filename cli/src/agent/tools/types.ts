/** A JSON-schema-ish description of a tool's input, in the shape both
 *  Anthropic and OpenAI expect (a plain JSON Schema object). */
export interface ToolSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** The agent's operating mode. */
export type AgentMode = "plan" | "build";

/** Outcome of a requested mode switch. */
export interface ModeSwitchResult {
  /** Whether the mode actually changed. */
  switched: boolean;
  /** The mode in effect after the request (unchanged if declined). */
  mode: AgentMode;
}

export interface ToolContext {
  /** Directory the agent treats as the project root. */
  cwd: string;
  /**
   * Optional guard run by mutating tools (write/edit) against the resolved
   * absolute target path before touching disk. It should throw a {@link
   * ToolError} to refuse the write. Used to confine plan mode to `tau/plans/`.
   */
  assertWritable?(absPath: string): void;
  /**
   * Request switching the agent to `target` mode. The implementation asks the
   * user to confirm and only changes mode if they accept. Resolves with the
   * outcome and the mode now in effect. `reason` is an optional user-facing
   * explanation shown alongside the confirmation prompt.
   */
  requestModeSwitch?(
    target: AgentMode,
    reason?: string,
  ): Promise<ModeSwitchResult>;
  /**
   * Ask the user `question` and resolve with their answer, or `null` if they
   * dismiss it (Ctrl+C / Esc). When `options` is given the user picks one (or
   * an "Other…" escape to type a reply); otherwise it's a free-text prompt. The
   * implementation owns the terminal — it pauses any live spinner so the prompt
   * renders cleanly, mirroring {@link requestModeSwitch}.
   */
  promptUser?(question: string, options?: string[]): Promise<string | null>;
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
