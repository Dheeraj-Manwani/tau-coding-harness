import { beforeEach, describe, expect, mock, test } from "bun:test";

// prepareDatabase: what stops a publish, what is added on the owner's behalf, and
// that nothing is created at Neon for a publish that stops.

let live: { schemaSql: string | null; schemaHash: string | null } | null = null;
const calls: string[] = [];

mock.module("@/lib/prisma", () => ({
  prisma: {
    project: { findUniqueOrThrow: async () => ({ liveDeploymentId: live ? "d1" : null }) },
    deployment: { findUnique: async () => live },
  },
}));
mock.module("@/lib/neonApps", () => ({
  ensureDatabase: async () => {
    calls.push("ensure");
    return { url: "postgres://x", created: false };
  },
  branchDatabase: async (_p: string, label: string) => {
    calls.push(`branch:${label.startsWith("before-")}`);
    return "br-1";
  },
}));

const { prepareDatabase, SchemaChangeRequired } = await import("@/worker/lib/deployDatabase");
const { schemaHash } = await import("@/worker/lib/deployTransforms");
const { extractInitSql } = await import("@/worker/lib/deployTransforms");
const { DeployError } = await import("@/worker/lib/deploy");

const clientWith = (sql: string) => `import { PGlite } from '@electric-sql/pglite'
export async function initDb() {
  await client.exec(\`${sql}\`)
}
`;
const V1 = `CREATE TABLE IF NOT EXISTS items (id serial PRIMARY KEY, title text NOT NULL);`;
const sandboxWith = (clientTs: string | null) =>
  ({ files: { read: async () => { if (clientTs === null) throw new Error("missing"); return clientTs; } } }) as any;

const liveFrom = (sql: string) => ({ schemaSql: extractInitSql(clientWith(sql))!, schemaHash: schemaHash(extractInitSql(clientWith(sql))!) });

beforeEach(() => {
  live = null;
  calls.length = 0;
});

const run = (clientTs: string | null, confirmed = false) => prepareDatabase(sandboxWith(clientTs), { projectId: "p1", jobId: "j", confirmed });

describe("prepareDatabase", () => {
  test("a first publish creates the database and produces a production client", async () => {
    const r = await run(clientWith(V1));
    expect(calls).toEqual(["ensure"]);
    expect(r.url).toBe("postgres://x");
    expect(r.clientTs).toContain("drizzle-orm/node-postgres");
    expect(r.additive).toEqual([]);
    expect(r.branchId).toBeNull();
  });

  test("the same schema again changes nothing", async () => {
    live = liveFrom(V1);
    const r = await run(clientWith(V1));
    expect(r.additive).toEqual([]);
  });

  test("a new nullable column is added by tau and runs after the app's own SQL", async () => {
    live = liveFrom(V1);
    const r = await run(clientWith(V1.replace("title text NOT NULL", "title text NOT NULL, note text")));
    expect(r.additive).toEqual([`ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "note" text;`]);
    expect(r.clientTs).toContain(`ADD COLUMN IF NOT EXISTS "note" text`);
    expect(r.clientTs.indexOf("CREATE TABLE")).toBeLessThan(r.clientTs.indexOf("ADD COLUMN"));
    expect(calls).toEqual(["ensure"]);
  });

  test("a change that cannot be applied stops the publish before anything is created, listing it", async () => {
    live = liveFrom(V1);
    const err = await run(clientWith(V1.replace("title text NOT NULL", "name text NOT NULL"))).catch((e) => e);
    expect(err).toBeInstanceOf(SchemaChangeRequired);
    expect(err).toBeInstanceOf(DeployError);
    expect(err.changes.map((c: { kind: string }) => c.kind).sort()).toEqual(["drop_column", "required_column"]);
    expect(calls).toEqual([]);
  });

  test("confirmed, it takes a restore point, then carries on", async () => {
    live = liveFrom(V1);
    const r = await run(clientWith(V1.replace("title text NOT NULL", "name text NOT NULL")), true);
    expect(calls).toEqual(["ensure", "branch:true"]);
    expect(r.branchId).toBe("br-1");
  });

  test("a client file tau cannot read, or a missing one, is a message for the owner", async () => {
    const unreadable = await run("export const x = 1").catch((e) => e);
    expect(unreadable).toBeInstanceOf(DeployError);
    expect(unreadable.message).toContain("could not read your database tables");
    const missing = await run(null).catch((e) => e);
    expect(missing.message).toContain("is missing");
    expect(calls).toEqual([]);
  });
});
