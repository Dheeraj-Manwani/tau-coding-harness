import { z } from "zod";

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  kind: z.enum(["feedback", "suggestion"]).default("feedback"),
  message: z.string().trim().max(5000).optional(),
  attachmentIds: z.array(z.uuid()).max(5).default([]).refine(
    (ids) => new Set(ids).size === ids.length, "Duplicate attachments",
  ),
  projectId: z.uuid().optional(),
  source: z.enum(["account", "preview"]).default("account"),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
