import type z from "zod";
import { Errors } from "./errors";

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw Errors.badRequest(first?.message ?? "Invalid request");
  }
  return result.data;
}
