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
export const effortSchema = z.enum(["LOW", "HIGH", "MAX"]).default("LOW");

export const messageSchema = z.object({
  message: messageContent,
  effort: effortSchema,
});

export const projectIdParamSchema = z.object({
  projectId: z.uuid("Invalid project id"),
});

export const listProjectsQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listMessagesQuerySchema = z.object({
  cursor: z.uuid().optional(),
  before: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const projectFileQuerySchema = z.object({
  path: z.string().min(1, "path is required"),
});

export const jobIdParamSchema = z.object({
  projectId: z.uuid("Invalid project id"),
  jobId: z.uuid("Invalid job id"),
});

export const jobAnswerSchema = z.object({
  answer: z.string().min(1, "Answer can't be empty").max(10_000),
});

export const pushModeSchema = z.enum(["new_pr", "update_pr", "direct"]);

export const githubPushSchema = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(5_000).optional(),
  mode: pushModeSchema.optional(),
});

export const githubLinkSchema = z.object({
  // "owner/repo"
  repo: z
    .string()
    .trim()
    .regex(/^[^/\s]+\/[^/\s]+$/, "Expected a repository in 'owner/repo' form"),
});

export const githubPatchSchema = z
  .object({
    private: z.boolean().optional(),
    pushMode: pushModeSchema.optional(),
  })
  .refine((v) => v.private !== undefined || v.pushMode !== undefined, {
    message: "Nothing to update",
  });

export type MessageRole = z.infer<typeof messageRole>;
export type MessageType = z.infer<typeof messageType>;
export type Effort = z.infer<typeof effortSchema>;
export type MessageInput = z.infer<typeof messageSchema>;
export type ProjectIdParam = z.infer<typeof projectIdParamSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
