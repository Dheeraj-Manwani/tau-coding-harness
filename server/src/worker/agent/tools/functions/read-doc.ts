import { DOC_NAMES, guideText, isDocName } from "../../docs";

/**
 * `read_doc`: hand the agent one of tau's guides because it asked.
 *
 * The third and least dependable of the three ways a guide arrives (see
 * `docs/index.ts`), and the only one for a guide with nothing to trigger it —
 * `github`, say, which matters before the first push rather than after it.
 * Needs no sandbox: the guides ship with tau's own source.
 *
 * Always returns the guide, even when it is already in the conversation. Being
 * asked twice is a signal the agent has lost track of it, and a second copy
 * close to where it is working costs less than a wrong guess.
 */
export function readDocTool(input: unknown) {
  const { name } = (input ?? {}) as { name?: unknown };
  if (!isDocName(name)) {
    return {
      error: `There is no guide named ${JSON.stringify(name ?? null)}. The guides are: ${DOC_NAMES.join(", ")}.`,
    };
  }
  return { name, guide: guideText(name) };
}
