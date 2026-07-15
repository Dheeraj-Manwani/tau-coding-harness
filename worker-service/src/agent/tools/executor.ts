import { SandboxNotFoundError } from "e2b";
import { provisionSandbox, SANDBOX_IDLE_TIMEOUT_MS } from "@/lib/sandbox";
import { isTemplateKey } from "@/templates/registry";
import { publish } from "@/lib/publish";
import { bus } from "@/lib/bus";
import type { SandboxRef } from "../loop";
import type { Tool } from "./tools";
import type { Effort } from "@/generated/prisma/enums";
import { asString } from "./functions/utils";
import { createPlan } from "./functions/create-plan";
import { updateTodo } from "./functions/update-todos";
import { addTodos } from "./functions/add-todos";
import { createFile } from "./functions/create";
import { editFile } from "./functions/edit";
import { readFile } from "./functions/read";
import { listDir } from "./functions/list-dir";
import { deleteFile } from "./functions/delete";
import { runCommand } from "./functions/run-command";
import { tailCommandOutput } from "./functions/tail-command-output";
import { waitForPort } from "./functions/wait-for-port";
import { checkSandbox } from "./functions/check-sandbox";
import { webSearch } from "./functions/web-search";
import {
  pushProjectToGithub,
  createGithubIssue,
  isPushMode,
} from "@/lib/github";
import { dispatchExplorer } from "./sub-agents/dispatch-explorer";
import { dispatchDebugger } from "./sub-agents/dispatch-debugger";
import { dispatchVerifier } from "./sub-agents/dispatch-verifier";
import { dispatchImplementer } from "./sub-agents/dispatch-implementer";

class SandboxDeadError extends Error {
  readonly code = "SANDBOX_DEAD" as const;

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Sandbox is no longer reachable (it may have died or its idle timeout expired). Underlying error: ${detail}`,
    );
    this.name = "SandboxDeadError";
  }
}

function isDeadSandboxError(err: unknown): boolean {
  if (err instanceof SandboxNotFoundError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|ENOTFOUND|fetch failed|sandbox (was )?(not found|no longer running|does not exist)/i.test(
    message,
  );
}

export async function executeTool(
  name: Tool,
  input: unknown,
  sandboxRef: SandboxRef,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
  model: string,
  effort: Effort,
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

      // Block for the user's answer (10 min), delivered in-process by the api
      // via bus.pushUserResponse (replaces the Redis lpush ↔ blpop rendezvous).
      const answer = await bus.waitForUserResponse(jobId, 600_000);
      if (answer === null) return { answer: null, timedOut: true };

      // The answer is returned as this tool call's result and persisted as
      // part of the standard TOOL_RES row by the agent loop — no separate
      // USER message row here, or the UI would render it twice.
      return { answer };
    }
    case "provision_sandbox": {
      if (!sandboxRef.current) {
        const { template } = (input ?? {}) as { template?: unknown };
        const requestedTemplateKey = isTemplateKey(template)
          ? template
          : undefined;
        sandboxRef.current = await provisionSandbox(
          projectId,
          userId,
          jobId,
          requestedTemplateKey,
        );
      }
      return { success: true };
    }
    case "create_plan":
      return createPlan(input, jobId, indexer);
    case "update_todo":
      return updateTodo(input, jobId, indexer);
    case "add_todos":
      return addTodos(input, jobId, indexer);
    case "report_progress":
      return { success: true };
    case "web_search":
      return webSearch(input);
    case "push_to_github": {
      const { title, description, mode, branch } = (input ?? {}) as {
        title?: unknown;
        description?: unknown;
        mode?: unknown;
        branch?: unknown;
      };
      return pushProjectToGithub(projectId, userId, {
        title: asString(title, "title"),
        body: typeof description === "string" ? description : "",
        ...(isPushMode(mode) ? { mode } : {}),
        ...(typeof branch === "string" && branch.trim() ? { branch } : {}),
      });
    }
    case "create_github_issue": {
      const { title, description } = (input ?? {}) as {
        title?: unknown;
        description?: unknown;
      };
      return createGithubIssue(projectId, userId, {
        title: asString(title, "title"),
        body: typeof description === "string" ? description : "",
      });
    }
    default:
      break;
  }

  const sandbox = sandboxRef.current;
  if (!sandbox) {
    return { error: "Sandbox not provisioned. Call provision_sandbox first." };
  }

  sandbox.setTimeout(SANDBOX_IDLE_TIMEOUT_MS).catch((err) => {
    console.warn("[executor] failed to refresh sandbox keep-alive:", err);
  });

  try {
    switch (name) {
      case "create_file":
        return await createFile(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
        );
      case "edit_file":
        return await editFile(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
        );
      case "read_file":
        return await readFile(input, sandbox);
      case "list_dir":
        return await listDir(input, sandbox);
      case "delete_file":
        return await deleteFile(input, sandbox, jobId, projectId, indexer);
      case "run_command":
        return await runCommand(input, sandbox);
      case "tail_command_output":
        return await tailCommandOutput(input, sandbox);
      case "wait_for_port":
        return await waitForPort(input, sandbox);
      case "check_sandbox":
        return await checkSandbox(input, sandbox);
      case "dispatch_explorer":
        return await dispatchExplorer(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
          model,
          effort,
        );
      case "dispatch_debugger":
        return await dispatchDebugger(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
          model,
          effort,
        );
      case "dispatch_verifier":
        return await dispatchVerifier(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
          model,
          effort,
        );
      // case "dispatch_implementer":
      //   return await dispatchImplementer(
      //     input,
      //     sandbox,
      //     jobId,
      //     projectId,
      //     userId,
      //     indexer,
      //   );
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (isDeadSandboxError(err)) {
      throw new SandboxDeadError(err);
    }
    throw err;
  }
}
