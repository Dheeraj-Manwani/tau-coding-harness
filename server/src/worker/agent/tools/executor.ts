import { SandboxNotFoundError } from "e2b";
import { provisionSandbox, SANDBOX_IDLE_TIMEOUT_MS } from "@/worker/lib/sandbox";
import { isSelectableTemplateKey } from "@/worker/templates/registry";
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
import { grepTool } from "./functions/grep";
import { deleteFile } from "./functions/delete";
import { runCommand } from "./functions/run-command";
import { changesDependencies, persistDependencies } from "@/worker/lib/appStack";
import { tailCommandOutput } from "./functions/tail-command-output";
import { waitForPort } from "./functions/wait-for-port";
import { checkSandbox } from "./functions/check-sandbox";
import { webSearch } from "./functions/web-search";
import { searchImages } from "./functions/search-images";
import { imageDimensions } from "./functions/image-dimensions";
import { downloadAsset } from "./functions/download-asset";
import { enableAi } from "./functions/enable-ai";
import { addBackendTool } from "./functions/add-backend";
import { addDatabaseTool } from "./functions/add-database";
import { readDocTool } from "./functions/read-doc";
import { searchHistory } from "./functions/search-history";
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
import { dispatchDesignReviewer } from "./sub-agents/dispatch-design-reviewer";
import { generateImageTool } from "./functions/generate-image";
import { inspectPreviewTool } from "./functions/inspect-preview";
import { markBeforeCommand, saveShellChanges } from "./functions/shell-changes";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { finishDesign, startDesign } from "@/worker/design/provision";

/** What the agent is told, once, about a design that was read from a screenshot. */
const FROM_IMAGE_NOTE =
  "This app's design was read from the screenshot the user attached: its colours, shapes, typefaces and layout. Its photographs, illustrations, logos, brand names and wording were not copied, and must not be: use this app's own. When you finish, tell the user in one sentence what was taken from the screenshot and what was not.";

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
      return requestSecret(
        input,
        sandboxRef,
        jobId,
        projectId,
        userId,
        toolCallId,
        indexer,
      );
    case "provision_sandbox": {
      let designNote: string | null = null;
      if (!sandboxRef.current) {
        const { template, brief } = (input ?? {}) as {
          template?: unknown;
          brief?: unknown;
        };
        const requestedTemplateKey = isSelectableTemplateKey(template)
          ? template
          : undefined;

        // A brand-new app on the base image gets a design of its own, decided
        // while the sandbox boots and applied the moment it is up
        // (worker/design). An app that already has files keeps the look it has.
        const isNewApp =
          env.TEMPLATE_GENERATION === 2 &&
          (await prisma.projectFile.count({ where: { projectId } })) === 0;
        const designing = isNewApp
          ? startDesign(projectId, typeof brief === "string" ? brief : "")
          : null;

        sandboxRef.current = await provisionSandbox(
          projectId,
          userId,
          jobId,
          requestedTemplateKey,
        );

        if (designing) {
          const designed = await finishDesign(
            { sandbox: sandboxRef.current, projectId, userId, jobId, indexer },
            designing,
          );
          // Said once, here, rather than in the design file, which is read
          // with every request: the user should hear it when the app is
          // built, not every time they ask for a change.
          if (designed?.choice.imported?.fromImage) designNote = FROM_IMAGE_NOTE;
        }
      }
      return { success: true, ...(designNote ? { designNote } : {}) };
    }
    case "create_plan":
      return createPlan(input, jobId);
    case "update_todo":
      return updateTodo(input, jobId, toolCallId);
    case "add_todos":
      return addTodos(input, jobId, toolCallId);
    case "report_progress":
      return { success: true };
    case "read_doc":
      return readDocTool(input);
    case "search_history":
      return searchHistory(input, projectId);
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
      case "grep":
        return await grepTool(input, sandbox);
      case "delete_file":
        return await deleteFile(input, sandbox, jobId, projectId, indexer);
      case "generate_image":
        return await generateImageTool(input, sandbox, jobId, projectId, userId, indexer);
      case "inspect_preview":
        return await inspectPreviewTool(input, sandbox, jobId);
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
      case "add_backend":
        return await addBackendTool(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
        );
      case "add_database":
        return await addDatabaseTool(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
        );
      case "run_command": {
        // Mark the moment before, so that what the command leaves behind can
        // be found and saved afterwards (functions/shell-changes.ts).
        const marked = await markBeforeCommand(sandbox);
        const result = await runCommand(input, sandbox);
        // `bun add` rewrites package.json and the lockfile in the sandbox
        // without any file tool seeing it. Unsaved, the next sandbox is
        // restored from the old manifest and the app fails on the import.
        const command = (input as { command?: unknown } | null)?.command;
        if (
          typeof command === "string" &&
          changesDependencies(command) &&
          !("background" in result)
        ) {
          await persistDependencies({ sandbox, projectId, userId, jobId, indexer }).catch(
            (err) =>
              log.warn("job.dependencies.persist_failed", {
                jobId,
                projectId,
                error: String(err),
              }),
          );
        }
        // Files the command made or changed: `shadcn add`, a generator, a
        // download. Without this they vanish with the sandbox.
        if (marked && !("background" in result)) {
          const kept = await saveShellChanges(sandbox, jobId, projectId, userId, indexer);
          if (kept.saved.length > 0 || kept.skipped.length > 0) {
            return {
              ...result,
              ...(kept.saved.length > 0
                ? {
                    savedFiles: kept.saved.slice(0, 12),
                    ...(kept.saved.length > 12 ? { savedMore: kept.saved.length - 12 } : {}),
                  }
                : {}),
              ...(kept.skipped.length > 0
                ? {
                    notSaved: kept.skipped.slice(0, 6).map((s) => `${s.path} (${s.why})`),
                  }
                : {}),
            };
          }
        }
        return result;
      }
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
      case "dispatch_design_reviewer":
        return await dispatchDesignReviewer(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
        );
      case "dispatch_implementer":
        return await dispatchImplementer(
          input,
          sandbox,
          jobId,
          projectId,
          userId,
          indexer,
          model,
          effort,
        );
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
