import { prisma } from "./prisma";
import { getBlobText } from "./s3";

/**
 * Server-side git engine. We never run `git` in the sandbox — instead we build
 * commits directly against GitHub's REST API (git blobs/trees/commits/refs),
 * exactly what `git push` does under the hood. See doc/GITHUB_INTEGRATION.md §1.
 *
 * The commit content is the stored `ProjectFile` set (the same source of truth
 * `rehydrateSandbox` reads from), so pushing works whether or not a sandbox is
 * awake, and the token never leaves this process.
 */

const GITHUB_API = "https://api.github.com";
const PROVIDER = "github";
const USER_AGENT = "tau-app";
const GIT_FILE_MODE = "100644"; // normal file blob

export interface PushResult {
  repoUrl: string;
  prUrl: string;
  branch: string;
  /** Markdown shown in the chat UI; also readable by the model. */
  summary: string;
}

export interface PushError {
  error: string;
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

/** Turn a project name into a valid, collision-resistant GitHub repo slug. */
function slugifyRepoName(name: string): string {
  const slug = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || "tau-project";
}

interface RepoInfo {
  fullName: string; // "owner/repo"
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch: string;
}

interface GithubRepoResponse {
  full_name: string;
  name: string;
  html_url: string;
  default_branch: string;
  owner: { login: string };
}

function toRepoInfo(r: GithubRepoResponse): RepoInfo {
  return {
    fullName: r.full_name,
    owner: r.owner.login,
    repo: r.name,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch || "main",
  };
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
  for (const candidate of [base, `${base}-${shortId()}`, `${base}-${shortId()}`]) {
    try {
      const created = await gh<GithubRepoResponse>(token, "POST", `/user/repos`, {
        name: candidate,
        description: description.slice(0, 350),
        private: true,
        auto_init: true,
      });
      const info = toRepoInfo(created);
      await prisma.project.update({
        where: { id: project.id },
        data: { githubRepo: info.fullName },
      });
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

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Upload one file's content as a git blob, reusing a cached sha when possible. */
async function uploadBlob(
  token: string,
  fullName: string,
  contentHash: string,
  content: string,
): Promise<string> {
  const cacheKey = `${fullName}:${contentHash}`;
  const cached = blobShaCache.get(cacheKey);
  if (cached) return cached;

  const [owner, repo] = fullName.split("/");
  const blob = await gh<{ sha: string }>(
    token,
    "POST",
    `/repos/${owner}/${repo}/git/blobs`,
    { content, encoding: "utf-8" },
  );
  blobShaCache.set(cacheKey, blob.sha);
  return blob.sha;
}

/**
 * Build a commit from the project's stored files and open a PR into the repo's
 * default branch from a fresh `tau/update-<ts>` branch.
 *
 * Returns a structured error (never throws for expected conditions like "not
 * connected" or "no files") so the agent tool can surface it to the user.
 */
export async function pushProjectToGithub(
  projectId: string,
  userId: string,
  opts: { title: string; body: string },
): Promise<PushResult | PushError> {
  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: PROVIDER },
  });
  if (!account?.accessToken) {
    return {
      error:
        "GitHub is not connected. Ask the user to click the GitHub button on the project page to connect their account first.",
    };
  }
  const token = account.accessToken;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, githubRepo: true },
  });
  if (!project) return { error: "Project not found" };

  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, contentHash: true },
    orderBy: { path: "asc" },
  });
  if (files.length === 0) {
    return { error: "The project has no files to push yet." };
  }

  const title = opts.title.trim() || "Update from Tau";
  const body =
    opts.body.trim() || "Automated update pushed from Tau.";

  try {
    const repo = await ensureRepo(token, project, title);
    const { owner, repo: repoName, fullName, defaultBranch } = repo;

    // Read every file body from R2 and upload it as a git blob.
    const tree = await Promise.all(
      files.map(async ({ path, contentHash }) => {
        const content = await getBlobText(userId, projectId, contentHash);
        const sha = await uploadBlob(token, fullName, contentHash, content);
        return { path, mode: GIT_FILE_MODE, type: "blob" as const, sha };
      }),
    );

    // The parent commit is the current tip of the default branch. On a freshly
    // auto-init'd repo the ref can 404 for a beat, so retry briefly.
    const parentSha = await getHeadShaWithRetry(
      token,
      owner,
      repoName,
      defaultBranch,
    );

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

    const branch = `tau/update-${Date.now()}`;
    await gh(token, "POST", `/repos/${owner}/${repoName}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });

    const prUrl = await openPullRequest(token, repo, branch, title, body);

    return {
      repoUrl: repo.htmlUrl,
      prUrl,
      branch,
      summary: `Opened a pull request on GitHub: [${title}](${prUrl})\n\nRepository: [${fullName}](${repo.htmlUrl})`,
    };
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 401) {
      // Token revoked upstream — drop the dead link so the UI re-prompts.
      await prisma.oAuthAccount
        .deleteMany({ where: { userId, provider: PROVIDER } })
        .catch(() => {});
      return {
        error:
          "The GitHub connection is no longer valid. Ask the user to reconnect their GitHub account.",
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: `GitHub push failed: ${message}` };
  }
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

/** Open a PR; if one already exists for the branch, return that PR's URL. */
async function openPullRequest(
  token: string,
  repo: RepoInfo,
  branch: string,
  title: string,
  body: string,
): Promise<string> {
  const { owner, repo: repoName, defaultBranch } = repo;
  try {
    const pr = await gh<{ html_url: string }>(
      token,
      "POST",
      `/repos/${owner}/${repoName}/pulls`,
      { title, head: branch, base: defaultBranch, body },
    );
    return pr.html_url;
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 422) {
      // A PR already exists for this head — return the existing one.
      const existing = await gh<{ html_url: string }[]>(
        token,
        "GET",
        `/repos/${owner}/${repoName}/pulls?head=${owner}:${branch}&state=open`,
      );
      if (existing[0]?.html_url) return existing[0].html_url;
    }
    throw err;
  }
}
