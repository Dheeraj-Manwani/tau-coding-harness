/**
 * Can this app's server be published? Answered before anything is built or
 * provisioned, from the project's files alone.
 *
 * Generated code is only ever run under Bun against PGlite in a sandbox. A
 * published backend is a bundle on a managed Node runtime against a network
 * database, so some things that work in preview cannot work there. Each is
 * caught here with a sentence the owner can act on, instead of surfacing as a
 * 500 on a live URL (doc/PUBLISHING.md C3, C5, C7).
 *
 * Pure: input is file contents and names, output is a report. Not exposed in
 * the API or the panel in Phase 1; `scripts/preflight.ts` runs it against a
 * stored project.
 */
import { extractInitSql } from "./deployTransforms";

export type Level = "frontend" | "api" | "database";

export interface Issue {
  /** Stable name, for tests and later for the panel. */
  code: string;
  /** A sentence a non-developer can act on. */
  message: string;
  /** Files it was found in, when that helps. */
  files?: string[];
}

export type EnvSource = "secret" | "platform" | "tau";

export interface PreflightInput {
  level: Level;
  /** `package.json` and every file under `server/`, by project-relative path. */
  files: Record<string, string>;
  /** Names of the project's `ProjectSecret` rows. */
  secretNames: string[];
  aiEnabled: boolean;
  /** `Project.storageEnabled`: the app has tau file storage and a live key will be injected. */
  storageEnabled?: boolean;
  /** Byte length of each injected variable's value, when known. Estimated when not. */
  envValueBytes?: Record<string, number>;
}

export interface PreflightReport {
  level: Level;
  blockers: Issue[];
  warnings: Issue[];
  /** What the published app will be given, and where each comes from. */
  env: { name: string; source: EnvSource }[];
}

/** Lambda caps all environment variables together at 4 KB. */
export const ENV_LIMIT_BYTES = 4096;
const ENV_WARN_BYTES = 3500;

/** Set by tau when `Project.aiEnabled`; same names `buildAiEnv` writes. */
export const TAU_MANAGED_ENV = ["TAU_API_KEY", "TAU_AI_URL", "TAU_API_URL", "TAU_PROJECT_ID"] as const;

/** Set by tau when `Project.storageEnabled`; the same names `buildStorageEnv` writes. */
export const TAU_STORAGE_ENV = ["TAU_STORAGE_KEY", "TAU_STORAGE_URL"] as const;

/** Names a runtime provides or that mean nothing to a user. Never reported. */
const IGNORED_ENV = new Set(["NODE_ENV", "PORT", "TZ", "HOME", "PATH"]);

/** What a value is assumed to weigh when its real size is not known. */
const ESTIMATED_VALUE_BYTES: Record<string, number> = {
  DATABASE_URL: 220,
  TAU_API_KEY: 64,
  TAU_AI_URL: 40,
  TAU_API_URL: 40,
  TAU_PROJECT_ID: 36,
  TAU_STORAGE_KEY: 56,
  TAU_STORAGE_URL: 60,
};

const CLIENT_PATH = "server/db/client.ts";
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** Source with comments removed, so a comment that mentions `Bun.file` is not a use of it. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

interface Pattern {
  code: string;
  re: RegExp;
  message: string;
}

const BLOCKING: Pattern[] = [
  {
    code: "bun_api",
    re: /\bBun\s*\.|\bfrom\s*['"]bun['"]|['"]bun:[a-z]+['"]/,
    message:
      "Your server uses Bun-only features (Bun.* or bun: imports). Published apps run on Node, which does not have them. Ask tau to rewrite it with standard Node and web APIs.",
  },
  {
    code: "embedded_database",
    re: /['"](?:bun:sqlite|better-sqlite3|sqlite3|node:sqlite)['"]/,
    message:
      "Your server keeps data in a file-based SQLite database. A published app has no disk that lasts, so that data would be lost. Ask tau to use the project's Postgres database instead.",
  },
  {
    code: "websocket",
    re: /\bupgradeWebSocket\b|from\s*['"]hono\/ws['"]|from\s*['"]ws['"]|require\(\s*['"]ws['"]\s*\)|\bWebSocketServer\b/,
    message:
      "Your server uses WebSockets. Published apps can't hold a connection open, so they aren't supported. Ask tau to use regular requests, or polling, instead.",
  },
];

const WARNING: Pattern[] = [
  {
    code: "local_files",
    re: /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdirSync|rmSync|unlinkSync)\b/,
    message:
      "Your server writes files to disk. A published app can't keep them: anything written is gone by the next request. Keep small data in the database instead, and pictures or documents in tau file storage: ask tau to turn it on.",
  },
  {
    code: "scheduled_work",
    re: /\bsetInterval\s*\(|from\s*['"]node-cron['"]|from\s*['"]cron['"]/,
    message:
      "Your server runs work on a timer. A published app only runs while a request is being handled, so scheduled work won't happen on its own.",
  },
];

/** Names `import { … } from '<something>/client'`-style imports bring in from the db client. */
function importedFromClient(src: string, importer: string): { names: string[]; wholeModule: boolean } {
  const names: string[] = [];
  let wholeModule = false;
  const re = /\bimport\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    if (!isClientImport(m[2]!, importer)) continue;
    const clause = m[1]!.trim();
    if (clause.includes("* as") || /^[A-Za-z_$][\w$]*\s*(?:,|$)/.test(clause)) wholeModule = true;
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1]!.split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
        if (name) names.push(name);
      }
    }
  }
  return { names, wholeModule };
}

/** Does this import specifier, written in `importer`, resolve to `server/db/client.ts`? */
function isClientImport(spec: string, importer: string): boolean {
  if (!spec.startsWith(".")) return false;
  const parts = importer.split("/").slice(0, -1);
  for (const seg of spec.replace(/\.(?:[cm]?[jt]s)$/, "").split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `${parts.join("/")}.ts` === CLIENT_PATH || parts.join("/") === "server/db/client";
}

/** Environment names read in `src`: `process.env.X` and `process.env['X']`. */
function envNamesRead(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]!);
  for (const m of src.matchAll(/\bprocess\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g)) names.add(m[1]!);
  return [...names];
}

export function preflight(input: PreflightInput): PreflightReport {
  const { level, files } = input;
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];

  const serverFiles = Object.keys(files)
    .filter((p) => p.startsWith("server/") && SOURCE_FILE.test(p))
    .sort();
  const code = Object.fromEntries(serverFiles.map((p) => [p, stripComments(files[p]!)]));

  if (level !== "frontend") {
    const index = code["server/index.ts"];
    if (index === undefined) {
      blockers.push({
        code: "server_missing",
        message: "This project has a backend but no server/index.ts. Ask tau to add it back.",
      });
    } else if (!/\bexport\s+default\b/.test(index) || /\bexport\s+default\s*\{(?![^}]*\bfetch\b)/s.test(index)) {
      blockers.push({
        code: "no_default_export",
        message:
          "server/index.ts must end with `export default { port: 3000, fetch: app.fetch }` so it can be published. Ask tau to restore it.",
        files: ["server/index.ts"],
      });
    }

    const found = (re: RegExp, except?: string) =>
      serverFiles.filter((p) => p !== except && re.test(code[p]!));

    for (const rule of BLOCKING) {
      const at = found(rule.re);
      if (at.length > 0) blockers.push({ code: rule.code, message: rule.message, files: at });
    }
    // An embedded database can also be a dependency nothing imports yet.
    try {
      const deps = Object.keys({
        ...(JSON.parse(files["package.json"] ?? "{}") as { dependencies?: object }).dependencies,
      });
      if (deps.some((d) => d === "better-sqlite3" || d === "sqlite3") && !blockers.some((b) => b.code === "embedded_database")) {
        blockers.push({ code: "embedded_database", message: BLOCKING[1]!.message, files: ["package.json"] });
      }
    } catch {
      // A package.json that does not parse is the build's problem to report.
    }

    for (const rule of WARNING) {
      const at = found(rule.re, CLIENT_PATH);
      if (at.length > 0) warnings.push({ code: rule.code, message: rule.message, files: at });
    }
  }

  if (level === "database") {
    const pglite = serverFiles.filter((p) => p !== CLIENT_PATH && /@electric-sql\/pglite/.test(code[p]!));
    if (pglite.length > 0) {
      blockers.push({
        code: "pglite_outside_client",
        message:
          "The database is opened somewhere other than server/db/client.ts. Publishing swaps that one file for the real database, so the other copy would lose its data. Ask tau to use `db` from server/db/client.ts everywhere.",
        files: pglite,
      });
    }

    const client = files[CLIENT_PATH];
    if (client === undefined) {
      blockers.push({
        code: "client_missing",
        message: "This project has a database but no server/db/client.ts. Ask tau to restore it.",
      });
    } else {
      if (extractInitSql(client) === null) {
        blockers.push({
          code: "init_sql_unreadable",
          message:
            "Tau can't read how your tables are created in server/db/client.ts (initDb). It needs plain CREATE TABLE statements in one `client.exec(`…`)` call, with no `${}` inside. Ask tau to put them back in that form.",
          files: [CLIENT_PATH],
        });
      }
      const offenders: string[] = [];
      for (const p of serverFiles) {
        if (p === CLIENT_PATH) continue;
        const { names, wholeModule } = importedFromClient(code[p]!, p);
        if (wholeModule || names.some((n) => n !== "db" && n !== "initDb")) offenders.push(p);
      }
      if (offenders.length > 0) {
        blockers.push({
          code: "client_exports_used",
          message:
            "Your code uses more from server/db/client.ts than `db` and `initDb`. Publishing replaces that file, and only those two exist afterwards. Ask tau to use only those.",
          files: offenders,
        });
      }
    }
  }

  // ── Environment ──────────────────────────────────────────────────────────────

  const env: { name: string; source: EnvSource }[] = [];
  const seen = new Set<string>();
  const add = (name: string, source: EnvSource) => {
    if (!seen.has(name)) {
      seen.add(name);
      env.push({ name, source });
    }
  };
  for (const name of [...input.secretNames].sort()) add(name, "secret");
  if (level === "database") add("DATABASE_URL", "platform");
  if (input.aiEnabled) for (const name of TAU_MANAGED_ENV) add(name, "tau");
  if (input.storageEnabled) for (const name of TAU_STORAGE_ENV) add(name, "tau");

  if (level !== "frontend") {
    const unsourced = new Map<string, string[]>();
    const storageReaders: string[] = [];
    for (const p of serverFiles) {
      for (const name of envNamesRead(code[p]!)) {
        if (IGNORED_ENV.has(name) || seen.has(name)) continue;
        // Reading the storage variables with storage off is its own, firmer, problem.
        if ((TAU_STORAGE_ENV as readonly string[]).includes(name)) {
          if (!storageReaders.includes(p)) storageReaders.push(p);
          continue;
        }
        unsourced.set(name, [...(unsourced.get(name) ?? []), p]);
      }
    }
    if (storageReaders.length > 0) {
      blockers.push({
        code: "storage_not_enabled",
        message:
          "Your server uses tau file storage, but it isn't turned on for this app, so the published app would have no way to store a file. Ask tau to set up file storage, then publish again.",
        files: storageReaders,
      });
    }
    for (const [name, at] of [...unsourced].sort(([a], [b]) => a.localeCompare(b))) {
      warnings.push({
        code: "env_missing",
        message: `Your server reads ${name}, but no value has been added for it. That feature won't work on the published app until you add it.`,
        files: at,
      });
    }

    const total = env.reduce(
      (sum, { name }) => sum + name.length + (input.envValueBytes?.[name] ?? ESTIMATED_VALUE_BYTES[name] ?? 64),
      0,
    );
    if (total > ENV_LIMIT_BYTES) {
      blockers.push({
        code: "env_too_large",
        message: `Your keys and settings add up to ${total} bytes, over the ${ENV_LIMIT_BYTES}-byte limit for a published app. Remove some, or shorten the long ones.`,
      });
    } else if (total > ENV_WARN_BYTES) {
      warnings.push({
        code: "env_near_limit",
        message: `Your keys and settings are ${total} of the ${ENV_LIMIT_BYTES} bytes a published app allows. Adding more may stop it publishing.`,
      });
    }
  }

  return { level, blockers, warnings, env };
}
