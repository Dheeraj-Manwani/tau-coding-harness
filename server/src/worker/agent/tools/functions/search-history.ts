import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ContextCheckpointReason } from "@/generated/prisma/enums";
import {
  MAX_HISTORY_MATCHES,
  NEIGHBOURS_EACH_SIDE,
  likePattern,
  queryTerms,
  toConversation,
  toMatches,
  type StoredRow,
} from "../../context/lookup";

/**
 * Rows fetched for a search before they are ordered and cut to what is shown.
 * More than are shown, because the newest matches are often files the agent
 * wrote and the message worth finding is behind them.
 */
const SEARCH_FETCH_LIMIT = 60;

/** The last message a "Clear chat" put out of reach; -1 when the chat was never cleared. */
async function clearFloor(projectId: string): Promise<number> {
  const row = await prisma.contextCheckpoint.findFirst({
    where: { projectId, reason: ContextCheckpointReason.MANUAL_CLEAR },
    orderBy: { upToSequence: "desc" },
    select: { upToSequence: true },
  });
  return row?.upToSequence ?? -1;
}

/**
 * `search_history`: find something in this project's stored conversation.
 *
 * See `context/lookup.ts` for what is searched and why. Read-only, scoped to
 * the one project, and bounded: a search returns at most a handful of
 * excerpts, a read around a message at most a handful of messages.
 */
export async function searchHistory(input: unknown, projectId: string) {
  const { query, around, from } = (input ?? {}) as {
    query?: unknown;
    around?: unknown;
    from?: unknown;
  };
  const floor = await clearFloor(projectId);

  if (typeof around === "number" && Number.isFinite(around)) {
    const rows = await prisma.message.findMany({
      where: {
        projectId,
        sequence: {
          gt: floor,
          gte: Math.round(around) - NEIGHBOURS_EACH_SIDE,
          lte: Math.round(around) + NEIGHBOURS_EACH_SIDE,
        },
      },
      orderBy: { sequence: "asc" },
      select: { sequence: true, role: true, type: true, content: true, createdAt: true },
    });
    if (rows.length === 0) {
      return { error: `There is no message ${Math.round(around)} in this project's history.` };
    }
    return { messages: toConversation(rows as StoredRow[], Math.round(around)) };
  }

  const terms = queryTerms(query);
  if (terms.length === 0) {
    return {
      error:
        "Give `query` (words to look for, at least two characters each) or `around` (a message number from an earlier search).",
    };
  }

  // Matched in the database, on the stored form of each message, so that a
  // long project is not read into memory to be searched. Tool results are left
  // out: they are most of the bytes and none of the conversation.
  const speaker =
    from === "user"
      ? Prisma.sql`AND "role"::text = 'USER' AND "type"::text = 'USER'`
      : from === "assistant"
        ? Prisma.sql`AND "role"::text = 'ASSISTANT'`
        : Prisma.empty;
  const containsAll = Prisma.join(
    terms.map((term) => Prisma.sql`"content"::text ILIKE ${likePattern(term)}`),
    " AND ",
  );
  const rows = await prisma.$queryRaw<StoredRow[]>`
    SELECT "sequence", "role"::text AS "role", "type"::text AS "type", "content", "createdAt"
    FROM "Message"
    WHERE "projectId" = ${projectId}
      AND "sequence" > ${floor}
      AND "type"::text <> 'TOOL_RES'
      ${speaker}
      AND ${containsAll}
    ORDER BY "sequence" DESC
    LIMIT ${SEARCH_FETCH_LIMIT}
  `;

  const matches = toMatches(rows, terms);
  if (matches.length === 0) {
    return {
      matches: [],
      note: `Nothing in this project's history contains ${terms.map((t) => `"${t}"`).join(" and ")}. Try fewer or different words — a message has to contain all of them.`,
    };
  }
  return {
    matches,
    ...(matches.length >= MAX_HISTORY_MATCHES && rows.length > matches.length
      ? { note: `Showing ${MAX_HISTORY_MATCHES} of at least ${rows.length} matches: messages where the words were said first, then files they appear in. Add a word to narrow it.` }
      : {}),
    hint: "Pass a match's `n` as `around` to read that message and the ones either side of it.",
  };
}
