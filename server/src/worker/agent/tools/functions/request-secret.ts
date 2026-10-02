import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { bus } from "@/lib/bus";
import { log } from "@/worker/lib/log";
import { publish } from "@/worker/lib/publish";
import { keyEncryptionConfigured } from "@/lib/apiKeys";
import {
  MAX_SECRETS_PER_REQUEST,
  projectSecretNames,
  secretNameError,
} from "@/lib/projectSecrets";
import { reinjectProjectEnv } from "@/worker/lib/aiEnv";
import { SANDBOX_IDLE_TIMEOUT_MS } from "@/worker/lib/sandbox";
import { toTemplateKey, TEMPLATES } from "@/worker/templates/registry";
import { migrateTemplate } from "@/worker/lib/migrateTemplate";
import type { SandboxRef } from "../../loop";
import { awaitAnswer } from "./await-answer";

/** One field of the key form, as the UI renders it. Never carries a value. */
export interface SecretField {
  name: string;
  label: string;
  description: string;
  url?: string;
}

/** What the API stores as the tool call's output when the user submits. */
export interface SecretAnswerOutput {
  answer: string;
  saved: string[];
  skipped: string[];
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function parseFields(raw: unknown): SecretField[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "`secrets` must list at least one key to ask for." };
  }
  if (raw.length > MAX_SECRETS_PER_REQUEST) {
    return { error: `Ask for at most ${MAX_SECRETS_PER_REQUEST} keys at once.` };
  }
  const fields: SecretField[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const name = str(o.name, 64);
    const problem = secretNameError(name);
    if (problem) return { error: problem };
    if (seen.has(name)) continue;
    seen.add(name);

    const url = str(o.url, 500);
    fields.push({
      name,
      label: str(o.label, 80) || name,
      description: str(o.description, 400),
      // Rendered as a link in the user's browser: only ever an https URL.
      ...(/^https:\/\/\S+$/i.test(url) ? { url } : {}),
    });
  }
  return fields;
}

function usage(names: string[]): string {
  return [
    `Available to the app's SERVER as ${names.map((n) => `process.env.${n}`).join(", ")}.`,
    "Read them inside server routes (server/index.ts). The frontend calls your",
    "route — never put a key in frontend code, never under a VITE_ name, never",
    "write one into any file (including .env, which tau manages), and never log",
    "or print one. If a key is missing at runtime, return a clear error from the",
    "route and show a friendly 'not configured' message in the UI.",
  ].join("\n");
}

/**
 * Ask the user for third-party credentials through a form outside the chat.
 *
 * The value path is deliberately out of band: this tool's input (persisted as
 * the ToolCall row and the assistant message) holds only names and
 * descriptions; the browser posts values to `POST …/jobs/:jobId/secrets`, which
 * encrypts them into `ProjectSecret` and stores only the saved/skipped *names*
 * as this call's output. The model learns that a key exists, never what it is.
 *
 * Runs before the sandbox check on purpose, like `ask_user`: the user may take
 * minutes to find a key, longer than the sandbox's idle timeout, so the sandbox
 * is only touched (and kept alive) after the answer arrives.
 */
export async function requestSecret(
  input: unknown,
  sandboxRef: SandboxRef,
  jobId: string,
  projectId: string,
  userId: string,
  toolCallId: string | undefined,
) {
  const { reason, secrets, replace } = (input ?? {}) as {
    reason?: unknown;
    secrets?: unknown;
    replace?: unknown;
  };

  if (!keyEncryptionConfigured()) {
    return {
      error:
        "Secure key storage is not available on this tau instance. Do NOT ask for the key in chat and do NOT hardcode one. Tell the user this integration can't be set up here, and build the rest of the app with a clear 'not configured' state for it.",
    };
  }

  const parsed = parseFields(secrets);
  if ("error" in parsed) return { error: parsed.error };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { templateKey: true },
  });
  if (!project) return { error: `Project ${projectId} not found` };

  // A key can only be kept from visitors on a server. A frontend-only app has
  // none, so give it one first — the same move `enable_ai` makes.
  if (!TEMPLATES[toTemplateKey(project.templateKey)].hasServer) {
    const migrated = await migrateTemplate(projectId, userId);
    if (!migrated.migrated && migrated.reason === "hand_rolled_server") {
      return {
        error: `This app is frontend-only but already has its own \`server/\` directory, so tau cannot safely add the standard backend on top of it. ${migrated.detail} Tell the user what you found and ask whether to remove it first — do not merge or overwrite it yourself.`,
      };
    }
    if (migrated.migrated) {
      // The connected sandbox runs the old template and is now marked DEAD.
      // Drop it so the next `provision_sandbox` actually boots the new stack.
      sandboxRef.current = null;
      return {
        migrated: true,
        needsReprovision: true,
        changed: migrated.changed,
        message:
          "This app was frontend-only, so it is being given a backend (a Hono server) — API keys must live on a server, where visitors can't read them. TELL THE USER this is happening and that their app is being rebuilt. Then call `provision_sandbox`, then call `request_secret` again with the same keys. Their files and UI are preserved.",
      };
    }
  }

  const existing = new Set(await projectSecretNames(projectId));
  const wanted = replace === true ? parsed : parsed.filter((f) => !existing.has(f.name));
  const alreadySet = parsed.filter((f) => existing.has(f.name)).map((f) => f.name);

  if (wanted.length === 0) {
    return {
      alreadySet,
      message:
        "Every requested key is already saved for this project — nothing was asked. If the user says one is wrong, call again with `replace: true`.",
      usage: usage(alreadySet),
    };
  }

  if (!toolCallId) throw new Error("Missing persisted question id");

  const question =
    str(reason, 500) ||
    `This app needs ${wanted.length === 1 ? "a key" : "some keys"} to connect to an outside service.`;

  // The form as actually shown (already-saved keys filtered out), on the
  // durable row: the API validates a submission against it, and a refreshed
  // browser rebuilds the form from it. Names and descriptions only. The API
  // replaces this output when the user answers.
  await prisma.toolCall.update({
    where: { id: toolCallId },
    data: { output: { fields: wanted } as unknown as Prisma.InputJsonValue },
  });

  bus.registerQuestion(jobId, toolCallId);
  // `ask_user` frame + `secrets`: the client treats it as a pending question
  // (notifications, favicon, recovery) but renders the key form for it.
  await publish(jobId, {
    type: "ask_user",
    questionId: toolCallId,
    question,
    options: [],
    secrets: wanted,
  });

  const result = await awaitAnswer(jobId, toolCallId);
  if (result.answer === null) {
    if ("cancelled" in result) return { answer: null, cancelled: true };
    return {
      answer: null,
      timedOut: true,
      message:
        "The user did not provide the keys in time. Build the feature with a clear 'not configured' state, and tell them they can add the keys later by asking you again.",
    };
  }

  // The API wrote the names (never the values) next to the answer.
  const row = await prisma.toolCall.findUnique({
    where: { id: toolCallId },
    select: { output: true },
  });
  const out = (row?.output ?? {}) as Partial<SecretAnswerOutput>;
  const saved = Array.isArray(out.saved) ? out.saved : [];
  const skipped = Array.isArray(out.skipped) ? out.skipped : [];

  // The user was gone for a while; this is the first moment the sandbox matters.
  const sandbox = sandboxRef.current;
  if (saved.length > 0 && sandbox) {
    await sandbox.setTimeout(SANDBOX_IDLE_TIMEOUT_MS).catch(() => {});
    // Not fatal if the sandbox died meanwhile: the keys are stored, and the
    // next provision writes them into the fresh one.
    await reinjectProjectEnv(sandbox, projectId, userId, jobId, { restart: true });
  }

  log.info("secrets.requested", { jobId, projectId, saved, skipped });

  const available = [...new Set([...alreadySet, ...saved])];
  return {
    answer: result.answer,
    saved,
    skipped,
    ...(alreadySet.length > 0 ? { alreadySet } : {}),
    ...(available.length > 0 ? { usage: usage(available) } : {}),
    ...(skipped.length > 0
      ? {
          note: `The user skipped ${skipped.join(", ")}. Build that part with a clear 'not configured' state instead of failing, and do not ask again unless they bring it up.`,
        }
      : {}),
  };
}
