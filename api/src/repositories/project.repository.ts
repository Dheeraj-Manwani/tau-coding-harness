import { MessageRole, MessageType } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";

export const initProject = async ({
  name,
  messages,
  userId,
}: {
  name: string;
  messages: string[];
  userId: string;
}) => {
  await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name,
        userId,
      },
    });
    messages.map(async (m) => {
      await tx.message.create({
        data: {
          content: m,
          role: MessageRole.USER,
          projectId: project.id,
        },
      });
    });
  });
};
