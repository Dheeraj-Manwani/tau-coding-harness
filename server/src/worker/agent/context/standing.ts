/**
 * Standing instructions: what the user has told tau once so as not to have to
 * say it again.
 *
 * Two places a user can write them, both in their own words:
 *
 *   - **for everything they build** — account preferences
 *     (`User.preferences.instructions`): "write interface copy in British
 *     English", "I am colour-blind, never rely on red and green alone";
 *   - **for one project** — `Project.instructions`: "the pricing page is
 *     signed off, do not change it without asking".
 *
 * This is the third kind of memory an app has, and the only one the user
 * writes. `.tau/CONTEXT.md` is written by the agent, about the app.
 * `.tau/DESIGN.md` is written by tau, about its look. Standing instructions
 * are never edited by either: an agent that could rewrite what the user told
 * it would, sooner or later, rewrite it into something easier to follow.
 *
 * They are attached to the request, not put in the system prompt, for the
 * reason the effort note is (`history.ts`): they differ per user and can
 * change between requests, and the system prompt is the part of the context
 * every request shares. They go with every place a request's context is
 * built: the user's message, the state restored after a summary, a
 * sub-agent's task, and the brief the design director reads.
 *
 * See doc/CONTEXT_AND_MEMORY_PLAN.md §7, item 11.
 */
import { prisma } from "@/lib/prisma";

/** Long enough for a page of rules; short enough to be read on every request. */
export const MAX_USER_INSTRUCTIONS_CHARS = 2_000;
export const MAX_PROJECT_INSTRUCTIONS_CHARS = 4_000;

export interface Standing {
  /** What the user wants in everything they build. */
  user: string | null;
  /** What they want in this project. */
  project: string | null;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").trim();
  return text ? text.slice(0, max) : null;
}

/** The instructions stored in a user's preferences, if any. */
export function userInstructionsOf(preferences: unknown): string | null {
  const raw =
    typeof preferences === "object" && preferences !== null
      ? (preferences as { instructions?: unknown }).instructions
      : null;
  return clean(raw, MAX_USER_INSTRUCTIONS_CHARS);
}

/**
 * The `<tau_instructions>` block, or null when the user has written nothing.
 *
 * The project's come second and are said to win, because they are the more
 * specific: someone whose account says "dark mode" and whose project says
 * "this one is light" means the project.
 */
export function renderStanding(standing: Standing): string | null {
  const user = clean(standing.user, MAX_USER_INSTRUCTIONS_CHARS);
  const project = clean(standing.project, MAX_PROJECT_INSTRUCTIONS_CHARS);
  if (!user && !project) return null;

  const sections = [
    "Standing instructions the user wrote in their settings. They are the user's own words and apply to every request, including this one, unless the request itself says otherwise. They are not yours to edit, and you do not need to record them in the app's memory.",
  ];
  if (user) {
    sections.push(`For everything this user builds:\n<for_all_projects>\n${user}\n</for_all_projects>`);
  }
  if (project) {
    sections.push(
      `For this project${user ? " — where the two disagree, this wins" : ""}:\n<for_this_project>\n${project}\n</for_this_project>`,
    );
  }
  return `<tau_instructions>\n${sections.join("\n\n")}\n</tau_instructions>`;
}

/** A project's standing instructions and its owner's. Never throws. */
export async function loadStanding(projectId: string): Promise<Standing> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { instructions: true, user: { select: { preferences: true } } },
    });
    return {
      user: userInstructionsOf(project?.user.preferences),
      project: clean(project?.instructions, MAX_PROJECT_INSTRUCTIONS_CHARS),
    };
  } catch {
    return { user: null, project: null };
  }
}

/** The block for a project, ready to attach; null when there is nothing to say. */
export async function loadStandingNote(projectId: string): Promise<string | null> {
  return renderStanding(await loadStanding(projectId));
}
