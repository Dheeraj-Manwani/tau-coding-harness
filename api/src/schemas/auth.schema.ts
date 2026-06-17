import { z } from "zod";
import { Errors } from "../lib/errors";

const clientType = z.enum(["web", "mobile"]).default("web");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("A valid email is required"));

export const registerSchema = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters"),
  clientType,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
  clientType,
});

export const refreshSchema = z.object({
  refreshToken: z.string().optional(),
  clientType,
});

export const logoutSchema = refreshSchema;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw Errors.badRequest(first?.message ?? "Invalid request");
  }
  return result.data;
}
