import type { Tool } from "./types.ts";
import { ToolError } from "./types.ts";

/** Returned to the model when the user dismisses a prompt (Ctrl+C / Esc). */
const DISMISSED =
  "The user dismissed the question without answering. Proceed with your best " +
  "judgment, or stop and explain what you still need.";

export const promptUserTool: Tool = {
  name: "prompt_user",
  description:
    "Ask the user a clarifying question when the request is ambiguous or needs " +
    "information only they have, then continue with their answer. Prefer this " +
    "over guessing. Provide `options` for a multiple-choice question (the user " +
    "picks one, or types their own); omit it for a free-text answer. When you " +
    "pass `options`, they are shown to the user as a selectable menu — put ONLY " +
    "the question in `question` and do NOT also list the choices in its text " +
    "(e.g. no 'a) … b) …'), or they appear twice. Ask one focused question per " +
    "call.",
  mutating: false,
  schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The question to ask, by itself. Make it specific and self-contained. " +
          "Do not embed the answer choices here when you also pass `options`.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional multiple-choice answers, rendered as a selectable menu. Each " +
          "entry is one choice (an 'Other…' escape to type a reply is added " +
          "automatically). When given, omit the choices from `question`. Omit " +
          "this field entirely for a free-text answer.",
      },
    },
    required: ["question"],
  },
  summarize: (input) => `ask: ${input.question ?? "(question)"}`,

  async run(input, ctx) {
    const question = String(input.question ?? "").trim();
    if (!question) throw new ToolError("`question` must not be empty.");
    if (!ctx.promptUser) {
      throw new ToolError("Prompting the user is not available in this session.");
    }
    if (!process.stdin.isTTY) {
      throw new ToolError(
        "Cannot prompt the user: no interactive terminal is attached.",
      );
    }

    const options = normalizeOptions(input.options);
    const answer = await ctx.promptUser(question, options);
    if (answer === null) return DISMISSED;

    const text = answer.trim();
    return text.length > 0 ? text : "(the user submitted an empty answer)";
  },
};

/**
 * Coerce the model-supplied `options` into a clean, non-empty `string[]` — or
 * `undefined` to fall back to a free-text prompt. Tolerates a JSON-encoded
 * string, since models sometimes send the array that way.
 */
function normalizeOptions(raw: unknown): string[] | undefined {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(value)) return undefined;

  const cleaned = value.map((o) => String(o).trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}
