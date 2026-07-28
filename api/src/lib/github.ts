import ignore from "ignore";
import { prisma } from "./prisma";
import { getBlob, getBlobText } from "./s3";
import { isBinaryPath, isSecretPath } from "./projectFiles";

/**
 * Server-side git engine. We never run `git` in the sandbox — instead we build
 * commits directly against GitHub's REST API (git blobs/trees/commits/refs)
 *
 * The commit content is the stored `ProjectFile` set (the same source of truth
 * `rehydrateSandbox` reads from), so pushing works whether or not a sandbox is
 * awake, and the token never leaves this process.
 *
 * This module is intentionally duplicated in `api/src/lib/github.ts` so the api
 * (one-click push button + GitHub panel) and the worker (agent tool) can each
 * drive GitHub without a cross-package import. Keep the two copies in sync.
 */

const GITHUB_API = "https://api.github.com";
const PROVIDER = "github";
const USER_AGENT = "tau-app";
const GIT_FILE_MODE = "100644"; // normal file blob

export type PushMode = "new_pr" | "update_pr" | "direct";
export const PUSH_MODES: PushMode[] = ["new_pr", "update_pr", "direct"];

export function isPushMode(v: unknown): v is PushMode {
  return typeof v === "string" && (PUSH_MODES as string[]).includes(v);
}

export interface PushResult {
  repoUrl: string;
  /** Present for new_pr / update_pr; absent for a direct commit. */
  prUrl?: string;
  branch: string;
  mode: PushMode;
  /** Markdown shown in the chat UI; also readable by the model. */
  summary: string;
}

export interface PushError {
  error: string;
}

export interface RepoSummary {
  fullName: string;
  htmlUrl: string;
  visibility: "private" | "public";
  defaultBranch: string;
}

export interface PrSummary {
  url: string;
  number: number;
  title: string;
  state: string; // "open" | "closed"
  merged?: boolean;
}

export interface GithubProjectInfo {
  connected: boolean;
  username: string | null;
  repo: RepoSummary | null;
  lastPr: PrSummary | null;
  openPrs: PrSummary[];
  /** Rough "changes since last push" — headSequence minus last-pushed sequence. */
  unpushedChanges: number;
  pushMode: PushMode;
}

/**
 * Cache of contentHash → blob sha, keyed per repo, so files whose content hasn't
 * changed since a previous push are not re-uploaded. Lives for the worker
 * process lifetime, which is enough to short-circuit repeated pushes of a repo.
 */
const blobShaCache = new Map<string, string>();

class GithubApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`GitHub API ${status}: ${body}`);
    this.name = "GithubApiError";
  }
}

/** Thin authenticated fetch wrapper around the GitHub REST API. */
async function gh<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    throw new GithubApiError(res.status, await res.text().catch(() => ""));
  }
  // 204 No Content and empty bodies.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The stored GitHub token for a user, or null if not connected. */
async function resolveToken(userId: string): Promise<string | null> {
  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: PROVIDER },
  });
  return account?.accessToken ?? null;
}

/** Drop the stored link so the UI re-prompts a reconnect (token revoked). */
async function dropConnection(userId: string): Promise<void> {
  await prisma.oAuthAccount
    .deleteMany({ where: { userId, provider: PROVIDER } })
    .catch(() => {});
}

interface GithubUser {
  id: number;
  login: string;
}

/** Look up the account behind a token. Returns null on 401 (revoked/invalid). */
async function fetchGithubUser(token: string): Promise<GithubUser | null> {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const data = (await res.json()) as GithubUser;
  return { id: data.id, login: data.login };
}

/** Turn a project name into a valid, collision-resistant GitHub repo slug. */
function slugifyRepoName(name: string): string {
  const slug = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || "tau-project";
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * A readable, git-safe branch name derived from the push title, e.g.
 * "Add checkout flow" -> "tau/add-checkout-flow-a1b2c3". Used as the fallback
 * when no explicit branch is supplied; the short suffix keeps successive pushes
 * from colliding on the same ref.
 */
function newBranchName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `tau/${slug || "update"}-${shortId()}`;
}

/**
 * Turn a caller-supplied (agent-chosen) branch name into a git-safe ref.
 * Namespaces under `tau/` unless the caller already used a namespace, and keeps
 * the name intact (no random suffix) so the branch reads exactly as intended —
 * collisions are handled at ref-creation time by {@link createBranchRef}.
 */
function sanitizeBranchName(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60)
    .replace(/[-/]+$/g, "");
  if (!s) return `tau/update-${shortId()}`;
  return s.includes("/") ? s : `tau/${s}`;
}

/**
 * Create a branch ref at `sha`, falling back to a suffixed name if the branch
 * already exists (422), so an agent reusing the same branch name still pushes.
 * Returns the branch name actually created.
 */
async function createBranchRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<string> {
  try {
    await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });
    return branch;
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 422) {
      const alt = `${branch}-${shortId()}`;
      await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
        ref: `refs/heads/${alt}`,
        sha,
      });
      return alt;
    }
    throw err;
  }
}

interface RepoInfo {
  fullName: string; // "owner/repo"
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch: string;
  visibility: "private" | "public";
}

interface GithubRepoResponse {
  full_name: string;
  name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  owner: { login: string };
}

function toRepoInfo(r: GithubRepoResponse): RepoInfo {
  return {
    fullName: r.full_name,
    owner: r.owner.login,
    repo: r.name,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch || "main",
    visibility: r.private ? "private" : "public",
  };
}

interface GithubPrResponse {
  html_url: string;
  number: number;
  title: string;
  state: string;
  merged?: boolean;
  merged_at?: string | null;
}

function toPrSummary(p: GithubPrResponse): PrSummary {
  return {
    url: p.html_url,
    number: p.number,
    title: p.title,
    state: p.state,
    merged: p.merged ?? Boolean(p.merged_at),
  };
}

/** Persist the cached repo facts on the project row after a lookup/link. */
async function cacheRepoFacts(
  projectId: string,
  repo: RepoInfo,
): Promise<void> {
  await prisma.project
    .update({
      where: { id: projectId },
      data: {
        githubRepo: repo.fullName,
        githubDefaultBranch: repo.defaultBranch,
        githubVisibility: repo.visibility,
      },
    })
    .catch(() => {});
}

/** Look up an existing linked repo, or create a fresh private one (auto-init'd). */
async function ensureRepo(
  token: string,
  project: { id: string; name: string; githubRepo: string | null },
  description: string,
): Promise<RepoInfo> {
  if (project.githubRepo) {
    const [owner, repo] = project.githubRepo.split("/");
    const existing = await gh<GithubRepoResponse>(
      token,
      "GET",
      `/repos/${owner}/${repo}`,
    );
    return toRepoInfo(existing);
  }

  // auto_init gives us an initial commit + default branch to PR into.
  const base = slugifyRepoName(project.name);
  let lastErr: unknown;
  for (const candidate of [
    base,
    `${base}-${shortId()}`,
    `${base}-${shortId()}`,
  ]) {
    try {
      const created = await gh<GithubRepoResponse>(
        token,
        "POST",
        `/user/repos`,
        {
          name: candidate,
          description: description.slice(0, 350),
          private: true,
          auto_init: true,
        },
      );
      const info = toRepoInfo(created);
      await cacheRepoFacts(project.id, info);
      return info;
    } catch (err) {
      // 422 = name already taken (or invalid); try the next candidate.
      if (err instanceof GithubApiError && err.status === 422) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Could not create a GitHub repository");
}

/** Upload one file's content as a git blob, reusing a cached sha when possible. */
async function uploadBlob(
  token: string,
  fullName: string,
  contentHash: string,
  content: string,
  encoding: "utf-8" | "base64" = "utf-8",
): Promise<string> {
  const cacheKey = `${fullName}:${contentHash}`;
  const cached = blobShaCache.get(cacheKey);
  if (cached) return cached;

  const [owner, repo] = fullName.split("/");
  const blob = await gh<{ sha: string }>(
    token,
    "POST",
    `/repos/${owner}/${repo}/git/blobs`,
    { content, encoding },
  );
  blobShaCache.set(cacheKey, blob.sha);
  // Bound the cache so a long-lived process can't grow it without limit.
  if (blobShaCache.size > 5000) {
    const firstKey = blobShaCache.keys().next().value;
    if (firstKey) blobShaCache.delete(firstKey);
  }
  return blob.sha;
}

/** Read the tip sha of a branch, tolerating the brief post-auto-init 404 window. */
async function getHeadShaWithRetry(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const ref = await gh<{ object: { sha: string } }>(
        token,
        "GET",
        `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
      );
      return ref.object.sha;
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 404) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`Branch ${branch} not found`);
}

/** Open a PR, reusing an existing one for the same head branch if present. */
async function ensurePullRequest(
  token: string,
  repo: RepoInfo,
  branch: string,
  title: string,
  body: string,
  existingNumber?: number | null,
): Promise<PrSummary> {
  const { owner, repo: repoName, defaultBranch } = repo;

  // Reuse a still-open PR we opened earlier for this branch.
  if (existingNumber) {
    try {
      const pr = await gh<GithubPrResponse>(
        token,
        "GET",
        `/repos/${owner}/${repoName}/pulls/${existingNumber}`,
      );
      if (pr.state === "open") return toPrSummary(pr);
    } catch {
      // fall through to open a fresh PR
    }
  }

  try {
    const pr = await gh<GithubPrResponse>(
      token,
      "POST",
      `/repos/${owner}/${repoName}/pulls`,
      { title, head: branch, base: defaultBranch, body },
    );
    return toPrSummary(pr);
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 422) {
      // A PR already exists for this head — return the existing one.
      const existing = await gh<GithubPrResponse[]>(
        token,
        "GET",
        `/repos/${owner}/${repoName}/pulls?head=${owner}:${branch}&state=open`,
      );
      if (existing[0]) return toPrSummary(existing[0]);
    }
    throw err;
  }
}

/**
 * Drop everything that must not be committed: credential-shaped paths
 * unconditionally, then whatever the project's own `.gitignore` excludes.
 *
 * Order matters. `isSecretPath` is the floor and runs first, so a project whose
 * `.gitignore` was deleted or rewritten by the agent still cannot publish keys.
 * The `.gitignore` pass on top is what stops us committing build output and
 * PGlite's on-disk `data/` directory, both of which the templates ignore and we
 * were previously pushing anyway.
 *
 * Only the root `.gitignore` is read. Real git also honors per-directory ones,
 * but no template writes any and the floor covers the case that matters.
 */
export async function filterPushableFiles<
  T extends { path: string; contentHash: string },
>(userId: string, projectId: string, files: T[]): Promise<T[]> {
  const safe = files.filter((f) => !isSecretPath(f.path));

  const gitignore = safe.find((f) => f.path === ".gitignore");
  if (!gitignore) return safe;

  let patterns: string;
  try {
    patterns = await getBlobText(userId, projectId, gitignore.contentHash);
  } catch {
    // A missing blob must not turn into "push everything" — the floor already
    // applied, and skipping the .gitignore pass only over-includes noise.
    return safe;
  }

  const matcher = ignore().add(patterns);
  // `.gitignore` itself is committed by convention; `ignore` would happily let
  // a pattern exclude it, but git only ignores untracked files and this one is
  // always tracked in a real repo.
  return safe.filter(
    (f) => f.path === ".gitignore" || !matcher.ignores(f.path),
  );
}

/** Build a git tree of the project's files, uploading each body as a blob. */
async function buildProjectTree(
  token: string,
  fullName: string,
  userId: string,
  projectId: string,
  files: { path: string; contentHash: string }[],
): Promise<{ path: string; mode: string; type: "blob"; sha: string }[]> {
  return Promise.all(
    files.map(async ({ path, contentHash }) => {
      // Binary assets must be committed as base64 — GitHub's blob API corrupts
      // them under utf-8, the same way our own text pipeline would.
      if (isBinaryPath(path)) {
        const bytes = await getBlob(userId, projectId, contentHash);
        const content = Buffer.from(bytes).toString("base64");
        const sha = await uploadBlob(
          token,
          fullName,
          contentHash,
          content,
          "base64",
        );
        return { path, mode: GIT_FILE_MODE, type: "blob" as const, sha };
      }
      const content = await getBlobText(userId, projectId, contentHash);
      const sha = await uploadBlob(token, fullName, contentHash, content);
      return { path, mode: GIT_FILE_MODE, type: "blob" as const, sha };
    }),
  );
}

/**
 * Build a commit from the project's stored files and, depending on `mode`,
 * either open/update a PR from a `tau/*` branch or commit straight to the
 * default branch.
 *
 * Returns a structured error (never throws for expected conditions like "not
 * connected" or "no files") so the agent tool / api can surface it to the user.
 */
export async function pushProjectToGithub(
  projectId: string,
  userId: string,
  opts: { title: string; body: string; mode?: PushMode; branch?: string },
): Promise<PushResult | PushError> {
  const token = await resolveToken(userId);
  if (!token) {
    return {
      error:
        "GitHub is not connected. Ask the user to click the GitHub button on the project page to connect their account first.",
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      githubRepo: true,
      githubPushMode: true,
      headSequence: true,
      lastPushedBranch: true,
      lastPrNumber: true,
    },
  });
  if (!project) return { error: "Project not found" };

  const allFiles = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, contentHash: true },
    orderBy: { path: "asc" },
  });
  if (allFiles.length === 0) {
    return { error: "The project has no files to push yet." };
  }

  const files = await filterPushableFiles(userId, projectId, allFiles);
  if (files.length === 0) {
    return {
      error:
        "Every file in this project is excluded by .gitignore, so there is nothing to commit.",
    };
  }

  const mode: PushMode =
    opts.mode ??
    (isPushMode(project.githubPushMode) ? project.githubPushMode : "new_pr");
  const title = opts.title.trim() || "Update from Tau";
  const body = opts.body.trim() || "Automated update pushed from Tau.";

  try {
    const repo = await ensureRepo(token, project, title);
    const { owner, repo: repoName, fullName, defaultBranch } = repo;

    const tree = await buildProjectTree(
      token,
      fullName,
      userId,
      projectId,
      files,
    );

    // Decide the branch we build the commit onto and its parent.
    let branch: string;
    let parentSha: string;
    let isNewBranch = false;

    const canUpdateBranch =
      mode === "update_pr" &&
      project.lastPushedBranch &&
      project.lastPushedBranch !== defaultBranch;

    if (mode === "direct") {
      branch = defaultBranch;
      parentSha = await getHeadShaWithRetry(token, owner, repoName, branch);
    } else if (canUpdateBranch) {
      branch = project.lastPushedBranch as string;
      try {
        parentSha = await getHeadShaWithRetry(token, owner, repoName, branch);
      } catch {
        // The old branch is gone (merged/deleted) — start a fresh one.
        branch = opts.branch
          ? sanitizeBranchName(opts.branch)
          : newBranchName(title);
        parentSha = await getHeadShaWithRetry(
          token,
          owner,
          repoName,
          defaultBranch,
        );
        isNewBranch = true;
      }
    } else {
      // Prefer the caller-supplied (agent-chosen) branch; else derive from title.
      branch = opts.branch
        ? sanitizeBranchName(opts.branch)
        : newBranchName(title);
      parentSha = await getHeadShaWithRetry(
        token,
        owner,
        repoName,
        defaultBranch,
      );
      isNewBranch = true;
    }

    // A full tree (no base_tree) == exactly the project's files.
    const treeRes = await gh<{ sha: string }>(
      token,
      "POST",
      `/repos/${owner}/${repoName}/git/trees`,
      { tree },
    );

    const commit = await gh<{ sha: string }>(
      token,
      "POST",
      `/repos/${owner}/${repoName}/git/commits`,
      { message: title, tree: treeRes.sha, parents: [parentSha] },
    );

    // Create or fast-forward the branch ref to the new commit.
    if (isNewBranch) {
      branch = await createBranchRef(
        token,
        owner,
        repoName,
        branch,
        commit.sha,
      );
    } else {
      await gh(
        token,
        "PATCH",
        `/repos/${owner}/${repoName}/git/refs/heads/${branch}`,
        {
          sha: commit.sha,
          force: false,
        },
      );
    }

    // Direct mode: no PR — the default branch now points at the new commit.
    if (mode === "direct") {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          lastPushedBranch: defaultBranch,
          lastPushedSequence: project.headSequence,
        },
      });
      const commitUrl = `${repo.htmlUrl}/commit/${commit.sha}`;
      return {
        repoUrl: repo.htmlUrl,
        branch: defaultBranch,
        mode,
        summary: `Committed directly to \`${defaultBranch}\` on [${fullName}](${repo.htmlUrl}): [${title}](${commitUrl})`,
      };
    }

    const pr = await ensurePullRequest(
      token,
      repo,
      branch,
      title,
      body,
      canUpdateBranch && !isNewBranch ? project.lastPrNumber : null,
    );

    await prisma.project.update({
      where: { id: projectId },
      data: {
        lastPushedBranch: branch,
        lastPrUrl: pr.url,
        lastPrNumber: pr.number,
        lastPushedSequence: project.headSequence,
      },
    });

    return {
      repoUrl: repo.htmlUrl,
      prUrl: pr.url,
      branch,
      mode,
      summary: `${
        isNewBranch ? "Opened" : "Updated"
      } a pull request on GitHub: [${title}](${pr.url})\n\nRepository: [${fullName}](${repo.htmlUrl})`,
    };
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 401) {
      await dropConnection(userId);
      return {
        error:
          "The GitHub connection is no longer valid. Ask the user to reconnect their GitHub account.",
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: `GitHub push failed: ${message}` };
  }
}

/**
 * Everything the GitHub panel shows for a project: connection + linked repo +
 * last/open PRs + a rough count of changes since the last push.
 */
export async function getGithubProjectInfo(
  projectId: string,
  userId: string,
): Promise<GithubProjectInfo> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      githubRepo: true,
      githubDefaultBranch: true,
      githubVisibility: true,
      githubPushMode: true,
      headSequence: true,
      lastPushedSequence: true,
      lastPrNumber: true,
    },
  });

  const pushMode: PushMode = isPushMode(project?.githubPushMode)
    ? project!.githubPushMode
    : "new_pr";

  const token = await resolveToken(userId);
  const empty: GithubProjectInfo = {
    connected: false,
    username: null,
    repo: null,
    lastPr: null,
    openPrs: [],
    unpushedChanges: 0,
    pushMode,
  };
  if (!token || !project) return empty;

  const ghUser = await fetchGithubUser(token);
  if (!ghUser) {
    await dropConnection(userId);
    return empty;
  }

  let repo: RepoSummary | null = null;
  let lastPr: PrSummary | null = null;
  let openPrs: PrSummary[] = [];

  if (project.githubRepo) {
    const [owner, name] = project.githubRepo.split("/");
    try {
      const r = await gh<GithubRepoResponse>(
        token,
        "GET",
        `/repos/${owner}/${name}`,
      );
      const info = toRepoInfo(r);
      repo = {
        fullName: info.fullName,
        htmlUrl: info.htmlUrl,
        visibility: info.visibility,
        defaultBranch: info.defaultBranch,
      };
      // Refresh cached facts if they drifted.
      if (
        info.defaultBranch !== project.githubDefaultBranch ||
        info.visibility !== project.githubVisibility
      ) {
        await cacheRepoFacts(projectId, info);
      }

      const prs = await gh<GithubPrResponse[]>(
        token,
        "GET",
        `/repos/${owner}/${name}/pulls?state=open&per_page=10`,
      );
      openPrs = prs.map(toPrSummary);

      if (project.lastPrNumber) {
        try {
          const pr = await gh<GithubPrResponse>(
            token,
            "GET",
            `/repos/${owner}/${name}/pulls/${project.lastPrNumber}`,
          );
          lastPr = toPrSummary(pr);
        } catch {
          /* PR deleted upstream — leave lastPr null */
        }
      }
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 401) {
        await dropConnection(userId);
        return empty;
      }
      // 404 → repo deleted upstream; report as connected-but-unlinked.
      repo = null;
    }
  }

  const unpushedChanges = repo
    ? Math.max(0, project.headSequence - (project.lastPushedSequence ?? 0))
    : 0;

  return {
    connected: true,
    username: ghUser.login,
    repo,
    lastPr,
    openPrs,
    unpushedChanges,
    pushMode,
  };
}

/** Link a project to an existing repo the user already owns ("owner/repo"). */
export async function linkExistingRepo(
  projectId: string,
  userId: string,
  repoFullName: string,
): Promise<RepoSummary | PushError> {
  const token = await resolveToken(userId);
  if (!token) return { error: "GitHub is not connected." };

  const parts = repoFullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { error: "Expected a repository in 'owner/repo' form." };
  }

  try {
    const r = await gh<GithubRepoResponse>(
      token,
      "GET",
      `/repos/${parts[0]}/${parts[1]}`,
    );
    const info = toRepoInfo(r);
    await prisma.project.update({
      where: { id: projectId },
      data: {
        githubRepo: info.fullName,
        githubDefaultBranch: info.defaultBranch,
        githubVisibility: info.visibility,
        // A different repo — reset last-push bookkeeping.
        lastPushedBranch: null,
        lastPrUrl: null,
        lastPrNumber: null,
        lastPushedSequence: null,
      },
    });
    return {
      fullName: info.fullName,
      htmlUrl: info.htmlUrl,
      visibility: info.visibility,
      defaultBranch: info.defaultBranch,
    };
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 404) {
      return { error: "Repository not found, or your token can't access it." };
    }
    if (err instanceof GithubApiError && err.status === 401) {
      await dropConnection(userId);
      return { error: "The GitHub connection is no longer valid." };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

/** Detach a project from its repo (does not touch the repo on GitHub). */
export async function unlinkRepo(
  projectId: string,
  userId: string,
): Promise<void> {
  // userId kept for signature symmetry / future per-user checks.
  void userId;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      githubRepo: null,
      githubDefaultBranch: null,
      githubVisibility: null,
      lastPushedBranch: null,
      lastPrUrl: null,
      lastPrNumber: null,
      lastPushedSequence: null,
    },
  });
}

export interface UserRepo {
  fullName: string;
  private: boolean;
  htmlUrl: string;
}

/** The repos the user owns, most-recently-updated first (for the link picker). */
export async function listUserRepos(
  userId: string,
): Promise<UserRepo[] | PushError> {
  const token = await resolveToken(userId);
  if (!token) return { error: "GitHub is not connected." };
  try {
    const repos = await gh<GithubRepoResponse[]>(
      token,
      "GET",
      `/user/repos?per_page=100&sort=updated&affiliation=owner`,
    );
    return repos.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      htmlUrl: r.html_url,
    }));
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 401) {
      await dropConnection(userId);
      return { error: "The GitHub connection is no longer valid." };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

/** Flip a linked repo between private and public. */
export async function setRepoVisibility(
  projectId: string,
  userId: string,
  makePrivate: boolean,
): Promise<RepoSummary | PushError> {
  const token = await resolveToken(userId);
  if (!token) return { error: "GitHub is not connected." };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { githubRepo: true },
  });
  if (!project?.githubRepo) return { error: "No repository is linked." };

  const [owner, name] = project.githubRepo.split("/");
  try {
    const r = await gh<GithubRepoResponse>(
      token,
      "PATCH",
      `/repos/${owner}/${name}`,
      { private: makePrivate },
    );
    const info = toRepoInfo(r);
    await prisma.project.update({
      where: { id: projectId },
      data: { githubVisibility: info.visibility },
    });
    return {
      fullName: info.fullName,
      htmlUrl: info.htmlUrl,
      visibility: info.visibility,
      defaultBranch: info.defaultBranch,
    };
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 422) {
      return {
        error:
          "GitHub refused the visibility change (an org policy may block it).",
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

/** Persist the default push mode for a project (no GitHub call). */
export async function setPushMode(
  projectId: string,
  userId: string,
  mode: PushMode,
): Promise<void> {
  void userId;
  await prisma.project.update({
    where: { id: projectId },
    data: { githubPushMode: mode },
  });
}

export interface IssueResult {
  issueUrl: string;
  number: number;
  summary: string;
}

/** Open a GitHub issue on the project's linked repo. */
export async function createGithubIssue(
  projectId: string,
  userId: string,
  opts: { title: string; body: string },
): Promise<IssueResult | PushError> {
  const token = await resolveToken(userId);
  if (!token) {
    return {
      error:
        "GitHub is not connected. Ask the user to click the GitHub button on the project page to connect their account first.",
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { githubRepo: true },
  });
  if (!project?.githubRepo) {
    return {
      error:
        "This project isn't linked to a GitHub repository yet. Push to GitHub first, then file issues.",
    };
  }

  const title = opts.title.trim();
  if (!title) return { error: "An issue needs a title." };

  const [owner, name] = project.githubRepo.split("/");
  try {
    const issue = await gh<{ html_url: string; number: number }>(
      token,
      "POST",
      `/repos/${owner}/${name}/issues`,
      { title, body: opts.body.trim() || undefined },
    );
    return {
      issueUrl: issue.html_url,
      number: issue.number,
      summary: `Opened issue [#${issue.number} — ${title}](${issue.html_url})`,
    };
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 401) {
      await dropConnection(userId);
      return { error: "The GitHub connection is no longer valid." };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Couldn't create the issue: ${message}` };
  }
}
