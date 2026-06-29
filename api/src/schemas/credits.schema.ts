import { z } from "zod";

export const listHistoryQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListHistoryQuery = z.infer<typeof listHistoryQuerySchema>;

export const redeemCodeSchema = z.object({
  code: z.string().min(1).max(64),
});

export type RedeemCodeBody = z.infer<typeof redeemCodeSchema>;

export const createPromoCodeSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .transform((v) => v.trim().toUpperCase()),
  credits: z.number().positive(),
  description: z.string().optional(),
  maxRedemptions: z.number().int().positive().optional(),
  perUserLimit: z.number().int().positive().default(1),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
});

export type CreatePromoCodeBody = z.infer<typeof createPromoCodeSchema>;
