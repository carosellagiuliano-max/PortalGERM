import { z } from "zod";

import { BillingInterval } from "@/lib/generated/prisma/enums";
import {
  normalizedEmailSchema,
  trimmedString,
  uuidSchema,
} from "@/lib/validation/common";

export const LEAD_COMPANY_SIZE_CODES = [
  "1_9",
  "10_49",
  "50_249",
  "250_999",
  "1000_PLUS",
] as const;

export const LEAD_HIRING_NEED_CODES = [
  "ONE_ROLE",
  "TWO_TO_FIVE",
  "SIX_TO_TWENTY",
  "TWENTY_PLUS",
  "EXPLORING",
] as const;

export const LEAD_INTEREST_CODES = [
  "GENERAL",
  "STARTER",
  "PRO",
  "BUSINESS",
  "ENTERPRISE",
  "IMPORT",
] as const;

export const LEAD_CALLBACK_WINDOW_CODES = [
  "MORNING",
  "AFTERNOON",
  "ANYTIME",
] as const;

export const billingAddressSchema = z
  .object({
    legalName: trimmedString(2, 200),
    billingContactEmail: normalizedEmailSchema,
    street: trimmedString(3, 200),
    postalCode: z.string().trim().regex(/^\d{4}$/),
    city: trimmedString(2, 160),
    countryCode: z.literal("CH"),
    uid: trimmedString(5, 32).optional(),
    vatNumber: trimmedString(5, 32).optional(),
  })
  .strict();

export const checkoutSchema = z
  .object({
    companyId: uuidSchema,
    planVersionId: uuidSchema.optional(),
    productVersionId: uuidSchema.optional(),
    billingInterval: z.enum(BillingInterval).optional(),
    quantity: z.number().int().min(1).max(100).default(1),
    targetJobId: uuidSchema.optional(),
    clientIdempotencyKey: trimmedString(8, 128),
    billingAddress: billingAddressSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.planVersionId === undefined) === (value.productVersionId === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["planVersionId"],
        message: "Select exactly one plan or product version.",
      });
    }
  });

export const leadFormSchema = z
  .object({
    email: normalizedEmailSchema,
    companyName: trimmedString(2, 200),
    contactName: trimmedString(2, 160),
    phone: z.preprocess(
      (value) => {
        if (typeof value !== "string" || value.trim() === "") return undefined;
        return value.replace(/[\s().-]/gu, "");
      },
      z.string().regex(/^\+[1-9]\d{7,14}$/u, "Bitte internationale Telefonnummer prüfen.").optional(),
    ),
    companySizeCode: z.enum(LEAD_COMPANY_SIZE_CODES),
    hiringNeedCode: z.enum(LEAD_HIRING_NEED_CODES),
    interestCode: z.enum(LEAD_INTEREST_CODES),
    message: trimmedString(20, 2_000),
    callbackWindowCode: z.preprocess(
      (value) => value === "" ? undefined : value,
      z.enum(LEAD_CALLBACK_WINDOW_CODES).optional(),
    ),
    acceptedContactPurpose: z.literal("yes", {
      error: "Bitte bestätige den Kontaktzweck.",
    }),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
    websiteConfirmation: z.string().max(200),
  })
  .strict();

export type BillingAddressInput = z.infer<typeof billingAddressSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type LeadFormInput = z.infer<typeof leadFormSchema>;
