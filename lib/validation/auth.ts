import { z } from "zod";

import { normalizedEmailSchema, trimmedString } from "@/lib/validation/common";

export const passwordSchema = z
  .string()
  .min(10, "Password must contain at least 10 characters.")
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/\d/, "Password must contain a digit.")
  .regex(/[^A-Za-z0-9]/, "Password must contain a symbol.");

export const registerSchema = z
  .object({
    email: normalizedEmailSchema,
    password: passwordSchema,
    passwordConfirmation: z.string(),
    name: trimmedString(2, 160),
    role: z.enum(["CANDIDATE", "EMPLOYER"]),
    acceptedTermsNoticeVersion: trimmedString(1, 32),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.password !== value.passwordConfirmation) {
      context.addIssue({
        code: "custom",
        path: ["passwordConfirmation"],
        message: "Passwords do not match.",
      });
    }
  });

export const loginSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({ email: normalizedEmailSchema })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
