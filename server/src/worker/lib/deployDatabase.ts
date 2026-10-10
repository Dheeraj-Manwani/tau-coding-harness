/**
 * The database half of publishing an app that has one (doc/PUBLISHING.md Phase 5):
 * reading the app's schema, comparing it with what is live, making sure the app's
 * own Postgres exists, and producing the production `server/db/client.ts`.
 *
 * Everything here happens before anything is bundled or uploaded, so a schema
 * change the owner has not confirmed costs nothing and touches nothing.
 */
import { prisma } from "@/lib/prisma";
import { branchDatabase, ensureDatabase } from "@/lib/neonApps";
import { log } from "@/api/lib/log";
import { DeployError } from "./deploy";
import { WORK_DIR, type Sandbox } from "./sandbox";
import { extractInitSql, productionDbClient, schemaHash } from "./deployTransforms";
import { diffSchema, type SchemaChange } from "./schemaChange";

const CLIENT_PATH = "server/db/client.ts";

/** The publish stopped because the database changed in a way that needs the owner's yes. */
export class SchemaChangeRequired extends DeployError {
  constructor(readonly changes: SchemaChange[]) {
    super(
      "The structure of your database changed in a way that cannot be applied automatically. " +
        "Nothing was published, so your site is as it was. Review the changes below; if you publish anyway, " +
        "tau takes a restore point first, adds what is new, and leaves existing data as it is.",
    );
    this.name = "SchemaChangeRequired";
  }
}

export interface PreparedDatabase {
  /** The production `server/db/client.ts`, with any columns tau adds itself. */
  clientTs: string;
  /** The app's connection string (Neon's pooled one). */
  url: string;
  /** The SQL as published and its hash, stored on the deployment. */
  sql: string;
  hash: string;
  /** A restore point taken because the owner confirmed a change. */
  branchId: string | null;
  /** What was added on the owner's behalf, for the publish log. */
  additive: string[];
}

export async function prepareDatabase(
  sandbox: Sandbox,
  opts: { projectId: string; jobId: string; confirmed: boolean },
): Promise<PreparedDatabase> {
  let source: string;
  try {
    source = await sandbox.files.read(`${WORK_DIR}/${CLIENT_PATH}`);
  } catch {
    throw new DeployError(`${CLIENT_PATH} is missing, so there is no database to publish. Ask the agent to restore it, then publish again.`);
  }
  const sql = extractInitSql(source);
  if (sql === null) {
    throw new DeployError(
      "Tau could not read your database tables from initDb() in server/db/client.ts. Keep the table SQL as plain text in one client.exec() call, then publish again.",
    );
  }
  const hash = schemaHash(sql);

  // What the live deployment published, if anything.
  const project = await prisma.project.findUniqueOrThrow({ where: { id: opts.projectId }, select: { liveDeploymentId: true } });
  const live = project.liveDeploymentId
    ? await prisma.deployment.findUnique({ where: { id: project.liveDeploymentId }, select: { schemaSql: true, schemaHash: true } })
    : null;

  const diff = live?.schemaSql && live.schemaHash !== hash ? diffSchema(live.schemaSql, sql) : { additive: [], changes: [] };
  if (diff.changes.length > 0 && !opts.confirmed) throw new SchemaChangeRequired(diff.changes);

  const { url, created } = await ensureDatabase(opts.projectId);
  log.info("deploy.database.ready", { jobId: opts.jobId, projectId: opts.projectId, created, additive: diff.additive.length, changes: diff.changes.length });

  // Confirmed: a restore point first, then carry on.
  const branchId = diff.changes.length > 0 ? await branchDatabase(opts.projectId, `before-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`) : null;

  const clientTs = productionDbClient(source, diff.additive);
  if (clientTs === null) throw new DeployError("Tau could not prepare the production database client. Ask the agent to check server/db/client.ts, then publish again.");
  return { clientTs, url, sql, hash, branchId, additive: diff.additive };
}
