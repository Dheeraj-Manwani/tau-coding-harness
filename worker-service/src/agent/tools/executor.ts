import { provisionSandbox } from "@/lib/sandbox";
import { publish } from "@/lib/publish";
import { redis } from "@/lib/redis";
import type { SandboxRef } from "../loop";
import type { Tool } from "./tools";
import { asString } from "./functions/utils";
import { createPlan } from "./functions/create-plan";
import { updateTodo } from "./functions/update-todos";
import { createFile } from "./functions/create";
import { editFile } from "./functions/edit";
import { readFile } from "./functions/read";
import { deleteFile } from "./functions/delete";
import { runCommand } from "./functions/run-command";
import { dispatchExplorer } from "./functions/dispatch-explorer";

export async function executeTool(
  name: Tool,
  input: unknown,
  sandboxRef: SandboxRef,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
): Promise<unknown> {
  console.log("tool call :: ", name, input);

  switch (name) {
    case "ask_user": {
      const { question, options } = input as {
        question?: unknown;
        options?: unknown;
      };
      const q = asString(question, "question");
      const opts = Array.isArray(options)
        ? (options as unknown[]).map((o) => asString(o, "options[]"))
        : [];

      await publish(
        jobId,
        { type: "ask_user", question: q, options: opts },
        indexer(),
      );

      const responseKey = `job:${jobId}:user_response`;
      const conn = redis.duplicate();
      try {
        const result = await conn.blpop(responseKey, 600); // 10 min timeout
        if (!result) return { answer: null, timedOut: true };
        const { answer } = JSON.parse(result[1]) as { answer: string };

        // The answer is returned as this tool call's result and persisted as
        // part of the standard TOOL_RES row by the agent loop — no separate
        // USER message row here, or the UI would render it twice.
        return { answer };
      } finally {
        await conn.quit();
      }
    }
    case "provision_sandbox": {
      if (!sandboxRef.current) {
        sandboxRef.current = await provisionSandbox(projectId, userId, jobId);
      }
      return { success: true };
    }
    case "create_plan":
      return createPlan(input, jobId, indexer);
    case "update_todo":
      return updateTodo(input, jobId, indexer);
    case "report_progress":
      return { success: true };
    default:
      break;
  }

  const sandbox = sandboxRef.current;
  if (!sandbox) {
    return { error: "Sandbox not provisioned. Call provision_sandbox first." };
  }

  switch (name) {
    case "create_file":
      return createFile(input, sandbox, jobId, projectId, userId, indexer);
    case "edit_file":
      return editFile(input, sandbox, jobId, projectId, userId, indexer);
    case "read_file":
      return readFile(input, sandbox);
    case "delete_file":
      return deleteFile(input, sandbox, jobId, projectId, indexer);
    case "run_command":
      return runCommand(input, sandbox);
    case "dispatch_explorer":
      return dispatchExplorer(input, sandbox);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
