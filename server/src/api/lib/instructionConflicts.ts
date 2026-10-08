import { clientForModel } from "@/lib/kimi";
import { env } from "@/lib/env";
import { log } from "@/worker/lib/log";

/**
 * Whether what someone has told tau to always do contradicts itself.
 *
 * Standing instructions are free text the user writes once and tau reads with
 * every request. Nothing reads them back to the user. "I prefer dark
 * interfaces" in the account and "light, airy pages" in a project are both
 * obeyed as far as the agent can, and the app that results pleases neither
 * line. The agent is told the project's instructions win over the account's
 * (`context/standing.ts`); that settles which line it follows, and says nothing
 * to the person who wrote both.
 *
 * So after instructions are saved, one cheap model call reads them and says so
 * when two lines cannot both be followed. It is advice shown beside the box and
 * never a reason to refuse a save: the model can be wrong, and the words are
 * the user's.
 */

export interface InstructionConflict {
  /** The two lines that disagree, quoted. */
  a: string;
  b: string;
  /** In one sentence, what cannot be both. */
  note: string;
  /**
   * The lines are one in the account's and one in the project's, which tau
   * settles by letting the project win. Said as information, not as a fault.
   */
  overrides: boolean;
}

const TIMEOUT_MS = 15_000;
/** Instructions shorter than this cannot contradict themselves. */
const MIN_WORDS = 6;
const MAX_CONFLICTS = 4;

export function conflictPrompt(): string {
  return `You read standing instructions that a person has written for an app-building assistant, and say where two of them cannot both be followed.

There are up to two lists: ACCOUNT, which applies to everything they build, and PROJECT, which applies to one app and takes priority over the account where they disagree.

Two lines conflict when following one means breaking the other: "always use dark mode" and "light, airy pages"; "never use gradients" and "give headings a gradient". Lines that merely differ in topic, that can both be followed, or that are a general rule and a specific exception ("no animation" and "a spinner while loading") do not conflict. Be conservative: when unsure, say nothing.

Reply with one JSON object and nothing else:
{"conflicts": [{"a": "<the first line, quoted as written>", "b": "<the second line, quoted as written>", "note": "<one short sentence on what cannot be both>", "overrides": <true if one line is from ACCOUNT and the other from PROJECT, false if both are from the same list>}]}

An empty list is the usual answer: {"conflicts": []}.`;
}

function quote(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

/** The model's reply as conflicts; anything unusable is dropped, and no reply is none. */
export function parseConflicts(text: string): InstructionConflict[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let raw: { conflicts?: unknown };
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as { conflicts?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(raw.conflicts)) return [];
  const out: InstructionConflict[] = [];
  for (const item of raw.conflicts) {
    if (!item || typeof item !== "object") continue;
    const { a, b, note, overrides } = item as Record<string, unknown>;
    const first = quote(a);
    const second = quote(b);
    const why = quote(note);
    if (!first || !second || !why || first === second) continue;
    out.push({ a: first, b: second, note: why, overrides: overrides === true });
    if (out.length >= MAX_CONFLICTS) break;
  }
  return out;
}

/** The text the model reads: the two lists, labelled. */
export function conflictInput(input: { account?: string; project?: string }): string {
  return [
    input.account?.trim() ? `ACCOUNT:\n${input.account.trim()}` : "",
    input.project?.trim() ? `PROJECT:\n${input.project.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The places instructions disagree, or none. Never throws, and gives up after
 * `TIMEOUT_MS`: a save must not wait on advice.
 */
export async function findConflicts(input: { account?: string; project?: string }): Promise<InstructionConflict[]> {
  const text = conflictInput(input);
  if (text.split(/\s+/).filter(Boolean).length < MIN_WORDS) return [];
  const model = env.DEEPSEEK_MODEL_FLASH;
  try {
    const completion = await clientForModel(model).chat.completions.create(
      {
        model,
        max_tokens: 500,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: conflictPrompt() },
          { role: "user", content: text },
        ],
        // Left on, the model can spend the whole limit thinking and answer nothing.
        ...({ thinking: { type: "disabled" } } as object),
      },
      { timeout: TIMEOUT_MS, maxRetries: 0 },
    );
    return parseConflicts(completion.choices[0]?.message.content ?? "");
  } catch (err) {
    log.warn("instructions.conflicts.failed", { error: String(err).slice(0, 200) });
    return [];
  }
}
