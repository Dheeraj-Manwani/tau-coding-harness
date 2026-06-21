import { z } from "zod";

/**
 * Client-side form schemas, mirroring api/src/schemas/auth.schema.ts so the
 * browser validates the same rules the server enforces (email normalization,
 * password ≥ 8 on register).
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .email("Enter a valid email");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z
  .object({
    email,
    password: z.string().min(8, "Use at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;
