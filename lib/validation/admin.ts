import { z } from "zod";

import {
  AbuseSeverity,
  AbuseStatus,
  BillingInterval,
  PlanPriceMode,
  ProductType,
} from "@/lib/generated/prisma/enums";
import { trimmedString, uuidSchema } from "@/lib/validation/common";

export const planSchema = z
  .object({
    code: trimmedString(2, 64).transform((value) => value.toUpperCase()),
    name: trimmedString(2, 160),
    priceMode: z.enum(PlanPriceMode),
    billingInterval: z.enum(BillingInterval),
    termMonths: z.number().int().min(1).max(60),
    netPriceRappen: z.number().int().nonnegative().optional(),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date().optional(),
  })
  .strict();

export const productSchema = z
  .object({
    code: trimmedString(2, 64).transform((value) => value.toUpperCase()),
    name: trimmedString(2, 160),
    type: z.enum(ProductType),
    netPriceRappen: z.number().int().nonnegative(),
    durationDays: z.number().int().positive().max(366).optional(),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date().optional(),
  })
  .strict();

export const categorySchema = z
  .object({
    name: trimmedString(2, 160),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
    parentId: uuidSchema.optional(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .strict();

export const abuseStatusUpdateSchema = z
  .object({
    reportId: uuidSchema,
    status: z.enum(AbuseStatus),
    severity: z.enum(AbuseSeverity),
    reasonCode: trimmedString(2, 64),
    idempotencyKey: trimmedString(8, 128),
  })
  .strict();

export type PlanInput = z.infer<typeof planSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type AbuseStatusUpdateInput = z.infer<typeof abuseStatusUpdateSchema>;
