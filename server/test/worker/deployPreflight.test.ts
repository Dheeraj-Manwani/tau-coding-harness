import { describe, expect, test } from "bun:test";
import { preflight, type PreflightInput } from "@/worker/lib/deployPreflight";
import {
  DB_CLIENT_TS,
  DB_SCHEMA_TS,
  DB_VALIDATION_TS,
  HONO_DB_SERVER_INDEX,
  HONO_SERVER_INDEX,
} from "@/worker/templates/shared";

// Can this app's server be published? One case per row of the plan's table,
// plus the three scaffolds as apps with nothing wrong with them.

const PKG = JSON.stringify({ dependencies: { hono: "^4" } });

function api(over: Record<string, string> = {}): Record<string, string> {
  return { "package.json": PKG, "server/index.ts": HONO_SERVER_INDEX, ...over };
}
function database(over: Record<string, string> = {}): Record<string, string> {
  return {
    "package.json": PKG,
    "server/index.ts": HONO_DB_SERVER_INDEX,
    "server/db/client.ts": DB_CLIENT_TS,
    "server/db/schema.ts": DB_SCHEMA_TS,
    "server/db/validation.ts": DB_VALIDATION_TS,
    ...over,
  };
}
const run = (level: PreflightInput["level"], files: Record<string, string>, more: Partial<PreflightInput> = {}) =>
  preflight({ level, files, secretNames: [], aiEnabled: false, ...more });
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("an app with nothing wrong", () => {
  test("frontend only", () => {
    const r = run("frontend", { "package.json": PKG });
    expect(r).toEqual({ level: "frontend", blockers: [], warnings: [], env: [] });
  });

  test("with an API", () => {
    const r = run("api", api());
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test("with a database", () => {
    const r = run("database", database());
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.env).toEqual([{ name: "DATABASE_URL", source: "platform" }]);
  });

  // A frontend project's files are never read for server problems.
  test("a frontend project is not blamed for a stray server file", () => {
    expect(run("frontend", { "package.json": PKG, "server/index.ts": "Bun.serve({})" }).blockers).toEqual([]);
  });
});

describe("blockers", () => {
  test("a server level with no server/index.ts", () => {
    expect(codes(run("api", { "package.json": PKG }).blockers)).toEqual(["server_missing"]);
  });

  test("no default export, or one without fetch", () => {
    expect(codes(run("api", api({ "server/index.ts": "const app = 1\napp.listen(3000)" })).blockers)).toEqual(["no_default_export"]);
    expect(codes(run("api", api({ "server/index.ts": "export default { port: 3000 }" })).blockers)).toEqual(["no_default_export"]);
    // A Hono app is itself a fetch handler.
    expect(run("api", api({ "server/index.ts": "const app = new Hono()\nexport default app" })).blockers).toEqual([]);
    expect(run("api", api({ "server/index.ts": "export default { port: 3000,\n fetch: app.fetch }" })).blockers).toEqual([]);
  });

  test("Bun globals and bun: imports", () => {
    for (const src of [
      "const f = Bun.file('x')",
      "import { serve } from 'bun'",
      "import { Database } from \"bun:sqlite\"",
      "import { test } from 'bun:test'",
    ]) {
      const r = run("api", api({ "server/routes.ts": `${src}\n` }));
      expect(codes(r.blockers)).toContain("bun_api");
      expect(r.blockers.find((b) => b.code === "bun_api")!.files).toEqual(["server/routes.ts"]);
    }
  });

  test("a mention of Bun in a comment is not a use of it", () => {
    const r = run("api", api({ "server/routes.ts": "// Bun.file would not work here\n/* from 'bun' */\nexport const x = 1\n" }));
    expect(r.blockers).toEqual([]);
  });

  test("embedded databases, imported or only installed", () => {
    expect(codes(run("api", api({ "server/db.ts": "import Database from 'better-sqlite3'" })).blockers)).toContain("embedded_database");
    expect(codes(run("api", api({ "server/db.ts": "import { Database } from 'bun:sqlite'" })).blockers)).toEqual(
      expect.arrayContaining(["embedded_database", "bun_api"]),
    );
    const installed = run("api", api({ "package.json": JSON.stringify({ dependencies: { sqlite3: "^5" } }) }));
    expect(installed.blockers.find((b) => b.code === "embedded_database")!.files).toEqual(["package.json"]);
  });

  test("PGlite used anywhere but server/db/client.ts", () => {
    const r = run("database", database({ "server/jobs.ts": "import { PGlite } from '@electric-sql/pglite'\n" }));
    expect(r.blockers.map((b) => b.code)).toEqual(["pglite_outside_client"]);
    expect(r.blockers[0]!.files).toEqual(["server/jobs.ts"]);
  });

  test("exports of server/db/client.ts used beyond db and initDb", () => {
    const named = run("database", database({ "server/jobs.ts": "import { db, client } from './db/client'\n" }));
    expect(codes(named.blockers)).toEqual(["client_exports_used"]);

    const whole = run("database", database({ "server/jobs.ts": "import * as c from './db/client'\n" }));
    expect(codes(whole.blockers)).toEqual(["client_exports_used"]);

    const aliased = run("database", database({ "server/routes/a.ts": "import { db as database, initDb } from '../db/client'\nimport type { X } from '../db/schema'\n" }));
    expect(aliased.blockers).toEqual([]);

    // Another file that happens to be called client is not the database client.
    const other = run("database", database({ "server/jobs.ts": "import { thing } from './other/client'\n" }));
    expect(other.blockers).toEqual([]);
  });

  test("a database app whose table SQL cannot be read", () => {
    const interpolated = DB_CLIENT_TS.replace("CREATE TABLE IF NOT EXISTS items", "CREATE TABLE IF NOT EXISTS ${'items'}");
    const r = run("database", database({ "server/db/client.ts": interpolated }));
    expect(codes(r.blockers)).toEqual(["init_sql_unreadable"]);
    expect(r.blockers[0]!.message).toContain("initDb");
  });

  test("a database app with no client file", () => {
    const files = database();
    delete files["server/db/client.ts"];
    expect(codes(run("database", files).blockers)).toEqual(["client_missing"]);
  });

  test("WebSockets, named for what they are", () => {
    for (const src of [
      "import { upgradeWebSocket } from 'hono/ws'",
      "import { WebSocketServer } from 'ws'",
      "const { default: ws } = require('ws')",
    ]) {
      const r = run("api", api({ "server/live.ts": `${src}\n` }));
      expect(codes(r.blockers)).toContain("websocket");
    }
    expect(run("api", api({ "server/live.ts": "import { upgradeWebSocket } from 'hono/ws'" })).blockers[0]!.message).toContain("WebSockets");
  });

  test("injected variables over Lambda's 4 KB", () => {
    const r = run("api", api(), { secretNames: ["BIG_KEY"], envValueBytes: { BIG_KEY: 4100 } });
    expect(codes(r.blockers)).toEqual(["env_too_large"]);
    expect(r.blockers[0]!.message).toContain("4096");
  });

  test("every message is a sentence with no jargon the owner cannot act on", () => {
    const worst = run("database", database({
      "server/a.ts": "Bun.file('x'); import { PGlite } from '@electric-sql/pglite'; import { upgradeWebSocket } from 'hono/ws'",
      "server/db/client.ts": "export const db = 1",
    }));
    for (const issue of worst.blockers) {
      expect(issue.message.length).toBeGreaterThan(30);
      expect(issue.message).toMatch(/[.]$/);
    }
  });
});

describe("warnings", () => {
  test("writing files", () => {
    const r = run("api", api({ "server/log.ts": "import { writeFileSync } from 'fs'\nwriteFileSync('a.txt', 'x')" }));
    expect(r.blockers).toEqual([]);
    expect(codes(r.warnings)).toEqual(["local_files"]);
    expect(r.warnings[0]!.message).toContain("gone by the next request");
  });

  // The scaffold's own client makes ./data; it is replaced, so it is not the app's doing.
  test("the database client's own directory setup is not reported", () => {
    expect(run("database", database()).warnings).toEqual([]);
  });

  test("timers and scheduled work", () => {
    expect(codes(run("api", api({ "server/tick.ts": "setInterval(() => {}, 1000)" })).warnings)).toEqual(["scheduled_work"]);
    expect(codes(run("api", api({ "server/cron.ts": "import cron from 'node-cron'" })).warnings)).toEqual(["scheduled_work"]);
  });

  test("a variable with no source is a warning, naming it, and only once per name", () => {
    const r = run("api", api({
      "server/a.ts": "const k = process.env.STRIPE_KEY\nconst j = process.env['STRIPE_KEY']",
      "server/b.ts": "const s = process.env.STRIPE_KEY",
    }));
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: "env_missing", files: ["server/a.ts", "server/b.ts"] });
    expect(r.warnings[0]!.message).toContain("STRIPE_KEY");
  });

  test("variables that have a source, or mean nothing to the owner, are not reported", () => {
    const src = "process.env.STRIPE_KEY; process.env.DATABASE_URL; process.env.TAU_API_KEY; process.env.NODE_ENV; process.env.PORT";
    const r = run("database", database({ "server/a.ts": src }), { secretNames: ["STRIPE_KEY"], aiEnabled: true });

    expect(r.warnings).toEqual([]);
    expect(r.env).toEqual([
      { name: "STRIPE_KEY", source: "secret" },
      { name: "DATABASE_URL", source: "platform" },
      { name: "TAU_API_KEY", source: "tau" },
      { name: "TAU_AI_URL", source: "tau" },
      { name: "TAU_API_URL", source: "tau" },
      { name: "TAU_PROJECT_ID", source: "tau" },
    ]);
  });

  test("tau's keys have no source until AI is switched on", () => {
    const r = run("api", api({ "server/a.ts": "process.env.TAU_API_KEY" }));
    expect(codes(r.warnings)).toEqual(["env_missing"]);
  });

  test("a database URL is only supplied to a database app", () => {
    expect(codes(run("api", api({ "server/a.ts": "process.env.DATABASE_URL" })).warnings)).toEqual(["env_missing"]);
  });

  test("close to the cap is a warning, not a blocker", () => {
    const r = run("api", api(), { secretNames: ["KEY"], envValueBytes: { KEY: 3700 } });
    expect(r.blockers).toEqual([]);
    expect(codes(r.warnings)).toEqual(["env_near_limit"]);
  });
});

describe("the report", () => {
  test("blockers and warnings are kept apart, and a blocked app still lists its warnings", () => {
    const r = run("api", api({ "server/a.ts": "Bun.file('x')", "server/b.ts": "setInterval(() => {}, 1)" }));
    expect(codes(r.blockers)).toEqual(["bun_api"]);
    expect(codes(r.warnings)).toEqual(["scheduled_work"]);
  });

  test("files are listed in a stable order", () => {
    const r = run("api", api({ "server/z.ts": "Bun.x", "server/a.ts": "Bun.y" }));
    expect(r.blockers[0]!.files).toEqual(["server/a.ts", "server/z.ts"]);
  });

  test("non-source files under server/ are not read", () => {
    expect(run("api", api({ "server/README.md": "Bun.file is great, upgradeWebSocket too" })).blockers).toEqual([]);
  });
});
