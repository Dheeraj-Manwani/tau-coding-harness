import { useMutation } from "@tanstack/react-query";

import { api } from "@/src/lib/api-client";

/**
 * Whether the instructions someone has written contradict each other.
 *
 * Asked of the server after a save (`POST /account/instructions/check`), which
 * reads them with a model. It is advice: the save has already happened, a wrong
 * answer costs a line of text the user can ignore, and a failed check shows
 * nothing at all.
 */
export interface InstructionConflict {
  a: string;
  b: string;
  note: string;
  /** One line is the account's and one the project's: the project wins. */
  overrides: boolean;
}

export function useCheckInstructions() {
  return useMutation({
    mutationFn: (input: { account?: string; project?: string }) =>
      api
        .post<{ conflicts: InstructionConflict[] }>("/account/instructions/check", input)
        .then((r) => r.data.conflicts),
  });
}

/** What to say about a conflict, for a toast where there is no room for the list. */
export function conflictSummary(conflicts: readonly InstructionConflict[]): string | null {
  const first = conflicts[0];
  if (!first) return null;
  const more = conflicts.length > 1 ? ` (and ${conflicts.length - 1} more)` : "";
  return first.overrides
    ? `This project's instructions replace one of your account's: ${first.note}${more}`
    : `Two of your instructions disagree: ${first.note}${more}`;
}
