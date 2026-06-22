import { z } from "zod";

const MAX_PROMPT = 10_000;
const MAX_NAME = 100;

const messageContent = z
  .string()
  .trim()
  .min(1, "Message can't be empty")
  .max(MAX_PROMPT, `Message must be at most ${MAX_PROMPT} characters`);

export const messageRole = z.enum(["USER", "ASSISTANT"]);
export const messageType = z.enum(["RESULT", "ERROR"]);

export const messageSchema = z.object({
  message: messageContent,
});

export const projectIdParamSchema = z.object({
  projectId: z.uuid("Invalid project id"),
});

export const listProjectsQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type MessageRole = z.infer<typeof messageRole>;
export type MessageType = z.infer<typeof messageType>;
export type MessageInput = z.infer<typeof messageSchema>;
export type ProjectIdParam = z.infer<typeof projectIdParamSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
