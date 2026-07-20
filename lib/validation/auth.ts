import { z } from "zod";

import {
  normalizeSwissUid,
  normalizeWorkEmailDomain,
} from "@/lib/auth/employer-registration-signals";
import {
  normalizedEmailSchema,
  swissCantonCodeSchema,
  trimmedString,
} from "@/lib/validation/common";

export const passwordSchema = z
  .string()
  .min(10, "Das Passwort muss mindestens 10 Zeichen enthalten.")
  .max(128, "Das Passwort darf höchstens 128 Zeichen enthalten.")
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= 72,
    "Das Passwort darf höchstens 72 UTF-8-Bytes enthalten.",
  )
  .regex(/[a-z]/, "Das Passwort muss einen Kleinbuchstaben enthalten.")
  .regex(/[A-Z]/, "Das Passwort muss einen Grossbuchstaben enthalten.")
  .regex(/\d/, "Das Passwort muss eine Zahl enthalten.")
  .regex(/[^A-Za-z0-9]/, "Das Passwort muss ein Sonderzeichen enthalten.");

const passwordConfirmationShape = {
  password: passwordSchema,
  passwordConfirmation: z.string().max(128),
} as const;

const registrationConsentShape = {
  acceptedTerms: z.literal(true, {
    error: "Bitte akzeptieren Sie die aktuellen Nutzungsbedingungen.",
  }),
  marketingConsent: z.boolean().default(false),
} as const;

const optionalSwissUidSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z
    .string()
    .trim()
    .max(32)
    .regex(
      /^CHE(?:[-. ]?\d{3}){3}$/iu,
      "Bitte geben Sie eine Schweizer UID im Format CHE-123.456.789 ein.",
    )
    .transform((value) => normalizeSwissUid(value))
    .optional(),
);

const workEmailSchema = normalizedEmailSchema.refine(
  (email) => {
    try {
      normalizeWorkEmailDomain(email);
      return true;
    } catch {
      return false;
    }
  },
  "Bitte verwenden Sie eine gültige geschäftliche E-Mail-Adresse.",
);

function addPasswordConfirmationIssue(
  value: Readonly<{ password: string; passwordConfirmation: string }>,
  context: z.RefinementCtx,
): void {
  if (value.password !== value.passwordConfirmation) {
    context.addIssue({
      code: "custom",
      path: ["passwordConfirmation"],
      message: "Die Passwörter stimmen nicht überein.",
    });
  }
}

export const candidateRegistrationSchema = z
  .object({
    email: normalizedEmailSchema,
    name: trimmedString(2, 160),
    ...passwordConfirmationShape,
    ...registrationConsentShape,
  })
  .strict()
  .superRefine(addPasswordConfirmationIssue);

export const employerRegistrationSchema = z
  .object({
    email: workEmailSchema,
    name: trimmedString(2, 160),
    companyName: trimmedString(2, 200),
    uid: optionalSwissUidSchema,
    cantonCode: swissCantonCodeSchema,
    companySize: trimmedString(1, 64),
    ...passwordConfirmationShape,
    ...registrationConsentShape,
  })
  .strict()
  .superRefine(addPasswordConfirmationIssue);

export const registerSchema = z.discriminatedUnion("role", [
  z.object({
    ...candidateRegistrationSchema.shape,
    role: z.literal("CANDIDATE"),
  }).strict(),
  z.object({
    ...employerRegistrationSchema.shape,
    role: z.literal("EMPLOYER"),
  }).strict(),
]).superRefine(addPasswordConfirmationIssue);

export const loginSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({ email: normalizedEmailSchema })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(32, "Der Link zum Zurücksetzen ist ungültig oder abgelaufen.")
      .max(256, "Der Link zum Zurücksetzen ist ungültig oder abgelaufen.")
      .regex(
        /^[A-Za-z0-9_-]+$/u,
        "Der Link zum Zurücksetzen ist ungültig oder abgelaufen.",
      ),
    ...passwordConfirmationShape,
  })
  .strict()
  .superRefine(addPasswordConfirmationIssue);

export type RegisterInput = z.infer<typeof registerSchema>;
export type CandidateRegistrationInput = z.infer<
  typeof candidateRegistrationSchema
>;
export type EmployerRegistrationInput = z.infer<
  typeof employerRegistrationSchema
>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
