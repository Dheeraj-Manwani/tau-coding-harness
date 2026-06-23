import { Sandbox } from "e2b";
import { prisma } from "./prisma";
import { env } from "./env";
import { SandboxStatus } from "../generated/prisma/enums";

export type { Sandbox } from "e2b";

export function getSandbox(sandboxId: string): Promise<Sandbox> {
  return Sandbox.connect(sandboxId, { apiKey: env.E2B_API_KEY });
}

export async function provisionSandbox(projectId: string): Promise<Sandbox> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);

  if (project.sandboxId && project.sandboxStatus === SandboxStatus.READY) {
    try {
      return await getSandbox(project.sandboxId);
    } catch (err) {
      console.warn(
        `[sandbox] reconnect to ${project.sandboxId} failed; creating a new sandbox`,
        err,
      );
    }
  }

  const sandbox = await Sandbox.create({ apiKey: env.E2B_API_KEY });

  await prisma.project.update({
    where: { id: projectId },
    data: {
      sandboxId: sandbox.sandboxId,
      sandboxStatus: SandboxStatus.READY,
    },
  });

  return sandbox;
}
