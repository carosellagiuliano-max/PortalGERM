import { z } from "zod";

import type { DatabaseClient } from "@/lib/db/factory";
import type { EmailProvider } from "@/lib/providers/email";
import type { PaymentProvider } from "@/lib/providers/payments";

export const billingIdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);

export const planCheckoutIntentSchema = z.strictObject({
  kind: z.literal("PLAN"),
  planSlug: z.enum(["starter", "pro"]),
  retainedMembershipIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((values) => new Set(values).size === values.length)
    .optional(),
  idempotencyKey: billingIdempotencyKeySchema,
});

const contactPackCheckoutIntentSchema = z.strictObject({
  kind: z.literal("PRODUCT"),
  productSlug: z.enum(["contact-pack-10", "contact-pack-50"]),
  quantity: z.coerce.number().int().min(1).max(10).default(1),
  idempotencyKey: billingIdempotencyKeySchema,
});

const boostCheckoutIntentSchema = z.strictObject({
  kind: z.literal("PRODUCT"),
  productSlug: z.enum(["boost-7d", "boost-30d"]),
  quantity: z.coerce.number().pipe(z.literal(1)).default(1),
  targetJobId: z.uuid(),
  idempotencyKey: billingIdempotencyKeySchema,
});

const additionalJobCheckoutIntentSchema = z.strictObject({
  kind: z.literal("PRODUCT"),
  productSlug: z.literal("additional-job-30d"),
  quantity: z.coerce.number().pipe(z.literal(1)).default(1),
  targetJobId: z.uuid(),
  idempotencyKey: billingIdempotencyKeySchema,
});

const importSetupCheckoutIntentSchema = z.strictObject({
  kind: z.literal("PRODUCT"),
  productSlug: z.literal("import-setup"),
  quantity: z.coerce.number().pipe(z.literal(1)).default(1),
  importSetupApprovalId: z.uuid(),
  idempotencyKey: billingIdempotencyKeySchema,
});

export const productCheckoutIntentSchema = z.union([
  contactPackCheckoutIntentSchema,
  boostCheckoutIntentSchema,
  additionalJobCheckoutIntentSchema,
  importSetupCheckoutIntentSchema,
]);

export const checkoutIntentSchema = z.union([
  planCheckoutIntentSchema,
  productCheckoutIntentSchema,
]);

export const confirmPaymentSchema = z.strictObject({
  orderId: z.uuid(),
  idempotencyKey: billingIdempotencyKeySchema,
});

export type CheckoutIntent = z.infer<typeof checkoutIntentSchema>;
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;

export type BillingMembershipRole = "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";

export type BillingActor = Readonly<{
  userId: string;
  email: string;
  companyId: string;
  membershipId: string;
  membershipRole: BillingMembershipRole;
}>;

export type BillingDependencies = Readonly<{
  actor: BillingActor;
  correlationId: string;
  database: DatabaseClient;
  paymentProvider: PaymentProvider;
  emailProvider: EmailProvider;
  now?: Date;
}>;

export type BillingCommandErrorCode =
  | "INVALID_INPUT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_MISMATCH"
  | "PROFILE_REQUIRED"
  | "CATALOG_UNAVAILABLE"
  | "TAX_UNAVAILABLE"
  | "SAME_PLAN"
  | "CHANGE_ALREADY_SCHEDULED"
  | "PLAN_NOT_SELF_SERVICE"
  | "PRODUCT_NOT_AVAILABLE"
  | "PRODUCT_RELEASE_REQUIRED"
  | "PRODUCT_CONTEXT_INVALID"
  | "ADDITIONAL_JOB_NOT_ELIGIBLE"
  | "IMPORT_SETUP_NOT_ELIGIBLE"
  | "TALENT_RADAR_REQUIRED"
  | "FULFILLMENT_HANDLER_MISSING"
  | "ORDER_EXPIRED"
  | "ORDER_NOT_PENDING"
  | "PAYMENT_PROVIDER_FAILED"
  | "WRITE_FAILED";

export type BillingCommandResult<TValue> = Readonly<
  | { ok: true; value: TValue; replay?: boolean }
  | { ok: false; code: BillingCommandErrorCode }
>;

export function billingSuccess<TValue>(
  value: TValue,
  replay = false,
): BillingCommandResult<TValue> {
  return Object.freeze({
    ok: true,
    value: Object.freeze(value),
    ...(replay ? { replay: true } : {}),
  });
}

export function billingFailure(
  code: BillingCommandErrorCode,
): BillingCommandResult<never> {
  return Object.freeze({ ok: false, code });
}

export function normalizeBillingNow(value: Date | undefined): Date {
  const input = value ?? new Date();
  if (!Number.isFinite(input.getTime())) {
    throw new TypeError("Billing commands require a valid clock.");
  }
  return new Date(Math.floor(input.getTime() / 1_000) * 1_000);
}

export function canManageBillingProfile(role: BillingMembershipRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManagePlan(role: BillingMembershipRole): boolean {
  return role === "OWNER";
}
