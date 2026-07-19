import { z } from "zod";

import { BillingInterval } from "@/lib/generated/prisma/enums";
import {
  normalizedEmailSchema,
  swissCantonCodeSchema,
  trimmedString,
  uuidSchema,
} from "@/lib/validation/common";

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
    cantonCode: swissCantonCodeSchema.optional(),
    purpose: z.enum(["SALES", "ENTERPRISE", "IMPORT", "PARTNERSHIP"]),
    message: trimmedString(20, 2_000),
    acceptedPrivacyNoticeVersion: trimmedString(1, 32),
  })
  .strict();

export type BillingAddressInput = z.infer<typeof billingAddressSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type LeadFormInput = z.infer<typeof leadFormSchema>;
