import { SandboxNotFoundError } from "e2b";
import { provisionSandbox, SANDBOX_IDLE_TIMEOUT_MS } from "@/worker/lib/sandbox";
import { isTemplateKey } from "@/worker/templates/registry";
import { publish } from "@/worker/lib/publish";
import { log } from "@/worker/lib/log";
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
import { searchImages } from "./functions/search-images";
import { imageDimensions } from "./functions/image-dimensions";
import { downloadAsset } from "./functions/download-asset";
import { enableAi } from "./functions/enable-ai";
import { requestSecret } from "./functions/request-secret";
import { awaitAnswer } from "./functions/await-answer";
import { redactSecrets, redactToolResult } from "@/worker/lib/redact";
import {
  pushProjectToGithub,
  createGithubIssue,
  isPushMode,
} from "@/api/lib/github";
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

// Re-exported: tests and older call sites import it from here.
export { redactSecrets };

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
  toolCallId?: string,
): Promise<unknown> {
  let output: unknown;
  try {
    output = await executeToolInner(
      name,
      input,
      sandboxRef,
      jobId,
      projectId,
      userId,
      indexer,
      model,
      effort,
      toolCallId,
    );
  } catch (err) {
    // A thrown message reaches the model and the ToolCall row just like a
    // result does (a failed command's stderr can echo the environment).
    if (err instanceof Error) {
      err.message = await redactToolResult(projectId, err.message);
    }
    throw err;
  }
  return redactToolResult(projectId, output);
}

async function executeToolInner(
  name: Tool,
  input: unknown,
  sandboxRef: SandboxRef,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
  model: string,
  effort: Effort,
  toolCallId?: string,
): Promise<unknown> {
  log.debug("job.tool", { jobId, projectId, tool: name });
  if (name === "ask_user" || name === "request_secret") {
    bus.setPhase(jobId, "waiting_user");
  }

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

      if (!toolCallId) throw new Error("Missing persisted question id");

      bus.registerQuestion(jobId, toolCallId);
      await publish(jobId, {
        type: "ask_user",
        questionId: toolCallId,
        question: q,
        options: opts,
      });
      // The answer is persisted as the standard TOOL_RES by the agent loop.
      return awaitAnswer(jobId, toolCallId);
    }
    case "request_secret":
      return requestSecret(input, sandboxRef, jobId, projectId, userId, toolCallId);
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
    case "search_images":
      return searchImages(input);
    case "image_dimensions":
      return imageDimensions(input);
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
    log.warn("sandbox.keepalive.failed", { jobId, error: String(err) });
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
      case "download_asset":
        return await downloadAsset(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
        );
      case "enable_ai": {
        const result = await enableAi(input, sandbox, jobId, projectId, userId, indexer);
        // A frontend-only app was just migrated and its sandbox marked DEAD.
        // Without dropping the ref, `provision_sandbox` would see a sandbox and
        // no-op, leaving the agent on the old template's stack.
        if ("needsReprovision" in result && result.needsReprovision) {
          sandboxRef.current = null;
        }
        return result;
      }
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
