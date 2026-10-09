import { beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

// What happens to a published site after it is built: rolling back, taking it
// offline, suspending it, and reclaiming old builds. All of it is the live
// pointer and two timestamps moving between rows, so the tests run the real
// services, the real slug lookup and the real site router over HTTP, against a
// small in-memory stand-in for the three tables involved. Only R2 and the job
// queue are stubbed.
//
// The stand-in evaluates the `where` it is handed (equality, `in`, `lt`, `gt`,
// `OR`) rather than returning canned rows, so a query written wrongly in the
// code under test fails here instead of passing against a fake that ignores it.

type Row = Record<string, unknown>;

const tables = {
  project: [] as Row[],
  deployment: [] as Row[],
  job: [] as Row[],
  user: [] as Row[],
  projectFile: [] as Row[],
};

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function matches(row: Row, where: Row | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (key === "OR") {
      if (!(cond as Row[]).some((w) => matches(row, w))) return false;
      continue;
    }
    const value = row[key];
    if (cond === null || typeof cond !== "object" || cond instanceof Date) {
      if (!same(value, cond)) return false;
      continue;
    }
    const c = cond as { in?: unknown[]; lt?: Date | number; gt?: Date | number };
    if (c.in && !c.in.includes(value)) return false;
    // SQL semantics: a comparison against NULL is never true.
    if (c.lt !== undefined && !(value != null && (value as Date) < c.lt)) {
      return false;
    }
    if (c.gt !== undefined && !(value != null && (value as Date) > c.gt)) {
      return false;
    }
  }
  return true;
}

function model(rows: Row[], defaults: () => Row) {
  const find = (where?: Row) => rows.filter((r) => matches(r, where));
  return {
    findUnique: async ({ where }: { where: Row }) => {
      const row = find(where)[0];
      return row ? { ...row } : null;
    },
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const row = find(where)[0];
      if (!row) throw new Error("not found");
      return { ...row };
    },
    findFirst: async ({ where }: { where?: Row } = {}) => {
      const row = find(where)[0];
      return row ? { ...row } : null;
    },
    findMany: async ({
      where,
      orderBy,
      take,
    }: { where?: Row; orderBy?: Record<string, "asc" | "desc">; take?: number } = {}) => {
      let out = find(where);
      if (orderBy) {
        const [key, dir] = Object.entries(orderBy)[0]!;
        out = [...out].sort((a, b) => {
          const d = Number(a[key] ?? 0) - Number(b[key] ?? 0);
          return dir === "asc" ? d : -d;
        });
      }
      return out.slice(0, take ?? out.length).map((r) => ({ ...r }));
    },
    count: async ({ where }: { where?: Row } = {}) => find(where).length,
    create: async ({ data }: { data: Row }) => {
      const { project, ...rest } = data as Row & {
        project?: { connect: { id: string } };
      };
      const row: Row = {
        id: randomUUID(),
        ...defaults(),
        ...rest,
        ...(project ? { projectId: project.connect.id } : {}),
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = find(where)[0];
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = find(where);
      for (const row of hit) Object.assign(row, data);
      return { count: hit.length };
    },
  };
}

const db = {
  project: model(tables.project, () => ({})),
  deployment: model(tables.deployment, () => ({
    status: "QUEUED",
    fileCount: 0,
    sizeBytes: 0,
    error: null,
    buildLog: null,
    createdAt: new Date(),
    completedAt: null,
    supersededAt: null,
    purgedAt: null,
  })),
  job: model(tables.job, () => ({ status: "QUEUED" })),
  user: model(tables.user, () => ({})),
  projectFile: model(tables.projectFile, () => ({})),
};

mock.module("@/lib/prisma", () => ({
  prisma: {
    ...db,
    // One process, no concurrency: running the callback against the same
    // tables is the transaction.
    $transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db),
  },
}));

const objects = new Map<string, string>();
let failDeletes = false;
const realS3 = await import("@/lib/s3");
mock.module("@/lib/s3", () => ({
  ...realS3,
  getSiteObject: async (key: string) => {
    const body = objects.get(key);
    if (body === undefined) return null;
    return {
      body: new TextEncoder().encode(body),
      contentType: "text/html; charset=utf-8",
      etag: `"${key}"`,
    };
  },
  deleteSitePrefix: async (prefix: string) => {
    if (failDeletes) throw new Error("R2 is down");
    let deleted = 0;
    for (const key of [...objects.keys()]) {
      if (key.startsWith(`${prefix}/`)) {
        objects.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  },
}));

const enqueued: string[] = [];
mock.module("@/api/lib/queue", () => ({
  enqueueJob: async ({ jobId }: { jobId: string }) => {
    enqueued.push(jobId);
    return `queue-${jobId}`;
  },
}));

const { getDeployStatus, requestDeploy, rollbackDeploy, unpublish } =
  await import("@/api/services/deploy.service");
const { suspendProjectSite, unsuspendProjectSite } = await import(
  "@/api/services/admin.service"
);
const { sweepDeployments } = await import("@/api/lib/deploySweep");
const { invalidateSiteLookup } = await import("@/api/lib/siteLookup");
const express = (await import("express")).default;
const siteRoutes = (await import("@/api/routes/sites.routes")).default;

const app = express();
app.use(siteRoutes);
const server = http.createServer(app).listen(0);
const port = (server.address() as AddressInfo).port;
const visit = (path = "/") =>
  fetch(`http://127.0.0.1:${port}/sites/${SLUG}${path}`, { redirect: "manual" });

const OWNER = "owner";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const SLUG = "my-app-ab12cd";
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** A build that finished, with one page saying which build it is. */
function build(id: string, fields: Row = {}): Row {
  const row: Row = {
    id,
    projectId: PROJECT,
    userId: OWNER,
    status: "SUPERSEDED",
    storagePrefix: `tau/sites/${OWNER}/${PROJECT}/${id}`,
    sequence: 1,
    fileCount: 1,
    sizeBytes: 10,
    error: null,
    buildLog: null,
    createdAt: daysAgo(2),
    completedAt: daysAgo(2),
    supersededAt: daysAgo(1),
    purgedAt: null,
    ...fields,
  };
  tables.deployment.push(row);
  if (!row.purgedAt && row.status !== "FAILED") {
    objects.set(`${row.storagePrefix}/index.html`, `<h1>${id}</h1>`);
  }
  return row;
}

const row = (id: string) => tables.deployment.find((d) => d.id === id)!;
const project = () => tables.project[0]!;

async function failure(run: () => Promise<unknown>): Promise<{ statusCode?: number; message: string }> {
  try {
    await run();
  } catch (err) {
    return err as { statusCode?: number; message: string };
  }
  throw new Error("expected it to be refused");
}

beforeEach(() => {
  for (const rows of Object.values(tables)) rows.length = 0;
  objects.clear();
  enqueued.length = 0;
  failDeletes = false;
  invalidateSiteLookup(SLUG);

  tables.user.push({ id: OWNER, emailVerifiedAt: new Date() });
  tables.projectFile.push({ projectId: PROJECT, path: "index.html", lastSequence: 1 });
  tables.project.push({
    id: PROJECT,
    userId: OWNER,
    name: "My App",
    slug: SLUG,
    templateKey: "v2-frontend",
    headSequence: 1,
    liveDeploymentId: "new",
    siteSuspendedAt: null,
    siteSuspendedReason: null,
    user: { billing: { plan: "PRO" } },
  });
  // Two publishes: "old" was replaced a day ago by "new", which is live.
  build("old", { createdAt: daysAgo(3), completedAt: daysAgo(3) });
  build("new", { status: "READY", supersededAt: null });
});

describe("rollback", () => {
  test("puts the earlier build back and supersedes the one it replaces", async () => {
    expect(await (await visit()).text()).toBe("<h1>new</h1>");

    const before = Date.now();
    const status = await rollbackDeploy(PROJECT, "old", OWNER);

    expect(project().liveDeploymentId).toBe("old");
    expect(row("old").status).toBe("READY");
    expect(row("old").supersededAt).toBeNull();
    expect(row("new").status).toBe("SUPERSEDED");
    expect((row("new").supersededAt as Date).getTime()).toBeGreaterThanOrEqual(before);

    expect(status.live?.id).toBe("old");
    // Served at once: the lookup's cached entry for the slug was dropped.
    expect(await (await visit()).text()).toBe("<h1>old</h1>");
  });

  test("can be undone by rolling back to the build it replaced", async () => {
    await rollbackDeploy(PROJECT, "old", OWNER);
    const status = await rollbackDeploy(PROJECT, "new", OWNER);

    expect(status.live?.id).toBe("new");
    expect(row("new").supersededAt).toBeNull();
    expect(row("old").status).toBe("SUPERSEDED");
    expect(await (await visit()).text()).toBe("<h1>new</h1>");
  });

  test("refuses a build whose files were purged", async () => {
    row("old").purgedAt = new Date();

    const err = await failure(() => rollbackDeploy(PROJECT, "old", OWNER));
    expect(err.statusCode).toBe(409);
    expect(project().liveDeploymentId).toBe("new");
    expect(row("new").status).toBe("READY");
  });

  // The sweep may be deleting it this minute, or have failed half way through.
  test("refuses a build outside its rollback window", async () => {
    row("old").supersededAt = daysAgo(8);

    const err = await failure(() => rollbackDeploy(PROJECT, "old", OWNER));
    expect(err.statusCode).toBe(409);
    expect(project().liveDeploymentId).toBe("new");
  });

  test("refuses another project's deployment", async () => {
    build("theirs", { projectId: "22222222-2222-4222-8222-222222222222" });

    const err = await failure(() => rollbackDeploy(PROJECT, "theirs", OWNER));
    expect(err.statusCode).toBe(404);
    expect(project().liveDeploymentId).toBe("new");
  });

  test("refuses the build that is already live", async () => {
    const err = await failure(() => rollbackDeploy(PROJECT, "new", OWNER));
    expect(err.statusCode).toBe(409);
    expect(row("new").status).toBe("READY");
  });

  test("refuses a build that never went live", async () => {
    build("broken", { status: "FAILED", supersededAt: null });

    const err = await failure(() => rollbackDeploy(PROJECT, "broken", OWNER));
    expect(err.statusCode).toBe(409);
  });

  test("refuses while a publish or an agent run is in progress", async () => {
    for (const type of ["DEPLOY", "GENERATION"]) {
      tables.job.length = 0;
      tables.job.push({ id: "j1", projectId: PROJECT, type, status: "RUNNING" });

      const err = await failure(() => rollbackDeploy(PROJECT, "old", OWNER));
      expect(err.statusCode).toBe(409);
      expect(project().liveDeploymentId).toBe("new");
    }
  });

  test("refuses anyone but the owner", async () => {
    const err = await failure(() => rollbackDeploy(PROJECT, "old", "someone-else"));
    expect(err.statusCode).toBe(403);
    expect(project().liveDeploymentId).toBe("new");
  });
});

describe("take offline", () => {
  test("the site stops serving, and the address and history stay", async () => {
    const before = Date.now();
    const status = await unpublish(PROJECT, OWNER);

    expect(project().liveDeploymentId).toBeNull();
    expect(project().slug).toBe(SLUG);
    expect(row("new").status).toBe("SUPERSEDED");
    expect((row("new").supersededAt as Date).getTime()).toBeGreaterThanOrEqual(before);

    expect(status.live).toBeNull();
    expect(status.slug).toBe(SLUG);
    expect(status.url).toContain(SLUG);
    expect(status.deployments).toHaveLength(2);

    const res = await visit();
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No app is published at this address yet.");
  });

  test("the build that was serving can be put back without a rebuild", async () => {
    const offline = await unpublish(PROJECT, OWNER);
    expect(offline.deployments.find((d) => d.id === "new")?.canRollback).toBe(true);

    const status = await rollbackDeploy(PROJECT, "new", OWNER);
    expect(status.live?.id).toBe("new");
    expect(await (await visit()).text()).toBe("<h1>new</h1>");
  });

  test("taking an offline site offline changes nothing", async () => {
    await unpublish(PROJECT, OWNER);
    const supersededAt = row("new").supersededAt;

    const status = await unpublish(PROJECT, OWNER);
    expect(status.live).toBeNull();
    expect(row("new").supersededAt).toBe(supersededAt);
  });

  // A publish would move the pointer straight back; an agent run would not.
  test("refuses during a publish, but not during an agent run", async () => {
    tables.job.push({ id: "j1", projectId: PROJECT, type: "DEPLOY", status: "RUNNING" });
    const err = await failure(() => unpublish(PROJECT, OWNER));
    expect(err.statusCode).toBe(409);
    expect(project().liveDeploymentId).toBe("new");

    tables.job[0]!.type = "GENERATION";
    await unpublish(PROJECT, OWNER);
    expect(project().liveDeploymentId).toBeNull();
  });

  test("refuses anyone but the owner", async () => {
    const err = await failure(() => unpublish(PROJECT, "someone-else"));
    expect(err.statusCode).toBe(403);
    expect(project().liveDeploymentId).toBe("new");
  });
});

describe("the sweep", () => {
  // The defect this replaces: the window was counted from when a build
  // finished, so a site that had been live for a month lost its rollback
  // target within the hour of being replaced.
  test("a build made 30 days ago and superseded today is kept", async () => {
    row("old").completedAt = daysAgo(30);
    row("old").supersededAt = new Date();

    const result = await sweepDeployments();
    expect(result.purged).toBe(0);
    expect(row("old").purgedAt).toBeNull();
    expect(objects.has(`${row("old").storagePrefix}/index.html`)).toBe(true);
  });

  test("a build superseded 8 days ago is purged", async () => {
    row("old").supersededAt = daysAgo(8);

    const result = await sweepDeployments();
    expect(result.purged).toBe(1);
    expect(result.objectsDeleted).toBe(1);
    expect(row("old").purgedAt).toBeInstanceOf(Date);
    expect(objects.has(`${row("old").storagePrefix}/index.html`)).toBe(false);
  });

  test("a row from before supersededAt existed falls back to when it was built", async () => {
    row("old").supersededAt = null;
    row("old").completedAt = daysAgo(8);
    build("recent", { supersededAt: null, completedAt: daysAgo(2) });

    await sweepDeployments();
    expect(row("old").purgedAt).toBeInstanceOf(Date);
    expect(row("recent").purgedAt).toBeNull();
  });

  test("the live build is kept whatever its age", async () => {
    row("new").completedAt = daysAgo(400);

    await sweepDeployments();
    expect(row("new").purgedAt).toBeNull();
    expect(await (await visit()).text()).toBe("<h1>new</h1>");
  });

  test("a failed build is purged after a day", async () => {
    build("failed-old", { status: "FAILED", supersededAt: null, completedAt: daysAgo(2) });
    build("failed-new", { status: "FAILED", supersededAt: null, completedAt: new Date() });

    await sweepDeployments();
    expect(row("failed-old").purgedAt).toBeInstanceOf(Date);
    expect(row("failed-new").purgedAt).toBeNull();
  });

  test("a purged build is no longer offered for rollback", async () => {
    row("old").supersededAt = daysAgo(8);
    await sweepDeployments();

    const status = await getDeployStatus(PROJECT, OWNER);
    expect(status.deployments.find((d) => d.id === "old")?.canRollback).toBe(false);
  });

  test("an R2 failure leaves the row to be retried", async () => {
    row("old").supersededAt = daysAgo(8);
    failDeletes = true;

    const result = await sweepDeployments();
    expect(result.purged).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(row("old").purgedAt).toBeNull();

    failDeletes = false;
    expect((await sweepDeployments()).purged).toBe(1);
  });
});

describe("a suspended site", () => {
  test("serves the suspended page and comes back exactly as it was", async () => {
    await suspendProjectSite(PROJECT, "Phishing page reported by a visitor.");

    const res = await visit();
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("This site has been suspended");
    // Nothing about the deployment changed: suspension is a flag on the project.
    expect(project().liveDeploymentId).toBe("new");
    expect(row("new").status).toBe("READY");

    await unsuspendProjectSite(PROJECT);
    expect(await (await visit()).text()).toBe("<h1>new</h1>");
    expect(project().siteSuspendedAt).toBeNull();
    expect(project().siteSuspendedReason).toBeNull();
  });

  test("the owner is told why, and cannot publish or roll back", async () => {
    await suspendProjectSite(PROJECT, "Phishing page reported by a visitor.");

    const status = await getDeployStatus(PROJECT, OWNER);
    expect(status.suspended).toEqual({
      reason: "Phishing page reported by a visitor.",
    });

    const publish = await failure(() => requestDeploy(PROJECT, OWNER));
    expect(publish.statusCode).toBe(403);
    expect(tables.job).toHaveLength(0);
    expect(enqueued).toHaveLength(0);

    const rollback = await failure(() => rollbackDeploy(PROJECT, "old", OWNER));
    expect(rollback.statusCode).toBe(403);
    expect(project().liveDeploymentId).toBe("new");
  });

  test("an offline site that is suspended still says suspended", async () => {
    await unpublish(PROJECT, OWNER);
    await suspendProjectSite(PROJECT, "Reported.");

    expect((await visit()).status).toBe(403);
  });

  test("suspending again replaces the reason and keeps the time", async () => {
    const first = await suspendProjectSite(PROJECT, "First report.");
    const second = await suspendProjectSite(PROJECT, "Second report.");

    expect(second.siteSuspendedAt).toEqual(first.siteSuspendedAt);
    expect(second.siteSuspendedReason).toBe("Second report.");
  });
});

describe("who may publish", () => {
  test("an unverified email is refused before anything is created", async () => {
    tables.user[0]!.emailVerifiedAt = null;

    const err = await failure(() => requestDeploy(PROJECT, OWNER));
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("Verify your email to publish.");
    expect(tables.job).toHaveLength(0);
    expect(tables.deployment).toHaveLength(2);
    expect(enqueued).toHaveLength(0);
  });

  test("a verified owner gets a job and a deployment", async () => {
    const result = await requestDeploy(PROJECT, OWNER);

    expect(result.slug).toBe(SLUG);
    expect(enqueued).toEqual([result.jobId]);
    expect(row(result.deploymentId).storagePrefix).toBe(
      `tau/sites/${OWNER}/${PROJECT}/${result.deploymentId}`,
    );
  });
});

describe("the status the panel reads", () => {
  test("says which builds can be rolled back to", async () => {
    build("purged", { purgedAt: new Date() });
    build("failed", { status: "FAILED", supersededAt: null });

    const status = await getDeployStatus(PROJECT, OWNER);
    const can = Object.fromEntries(status.deployments.map((d) => [d.id, d.canRollback]));
    expect(can).toEqual({ old: true, new: false, purged: false, failed: false });
    expect(status.suspended).toBeNull();
  });

  test("carries the newest failure with its build log, and nothing otherwise", async () => {
    expect((await getDeployStatus(PROJECT, OWNER)).lastFailure).toBeNull();

    build("failed", {
      status: "FAILED",
      supersededAt: null,
      createdAt: new Date(),
      error: "The build failed. Ask the agent to fix the errors, then publish again.",
      buildLog: "src/App.tsx(3,1): error TS1005: '}' expected.",
    });

    const status = await getDeployStatus(PROJECT, OWNER);
    expect(status.lastFailure).toEqual({
      error: "The build failed. Ask the agent to fix the errors, then publish again.",
      buildLog: "src/App.tsx(3,1): error TS1005: '}' expected.",
      changedSince: false,
    });
    // The log is kilobytes and only the newest failure is acted on, so it is
    // not repeated on every history row.
    expect(Object.keys(status.deployments[0]!)).not.toContain("buildLog");
    // A failed publish leaves the previous build serving.
    expect(status.live?.id).toBe("new");
  });

  test("says when the files changed after the failure", async () => {
    build("failed", { status: "FAILED", supersededAt: null, createdAt: new Date(), error: "x" });
    project().headSequence = 2;

    expect((await getDeployStatus(PROJECT, OWNER)).lastFailure?.changedSince).toBe(true);
  });

  test("an older failure behind a good publish is not reported", async () => {
    build("failed", { status: "FAILED", supersededAt: null, createdAt: daysAgo(5), error: "x" });

    expect((await getDeployStatus(PROJECT, OWNER)).lastFailure).toBeNull();
  });
});
