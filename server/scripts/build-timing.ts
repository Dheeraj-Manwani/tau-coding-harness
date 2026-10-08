/**
 * Where a build's time went: the model thinking, the sandbox setting up, the
 * agent's tools, the design review.
 *
 *   bun run scripts/build-timing.ts <jobId> [<jobId> ...]
 *   bun run scripts/build-timing.ts --project <projectId>     (its first job)
 *
 * A build is a loop of a model turn and the tool calls it asked for. Tool calls
 * are timed (`ToolCall.startedAt` to `completedAt`); whatever is left of the
 * job's wall-clock time is the model, plus the small waits between turns.
 * Sub-agents and the design review run inside a single tool call, so they show
 * up as that call. Read-only: it touches nothing.
 */
import { prisma } from "@/lib/prisma";

const TOOL_GROUPS: [string, (name: string) => boolean][] = [
  ["sandbox setup", (n) => n === "provision_sandbox" || n === "add_backend" || n === "add_database"],
  ["design review", (n) => n === "dispatch_design_reviewer"],
  ["other sub-agents", (n) => n.startsWith("dispatch_")],
  ["running commands", (n) => n === "run_command"],
  ["writing files", (n) => ["create_file", "edit_file", "write_file", "delete_file"].includes(n)],
  ["reading and searching", (n) => ["read_file", "grep", "list_files", "search_images", "image_dimensions", "web_search", "read_doc", "search_history", "download_asset"].includes(n)],
];

const fmt = (ms: number) => `${(ms / 1000).toFixed(0)}s`;

async function report(jobId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { startedAt: true, completedAt: true, effort: true, currentTurn: true, project: { select: { name: true } } },
  });
  if (!job?.startedAt || !job.completedAt) return `${jobId}: not finished`;
  const total = job.completedAt.getTime() - job.startedAt.getTime();

  const calls = await prisma.toolCall.findMany({
    where: { message: { jobId }, startedAt: { not: null }, completedAt: { not: null } },
    select: { toolName: true, startedAt: true, completedAt: true },
  });
  const byGroup = new Map<string, { ms: number; n: number }>();
  let toolMs = 0;
  for (const c of calls) {
    const ms = c.completedAt!.getTime() - c.startedAt!.getTime();
    toolMs += ms;
    const group = TOOL_GROUPS.find(([, test]) => test(c.toolName))?.[0] ?? "other tools";
    const entry = byGroup.get(group) ?? { ms: 0, n: 0 };
    entry.ms += ms;
    entry.n++;
    byGroup.set(group, entry);
  }
  const modelMs = Math.max(0, total - toolMs);
  const lines = [
    `${job.project.name} (${job.effort}) ${fmt(total)} over ${job.currentTurn} turns, ${calls.length} tool calls`,
    `  ${"the model, between tools".padEnd(24)} ${fmt(modelMs).padStart(5)} ${String(Math.round((modelMs / total) * 100)).padStart(3)}%`,
    ...[...byGroup.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([group, { ms, n }]) => `  ${`${group} (${n})`.padEnd(24)} ${fmt(ms).padStart(5)} ${String(Math.round((ms / total) * 100)).padStart(3)}%`),
  ];
  return lines.join("\n");
}

const args = process.argv.slice(2);
let ids = args;
if (args[0] === "--project") {
  ids = (await prisma.job.findMany({ where: { projectId: args[1] }, orderBy: { queuedAt: "asc" }, take: 1, select: { id: true } })).map((j) => j.id);
}
for (const id of ids) console.log(await report(id), "\n");
await prisma.$disconnect();
