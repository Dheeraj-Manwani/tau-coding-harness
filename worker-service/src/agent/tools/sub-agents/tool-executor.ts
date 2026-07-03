import type Sandbox from "e2b";
import { readFile } from "../functions/read";
import { listDir } from "../functions/list-dir";
import { runCommand } from "../functions/run-command";
import { tailCommandOutput } from "../functions/tail-command-output";
import { waitForPort } from "../functions/wait-for-port";
import { checkSandbox } from "../functions/check-sandbox";
import { createFile } from "../functions/create";
import { editFile } from "../functions/edit";
import { deleteFile } from "../functions/delete";
import { webSearch } from "../functions/web-search";

/** Restricted tool surface for sub-agents — no ask_user, plans, or nested dispatch. */
export async function executeSubAgentTool(
  name: string,
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
): Promise<unknown> {
  switch (name) {
    case "read_file":
      return readFile(input, sandbox);
    case "list_dir":
      return listDir(input, sandbox);
    case "run_command":
      return runCommand(input, sandbox);
    case "tail_command_output":
      return tailCommandOutput(input, sandbox);
    case "wait_for_port":
      return waitForPort(input, sandbox);
    case "check_sandbox":
      return checkSandbox(input, sandbox);
    case "web_search":
      return webSearch(input);
    case "create_file":
      return createFile(input, sandbox, jobId, projectId, userId, indexer);
    case "edit_file":
      return editFile(input, sandbox, jobId, projectId, userId, indexer);
    case "delete_file":
      return deleteFile(input, sandbox, jobId, projectId, indexer);
    default:
      throw new Error(`Tool not available to sub-agents: ${name}`);
  }
}
