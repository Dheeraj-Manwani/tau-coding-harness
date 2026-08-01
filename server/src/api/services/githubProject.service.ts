import * as projectRepo from "../repositories/project.repository";
import { Errors } from "../lib/errors";
import {
  getGithubProjectInfo,
  pushProjectToGithub,
  linkExistingRepo,
  unlinkRepo,
  listUserRepos,
  setRepoVisibility,
  setPushMode,
  type PushMode,
} from "../lib/github";

async function assertOwner(projectId: string, userId: string): Promise<void> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) {
    throw Errors.forbidden("You do not have access to this project");
  }
}

function unwrap<T>(result: T | { error: string }): T {
  if (result && typeof result === "object" && "error" in result) {
    throw Errors.badRequest((result as { error: string }).error);
  }
  return result as T;
}

export async function getInfo(projectId: string, userId: string) {
  await assertOwner(projectId, userId);
  return getGithubProjectInfo(projectId, userId);
}

export async function push(
  projectId: string,
  userId: string,
  opts: { title?: string; description?: string; mode?: PushMode },
) {
  await assertOwner(projectId, userId);
  const result = await pushProjectToGithub(projectId, userId, {
    title: opts.title ?? "",
    body: opts.description ?? "",
    mode: opts.mode,
  });
  return unwrap(result);
}

export async function link(projectId: string, userId: string, repo: string) {
  await assertOwner(projectId, userId);
  return unwrap(await linkExistingRepo(projectId, userId, repo));
}

export async function unlink(projectId: string, userId: string) {
  await assertOwner(projectId, userId);
  await unlinkRepo(projectId, userId);
}

export async function repos(projectId: string, userId: string) {
  await assertOwner(projectId, userId);
  return unwrap(await listUserRepos(userId));
}

export async function patch(
  projectId: string,
  userId: string,
  changes: { private?: boolean; pushMode?: PushMode },
) {
  await assertOwner(projectId, userId);
  if (changes.pushMode) {
    await setPushMode(projectId, userId, changes.pushMode);
  }
  if (changes.private !== undefined) {
    return unwrap(await setRepoVisibility(projectId, userId, changes.private));
  }
  return { ok: true };
}
