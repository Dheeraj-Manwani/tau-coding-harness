import type Sandbox from "e2b";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import {
  buildAiEnv,
  gatewayUsable,
  restartAppServer,
  writeAiEnvFile,
} from "@/lib/aiEnv";
import { keyEncryptionConfigured } from "@/lib/apiKeys";
import { persistFile } from "./utils";
import { toTemplateKey, TEMPLATES } from "@/templates/registry";

/** The env vars a deployed app will need, declared for the deploy flow. */
const DEPLOY_MANIFEST_PATH = ".tau/deploy.json";

interface DeployManifest {
  envRequired?: {
    key: string;
    description: string;
    secret?: boolean;
    managed?: string;
  }[];
}

/**
 * Merge the tau-managed entries into `.tau/deploy.json` without clobbering
 * anything the agent put there. `managed: "tau"` tells the deploy flow to
 * resolve the value itself rather than prompting the user for it
 * (doc/AI_FOR_GENERATED_APPS.md §10).
 *
 * This file IS persisted — it contains no secret, only the names of the vars.
 */
async function upsertDeployManifest(
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
): Promise<void> {
  let manifest: DeployManifest = {};
  try {
    const existing = await sandbox.files.read(
      `/home/user/app/${DEPLOY_MANIFEST_PATH}`,
    );
    manifest = JSON.parse(existing) as DeployManifest;
  } catch {
    // No manifest yet, or it is unparseable — start clean rather than fail the
    // tool over a file the user never sees.
  }

  const managed = [
    {
      key: "TAU_API_KEY",
      description: "tau AI credential",
      secret: true,
      managed: "tau",
    },
    {
      key: "TAU_AI_URL",
      description: "tau AI base URL (fetch surface)",
      managed: "tau",
    },
    {
      key: "TAU_API_URL",
      description: "tau AI base URL (OpenAI-compatible surface)",
      managed: "tau",
    },
  ];

  const others = (manifest.envRequired ?? []).filter(
    (e) => !managed.some((m) => m.key === e.key),
  );
  const body = JSON.stringify(
    { ...manifest, envRequired: [...others, ...managed] },
    null,
    2,
  );

  await sandbox.files.write(`/home/user/app/${DEPLOY_MANIFEST_PATH}`, body);
  await persistFile(
    jobId,
    projectId,
    userId,
    DEPLOY_MANIFEST_PATH,
    body,
    indexer,
  );
}

function recipe(): string {
  return [
    "AI is now wired up. Call it with plain `fetch` from your SERVER code —",
    "there is NO package to install and no client library to set up.",
    "",
    "In server/index.ts:",
    "",
    "  app.post('/api/ask', async (c) => {",
    "    const { question } = await c.req.json<{ question: string }>()",
    "",
    "    const res = await fetch(`${process.env.TAU_AI_URL}/chat`, {",
    "      method: 'POST',",
    "      headers: {",
    "        'Content-Type': 'application/json',",
    "        Authorization: `Bearer ${process.env.TAU_API_KEY}`,",
    "        'X-Tau-Project': process.env.TAU_PROJECT_ID ?? '',",
    "      },",
    "      body: JSON.stringify({",
    "        prompt: question,",
    "        system: 'You are a helpful assistant. Be concise.',",
    "      }),",
    "    })",
    "",
    "    const data = await res.json()",
    "    if (!res.ok) return c.json({ error: data.error }, 502)",
    "    return c.json({ answer: data.text })",
    "  })",
    "",
    "The frontend calls YOUR route (`fetch('/api/ask', …)`) — never tau directly,",
    "and never with the key.",
    "",
    "Keep the `X-Tau-Project` header on every call. It is what attributes this",
    "app's AI spend to this project on the user's billing page; without it their",
    "usage shows up unattributed. It carries no secret — copy it as written.",
    "",
    "REQUEST fields (only `prompt` is required):",
    "  prompt       string  the question / instruction",
    "  system       string  optional persona or rules",
    "  messages     array   optional, instead of `prompt`, for multi-turn chat:",
    "                       [{ role: 'user'|'assistant'|'system', content: '…' }]",
    "  model        string  'tau-fast' (default) | 'tau-smart' | 'tau-max'",
    "  maxTokens    number  optional output limit. Leave it unset unless you have",
    "                       a reason — setting it too low returns an empty answer,",
    "                       because these models think before they write",
    "  temperature  number  optional",
    "  json         true    optional — makes the model reply with valid JSON",
    "",
    "RESPONSE:",
    "  { text, model, finishReason, truncated, usage: { inputTokens,",
    "    outputTokens, creditsSpent, creditsRemaining }, requestId }",
    "  The answer is `data.text`. `truncated` is true if the model ran out of",
    "  room mid-answer — raise maxTokens or ask for something shorter.",
    "",
    "ERRORS come back as { error: string, code: string } with a non-2xx status:",
    "  insufficient_credits (402)  the owner is out of credits",
    "  daily_cap_exceeded   (429)  the owner's daily AI spend limit was hit",
    "  rate_limit_exceeded  (429)  too many requests just now",
    "Show a friendly message for these — never surface a raw error to the user.",
    "",
    "STREAMING (only if the UI needs text to appear progressively): POST the same",
    "body to `${process.env.TAU_AI_URL}/chat/stream`. It returns server-sent",
    "events, one JSON object per `data:` line: {\"text\":\"…\"} for each piece, then",
    "a final {\"done\":true,\"usage\":{…}}. Prefer the plain /chat endpoint unless",
    "streaming genuinely improves the experience — it is much simpler to get right.",
    "",
    "RULES:",
    "- NEVER put TAU_API_KEY in frontend code, in a file, or in a log line. It is",
    "  already in the environment; just read process.env.",
    "- Do NOT install or import an AI SDK (openai, @anthropic-ai/sdk, …) and do",
    "  NOT ask the user for an API key. This fetch is the whole integration.",
    "- Your /api route is public once deployed. Keep prompts small and consider a",
    "  simple per-IP rate limit, because every call spends the owner's credits.",
  ].join("\n");
}

/**
 * Turn on AI features for this project: mint/fetch the user's key, inject it
 * into the running sandbox, record the deploy requirement, and hand the agent a
 * usage recipe.
 *
 * Idempotent — calling it twice just re-injects.
 */
export async function enableAi(
  input: unknown,
  sandbox: Sandbox,
  jobId: string,
  projectId: string,
  userId: string,
  indexer: () => number,
) {
  const { purpose } = (input ?? {}) as { purpose?: unknown };

  if (!keyEncryptionConfigured()) {
    return {
      error:
        "AI features are not available on this tau instance. Tell the user this app cannot call an AI model, and build the rest of the request without it.",
    };
  }

  // Checked before anything is minted or written. The failure this prevents is
  // the expensive one: an app that looks wired up, that the user is told works,
  // and that 502s on every AI call because the address it was given is not
  // reachable from the sandbox it runs in.
  const reachable = gatewayUsable();
  if (!reachable.ok) {
    log.error("ai.enable_refused", {
      jobId,
      projectId,
      reason: reachable.reason,
      detail: reachable.detail,
    });
    return {
      error:
        "The tau AI gateway is not reachable from this sandbox, so AI features cannot be turned on right now. This is a configuration problem on tau's side, not something you or the user can work around — do NOT try another provider, do NOT ask the user for an API key, and do NOT write code that calls a model. Tell the user plainly that AI is unavailable on this instance, then build the rest of what they asked for without it.",
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { templateKey: true, aiEnabled: true },
  });
  if (!project) return { error: `Project ${projectId} not found` };

  // The key has to live somewhere only the server can read it. A frontend-only
  // app has no server, so there is nowhere safe to put it.
  const template = TEMPLATES[toTemplateKey(project.templateKey)];
  if (!template.hasServer) {
    return {
      error:
        "This app is frontend-only, so there is nowhere safe to keep an AI key — anything in the browser bundle is public. Tell the user plainly that AI features need a backend, which this app was not built with, and that starting a new project would be the way to get one. Do not try to work around this.",
    };
  }

  const vars = await buildAiEnv(userId, projectId);
  await writeAiEnvFile(sandbox, vars);

  await prisma.project.update({
    where: { id: projectId },
    data: { aiEnabled: true },
  });

  await upsertDeployManifest(sandbox, jobId, projectId, userId, indexer);

  // The server is already running and read its environment at boot, so it will
  // not see the new .env without this.
  await restartAppServer(sandbox, jobId);

  log.info("ai.enabled", {
    jobId,
    projectId,
    purpose: typeof purpose === "string" ? purpose.slice(0, 200) : null,
    alreadyEnabled: project.aiEnabled,
  });

  return {
    success: true,
    // Named so the agent can talk about them; the VALUES are never returned —
    // the model has no reason to see the key and every reason not to.
    envVars: ["TAU_API_KEY", "TAU_AI_URL", "TAU_PROJECT_ID"],
    endpoint: "POST ${TAU_AI_URL}/chat",
    models: ["tau-fast", "tau-smart", "tau-max"],
    recipe: recipe(),
  };
}
