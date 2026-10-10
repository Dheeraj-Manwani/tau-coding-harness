/**
 * A published app's backend on AWS Lambda (doc/PUBLISHING.md D1, C3, C8, C9).
 *
 * One function per app, with its own execution role, on the managed Node
 * runtime. Every publish makes an immutable **version** and gives it its own
 * **alias** with its own Function URL (IAM auth, response streaming). Because
 * each deployment has its own address, the routing record alone decides which
 * backend is live: activation and rollback are a write to KV and need no call
 * to AWS.
 *
 * Everything this module touches is named `tau-app-{projectId}` (the function,
 * the role under the `/tau-apps/` path, the log group), which is what the
 * credentials are scoped to. Each resource is written to `ProjectResource`
 * **before** it is created, so a publish that dies half way leaves a record that
 * cleanup can follow, and every delete tolerates a resource that is not there.
 *
 * The AWS calls sit behind `AwsApi` so the flow can be tested without a cloud.
 * Nothing here has run against real AWS yet: that is Phase 4's proof step.
 */
import {
  CreateAliasCommand,
  CreateFunctionCommand,
  CreateFunctionUrlConfigCommand,
  DeleteAliasCommand,
  DeleteFunctionCommand,
  DeleteFunctionUrlConfigCommand,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  LambdaClient,
  ListAliasesCommand,
  ListVersionsByFunctionCommand,
  PutFunctionConcurrencyCommand,
  UpdateAliasCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionActiveV2,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import {
  CreateRoleCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  FilterLogEventsCommand,
  PutRetentionPolicyCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { env } from "@/lib/env";
import { redactAppLogs } from "@/lib/appLogs";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/log";
import { ResourceKind } from "@/generated/prisma/enums";

const { log } = createLogger("lambda");

// ── Configuration ────────────────────────────────────────────────────────────

export interface HostingConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  boundaryArn: string | null;
  reservedConcurrency: number;
  memoryMb: number;
  timeoutS: number;
  logRetentionDays: number;
}

/** The settings, or null where backend hosting is off or not fully configured. */
export function hostingConfig(): HostingConfig | null {
  if (!env.BACKEND_HOSTING_ENABLED) return null;
  const { AWS_APPS_REGION: region, AWS_APPS_ACCESS_KEY_ID: accessKeyId, AWS_APPS_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!region || !accessKeyId || !secretAccessKey) return null;
  return {
    region,
    accessKeyId,
    secretAccessKey,
    boundaryArn: env.AWS_APPS_PERMISSIONS_BOUNDARY_ARN ?? null,
    reservedConcurrency: env.AWS_APPS_RESERVED_CONCURRENCY,
    memoryMb: env.AWS_APPS_MEMORY_MB,
    timeoutS: env.AWS_APPS_TIMEOUT_S,
    logRetentionDays: env.AWS_APPS_LOG_RETENTION_DAYS,
  };
}

// ── Names ────────────────────────────────────────────────────────────────────

export const RUNTIME = "nodejs24.x" as const;
export const ARCHITECTURE = "arm64" as const;
export const ROLE_PATH = "/tau-apps/";

/** Everything for a project shares this name; the credentials are scoped to the `tau-app-` prefix. */
export function functionName(projectId: string): string {
  return `tau-app-${projectId}`;
}

export function logGroupName(projectId: string): string {
  return `/aws/lambda/${functionName(projectId)}`;
}

/** One alias per deployment. Aliases cannot be only digits, so it is prefixed. */
export function aliasName(deploymentId: string): string {
  return `d-${deploymentId}`;
}

// ── The environment a function is given ──────────────────────────────────────

/** Lambda rejects these, and anything starting `AWS_`, as environment variable names. */
const RESERVED_ENV = new Set([
  "_HANDLER",
  "_X_AMZN_TRACE_ID",
  "LAMBDA_RUNTIME_DIR",
  "LAMBDA_TASK_ROOT",
  "TZ_OVERRIDE",
]);

/** Lambda's cap on all environment variables together, names and values. */
export const ENV_LIMIT_BYTES = 4096;

export class LambdaEnvError extends Error {}

/**
 * Check a function's environment can be set, before anything is created.
 *
 * Names Lambda reserves would fail the publish with an AWS error the owner
 * cannot read; the 4 KB total is the same cap preflight warns about, checked
 * here against the real values.
 */
export function validateLambdaEnv(vars: Record<string, string>): void {
  const bad = Object.keys(vars).filter((n) => n.startsWith("AWS_") || RESERVED_ENV.has(n));
  if (bad.length > 0) {
    throw new LambdaEnvError(
      `${bad.join(", ")} can't be used as ${bad.length === 1 ? "a key name" : "key names"} in a published app: AWS reserves ${bad.length === 1 ? "it" : "them"}. Rename ${bad.length === 1 ? "it" : "them"} and update where your server reads ${bad.length === 1 ? "it" : "them"}.`,
    );
  }
  const total = Object.entries(vars).reduce((sum, [k, v]) => sum + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
  if (total > ENV_LIMIT_BYTES) {
    throw new LambdaEnvError(
      `Your keys and settings add up to ${total} bytes, over the ${ENV_LIMIT_BYTES}-byte limit for a published app. Remove some, or shorten the long ones.`,
    );
  }
}

// ── The thin AWS surface ─────────────────────────────────────────────────────

export interface FunctionSettings {
  roleArn: string;
  memoryMb: number;
  timeoutS: number;
  env: Record<string, string>;
}

export interface AwsApi {
  createRole(name: string, boundaryArn: string | null): Promise<{ arn: string; accountId: string }>;
  getRole(name: string): Promise<{ arn: string; accountId: string } | null>;
  putLogsPolicy(roleName: string, logGroupArn: string): Promise<void>;
  deleteRolePolicy(roleName: string): Promise<void>;
  deleteRole(roleName: string): Promise<void>;

  createLogGroup(name: string, retentionDays: number): Promise<void>;
  deleteLogGroup(name: string): Promise<void>;
  /** The most recent log lines of a group since a time, oldest first. */
  recentLogs(name: string, sinceMs: number, limit: number): Promise<string[]>;

  functionExists(name: string): Promise<boolean>;
  /** Creates the function and publishes its first version. */
  createFunction(name: string, zip: Uint8Array, s: FunctionSettings): Promise<{ version: string }>;
  updateConfiguration(name: string, s: FunctionSettings): Promise<void>;
  /** Replaces the code and publishes a new version. */
  updateCode(name: string, zip: Uint8Array): Promise<{ version: string }>;
  putConcurrency(name: string, reserved: number): Promise<void>;

  createAlias(name: string, alias: string, version: string): Promise<void>;
  /** Points an existing alias at another version; its function URL stays the same. */
  updateAlias(name: string, alias: string, version: string): Promise<void>;
  /** The zip a published version was made from. */
  getVersionCode(name: string, version: string): Promise<Uint8Array>;
  createUrl(name: string, alias: string): Promise<{ url: string }>;
  deleteUrl(name: string, alias: string): Promise<void>;
  deleteAlias(name: string, alias: string): Promise<void>;
  listAliases(name: string): Promise<{ alias: string; version: string }[]>;
  listVersions(name: string): Promise<string[]>;
  deleteVersion(name: string, version: string): Promise<void>;
  deleteFunction(name: string): Promise<void>;
}

const errorName = (err: unknown): string => (err as { name?: string })?.name ?? "";
const errorMessage = (err: unknown): string => (err as { message?: string })?.message ?? String(err);

/** The thing is not there. Deleting it twice is not an error. */
export function isNotFound(err: unknown): boolean {
  return ["ResourceNotFoundException", "NoSuchEntityException", "NoSuchEntity"].includes(errorName(err));
}

/** IAM is eventually consistent: a role created a moment ago may not be assumable by Lambda yet. */
export function isRoleNotReady(err: unknown): boolean {
  return errorName(err) === "InvalidParameterValueException" && /cannot be assumed by Lambda/i.test(errorMessage(err));
}

/** The real calls, through the SDK, with the credentials from `hostingConfig`. */
export function awsApi(config: HostingConfig): AwsApi {
  const credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
  const lambda = new LambdaClient({ region: config.region, credentials });
  const iam = new IAMClient({ region: config.region, credentials });
  const logs = new CloudWatchLogsClient({ region: config.region, credentials });

  const waitFor = (name: string) => waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: name });
  const configuration = (s: FunctionSettings) => ({
    Role: s.roleArn,
    Handler: "index.handler",
    Runtime: RUNTIME,
    MemorySize: s.memoryMb,
    Timeout: s.timeoutS,
    Environment: { Variables: s.env },
  });

  return {
    async createRole(name, boundaryArn) {
      const res = await iam.send(
        new CreateRoleCommand({
          Path: ROLE_PATH,
          RoleName: name,
          Description: "Execution role for a published tau app",
          AssumeRolePolicyDocument: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
          }),
          ...(boundaryArn ? { PermissionsBoundary: boundaryArn } : {}),
        }),
      );
      const arn = res.Role!.Arn!;
      return { arn, accountId: arn.split(":")[4]! };
    },
    async getRole(name) {
      try {
        const res = await iam.send(new GetRoleCommand({ RoleName: name }));
        const arn = res.Role!.Arn!;
        return { arn, accountId: arn.split(":")[4]! };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async putLogsPolicy(roleName, logGroupArn) {
      await iam.send(
        new PutRolePolicyCommand({
          RoleName: roleName,
          PolicyName: "logs",
          // Its own log group, and nothing else: no CreateLogGroup, no other group.
          PolicyDocument: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: `${logGroupArn}:*` }],
          }),
        }),
      );
    },
    async deleteRolePolicy(roleName) {
      await iam.send(new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: "logs" }));
    },
    async deleteRole(roleName) {
      await iam.send(new DeleteRoleCommand({ RoleName: roleName }));
    },

    async createLogGroup(name, retentionDays) {
      try {
        await logs.send(new CreateLogGroupCommand({ logGroupName: name }));
      } catch (err) {
        if (errorName(err) !== "ResourceAlreadyExistsException") throw err;
      }
      // Without this a log group keeps everything for ever (C12).
      await logs.send(new PutRetentionPolicyCommand({ logGroupName: name, retentionInDays: retentionDays }));
    },
    async deleteLogGroup(name) {
      await logs.send(new DeleteLogGroupCommand({ logGroupName: name }));
    },
    async recentLogs(name, sinceMs, limit) {
      const res = await logs.send(new FilterLogEventsCommand({ logGroupName: name, startTime: sinceMs, limit }));
      return (res.events ?? []).map((e) => (e.message ?? "").trimEnd());
    },

    async functionExists(name) {
      try {
        await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name }));
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
    async createFunction(name, zip, s) {
      const res = await lambda.send(
        new CreateFunctionCommand({
          FunctionName: name,
          ...configuration(s),
          Architectures: [ARCHITECTURE],
          Code: { ZipFile: zip },
          Publish: true,
        }),
      );
      await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: name });
      return { version: res.Version! };
    },
    async updateConfiguration(name, s) {
      await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: name, ...configuration(s) }));
      await waitFor(name);
    },
    async updateCode(name, zip) {
      const res = await lambda.send(
        new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: zip, Architectures: [ARCHITECTURE], Publish: true }),
      );
      await waitFor(name);
      return { version: res.Version! };
    },
    async putConcurrency(name, reserved) {
      await lambda.send(new PutFunctionConcurrencyCommand({ FunctionName: name, ReservedConcurrentExecutions: reserved }));
    },

    async createAlias(name, alias, version) {
      await lambda.send(new CreateAliasCommand({ FunctionName: name, Name: alias, FunctionVersion: version }));
    },
    async updateAlias(name, alias, version) {
      await lambda.send(new UpdateAliasCommand({ FunctionName: name, Name: alias, FunctionVersion: version }));
    },
    async getVersionCode(name, version) {
      const res = await lambda.send(new GetFunctionCommand({ FunctionName: name, Qualifier: version }));
      const location = res.Code?.Location;
      if (!location) throw new Error(`No code location for ${name}:${version}`);
      const download = await fetch(location, { signal: AbortSignal.timeout(60_000) });
      if (!download.ok) throw new Error(`Downloading ${name}:${version} answered ${download.status}`);
      return new Uint8Array(await download.arrayBuffer());
    },
    async createUrl(name, alias) {
      const res = await lambda.send(
        new CreateFunctionUrlConfigCommand({
          FunctionName: name,
          Qualifier: alias,
          AuthType: "AWS_IAM",
          InvokeMode: "RESPONSE_STREAM",
        }),
      );
      return { url: res.FunctionUrl!.replace(/\/+$/, "") };
    },
    async deleteUrl(name, alias) {
      await lambda.send(new DeleteFunctionUrlConfigCommand({ FunctionName: name, Qualifier: alias }));
    },
    async deleteAlias(name, alias) {
      await lambda.send(new DeleteAliasCommand({ FunctionName: name, Name: alias }));
    },
    async listAliases(name) {
      const out: { alias: string; version: string }[] = [];
      let marker: string | undefined;
      do {
        const res = await lambda.send(new ListAliasesCommand({ FunctionName: name, Marker: marker }));
        for (const a of res.Aliases ?? []) out.push({ alias: a.Name!, version: a.FunctionVersion! });
        marker = res.NextMarker;
      } while (marker);
      return out;
    },
    async listVersions(name) {
      const out: string[] = [];
      let marker: string | undefined;
      do {
        const res = await lambda.send(new ListVersionsByFunctionCommand({ FunctionName: name, Marker: marker }));
        for (const v of res.Versions ?? []) if (v.Version && v.Version !== "$LATEST") out.push(v.Version);
        marker = res.NextMarker;
      } while (marker);
      return out;
    },
    async deleteVersion(name, version) {
      await lambda.send(new DeleteFunctionCommand({ FunctionName: name, Qualifier: version }));
    },
    async deleteFunction(name) {
      await lambda.send(new DeleteFunctionCommand({ FunctionName: name }));
    },
  };
}

// ── The flow ─────────────────────────────────────────────────────────────────

interface Deps {
  api: () => { api: AwsApi; config: HostingConfig } | null;
  sleep: (ms: number) => Promise<void>;
}

const realDeps: Deps = {
  api: () => {
    const config = hostingConfig();
    return config ? { api: awsApi(config), config } : null;
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
let deps: Deps = realDeps;

/** Tests hand in a stub of AWS. Pass null to put the real one back. */
export function setLambdaDepsForTests(next: Partial<Deps> | null): void {
  deps = next ? { ...realDeps, ...next } : realDeps;
}

function need(): { api: AwsApi; config: HostingConfig } {
  const have = deps.api();
  if (!have) throw new Error("Backend hosting is not configured.");
  return have;
}

/** Whether publishing a backend is possible at all on this server. */
export function backendHostingAvailable(): boolean {
  return deps.api() !== null;
}

/** Record a resource before it is created. Idempotent: a retry finds the row it left. */
async function recordResource(projectId: string, kind: ResourceKind, providerId: string, region: string) {
  await prisma.projectResource.upsert({
    where: { kind_providerId: { kind, providerId } },
    create: { projectId, kind, providerId, region },
    // A resource removed earlier and made again is live again.
    update: { deletedAt: null },
  });
}

async function markDeleted(kind: ResourceKind, providerId: string) {
  await prisma.projectResource.updateMany({ where: { kind, providerId, deletedAt: null }, data: { deletedAt: new Date() } });
}

async function liveResource(projectId: string, kind: ResourceKind) {
  return prisma.projectResource.findFirst({ where: { projectId, kind, deletedAt: null } });
}

/** `createFunction` straight after `createRole` can be refused while IAM catches up. Retry, bounded. */
async function whenRoleReady<T>(run: () => Promise<T>): Promise<T> {
  const waits = [2_000, 3_000, 5_000, 8_000, 10_000, 10_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isRoleNotReady(err) || attempt >= waits.length) throw err;
      log.info("lambda.role_not_ready", { attempt: attempt + 1 });
      await deps.sleep(waits[attempt]!);
    }
  }
}

export interface PublishedBackend {
  functionName: string;
  version: string;
  alias: string;
  /** The Function URL for this deployment's alias, no trailing slash. */
  url: string;
}

/**
 * Put a bundle on Lambda as this deployment's backend. Nothing live changes:
 * the new alias has its own URL, and nothing points at it until activation.
 *
 * First publish for a project creates the role, the log group and the
 * function; later ones update the function's configuration (so the new version
 * carries the current environment) and its code. Either way a version is
 * published, given an alias named for the deployment, and given a Function URL.
 */
export async function publishBackend(args: {
  projectId: string;
  deploymentId: string;
  zip: Uint8Array;
  env: Record<string, string>;
}): Promise<PublishedBackend> {
  validateLambdaEnv(args.env);
  const { api, config } = need();
  const fn = functionName(args.projectId);
  const alias = aliasName(args.deploymentId);

  // Whether the function is really there, not whether a row says so: a publish
  // that died after recording it and before creating it must be able to start
  // over, and one that finished must not try to create it again.
  const exists = (await liveResource(args.projectId, ResourceKind.LAMBDA_FUNCTION)) !== null && (await api.functionExists(fn));
  let version: string;

  if (!exists) {
    // The role first, then the log group it may write to, then the function.
    await recordResource(args.projectId, ResourceKind.IAM_ROLE, fn, config.region);
    const role = (await api.getRole(fn)) ?? (await api.createRole(fn, config.boundaryArn));

    await api.createLogGroup(logGroupName(args.projectId), config.logRetentionDays);
    await api.putLogsPolicy(fn, `arn:aws:logs:${config.region}:${role.accountId}:log-group:${logGroupName(args.projectId)}`);

    await recordResource(args.projectId, ResourceKind.LAMBDA_FUNCTION, fn, config.region);
    const settings: FunctionSettings = { roleArn: role.arn, memoryMb: config.memoryMb, timeoutS: config.timeoutS, env: args.env };
    ({ version } = await whenRoleReady(() => api.createFunction(fn, args.zip, settings)));

    if (config.reservedConcurrency > 0) {
      // A cap on what one app can take from the account. A small new account may be
      // refused: the publish still succeeds, and the missing cap is logged loudly.
      await api.putConcurrency(fn, config.reservedConcurrency).catch((err) =>
        log.warn("lambda.concurrency_not_set", { function: fn, error: errorMessage(err).slice(0, 200) }),
      );
    }
  } else {
    const role = await api.getRole(fn);
    if (!role) throw new Error(`The function ${fn} exists but its role does not. Remove the function in AWS, then publish again.`);
    // Configuration first, so the version published next carries the current environment.
    await api.updateConfiguration(fn, { roleArn: role.arn, memoryMb: config.memoryMb, timeoutS: config.timeoutS, env: args.env });
    ({ version } = await api.updateCode(fn, args.zip));
  }

  await api.createAlias(fn, alias, version);
  const { url } = await api.createUrl(fn, alias);
  log.info("lambda.published", { projectId: args.projectId, function: fn, version, alias });
  return { functionName: fn, version, alias, url };
}

/**
 * Give a live deployment a new environment without a rebuild (doc/PUBLISHING.md C7).
 *
 * A version's environment is fixed when it is published, so this takes the code of
 * the version the deployment's alias points at, publishes it again with the new
 * environment, and moves the alias to the result. The alias keeps its function URL,
 * so the routing record is untouched. Older deployments keep the environment they
 * were published with.
 */
export async function refreshBackendEnv(args: { projectId: string; deploymentId: string; env: Record<string, string> }): Promise<{ version: string }> {
  validateLambdaEnv(args.env);
  const { api, config } = need();
  const fn = functionName(args.projectId);
  const alias = aliasName(args.deploymentId);

  const current = (await api.listAliases(fn)).find((a) => a.alias === alias);
  if (!current) throw new Error("This version's server is no longer deployed. Publish again.");
  const role = await api.getRole(fn);
  if (!role) throw new Error(`The function ${fn} exists but its role does not.`);

  const zip = await api.getVersionCode(fn, current.version);
  await api.updateConfiguration(fn, { roleArn: role.arn, memoryMb: config.memoryMb, timeoutS: config.timeoutS, env: args.env });
  const { version } = await api.updateCode(fn, zip);
  await api.updateAlias(fn, alias, version);
  log.info("lambda.env_refreshed", { projectId: args.projectId, function: fn, from: current.version, version });
  return { version };
}

/**
 * What the function logged lately, as text, for a failed publish's build log so
 * "Fix with tau" has the server's own error to work from. Empty when there is
 * nothing, when AWS cannot be asked, or when hosting is off: it is a help, never
 * a reason for a failure to be reported differently.
 */
export async function recentBackendLogs(projectId: string, sinceMs: number): Promise<string> {
  const have = deps.api();
  if (!have) return "";
  try {
    const lines = await have.api.recentLogs(logGroupName(projectId), sinceMs, 60);
    // Lambda's own START / END / REPORT lines say nothing about the app.
    const text = lines.filter((l) => l && !/^(START|END|REPORT|INIT_START) /.test(l)).join("\n");
    const clipped = text.length <= 4_000 ? text : `…\n${text.slice(-4_000)}`;
    return await redactAppLogs(projectId, clipped);
  } catch (err) {
    log.warn("lambda.logs_failed", { projectId, error: errorMessage(err).slice(0, 200) });
    return "";
  }
}

/**
 * Throw away what no deployment can be rolled back to any more: aliases (and
 * their URLs) for deployments not in `keepDeploymentIds`, then versions no
 * alias refers to. The function's `$LATEST` is never touched.
 */
export async function pruneBackend(projectId: string, keepDeploymentIds: Set<string>): Promise<{ aliases: number; versions: number }> {
  const have = deps.api();
  if (!have) return { aliases: 0, versions: 0 };
  const { api } = have;
  const fn = functionName(projectId);
  let aliases: { alias: string; version: string }[];
  try {
    aliases = await api.listAliases(fn);
  } catch (err) {
    if (isNotFound(err)) return { aliases: 0, versions: 0 };
    throw err;
  }
  const keep = new Set([...keepDeploymentIds].map(aliasName));

  let removedAliases = 0;
  const kept: { alias: string; version: string }[] = [];
  for (const a of aliases) {
    if (!a.alias.startsWith("d-") || keep.has(a.alias)) {
      kept.push(a);
      continue;
    }
    await api.deleteUrl(fn, a.alias).catch((e) => {
      if (!isNotFound(e)) throw e;
    });
    await api.deleteAlias(fn, a.alias).catch((e) => {
      if (!isNotFound(e)) throw e;
    });
    removedAliases += 1;
  }

  const inUse = new Set(kept.map((a) => a.version));
  let removedVersions = 0;
  for (const version of await api.listVersions(fn)) {
    if (inUse.has(version)) continue;
    await api.deleteVersion(fn, version).catch((e) => {
      if (!isNotFound(e)) throw e;
    });
    removedVersions += 1;
  }
  return { aliases: removedAliases, versions: removedVersions };
}

/**
 * Remove everything a project has in AWS: the function (which takes its
 * versions, aliases and URLs with it), the log group, and the role. Every step
 * tolerates the resource already being gone, and records what it removed.
 */
export async function removeBackend(projectId: string): Promise<void> {
  const have = deps.api();
  if (!have) return;
  const { api } = have;
  const fn = functionName(projectId);
  const gone = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  };

  // Aliases and their URLs first, so none is left pointing at a deleted function.
  const aliases = await api.listAliases(fn).catch((e) => (isNotFound(e) ? [] : Promise.reject(e)));
  for (const a of aliases) {
    await gone(() => api.deleteUrl(fn, a.alias));
    await gone(() => api.deleteAlias(fn, a.alias));
  }
  await gone(() => api.deleteFunction(fn));
  await markDeleted(ResourceKind.LAMBDA_FUNCTION, fn);

  await gone(() => api.deleteLogGroup(logGroupName(projectId)));

  await gone(() => api.deleteRolePolicy(fn));
  await gone(() => api.deleteRole(fn));
  await markDeleted(ResourceKind.IAM_ROLE, fn);
  log.info("lambda.removed", { projectId, function: fn });
}
