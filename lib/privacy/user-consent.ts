import { z } from "zod";

import {
  UserConsentKind,
  type UserConsentKind as UserConsentKindType,
} from "@/lib/generated/prisma/enums";

export const USER_CONSENT_NOTICES_V1 = Object.freeze({
  TERMS: Object.freeze({ noticeVersion: "terms-v1", purpose: "Terms acceptance" }),
  MARKETING: Object.freeze({ noticeVersion: "marketing-v1", purpose: "Marketing communication" }),
  DATA_USE: Object.freeze({ noticeVersion: "data-use-v1", purpose: "Profile data use" }),
  JOB_ALERT_DELIVERY: Object.freeze({
    noticeVersion: "job-alert-delivery-v1",
    purpose: "Job alert delivery",
  }),
} as const satisfies Record<
  UserConsentKindType,
  Readonly<{ noticeVersion: string; purpose: string }>
>);

const userConsentKindSchema = z.enum(UserConsentKind);

export const userConsentCommandSchema = z
  .object({
    userId: z.string().uuid(),
    actorUserId: z.string().uuid().nullable(),
    kind: userConsentKindSchema,
    granted: z.boolean(),
    purpose: z.string().min(1).max(160),
    noticeVersion: z.string().min(1).max(32),
    noticeHash: z.string().regex(/^[a-f0-9]{64}$/),
    effectiveAt: z.date(),
  })
  .strict()
  .superRefine((input, context) => {
    const notice = USER_CONSENT_NOTICES_V1[input.kind];
    if (input.noticeVersion !== notice.noticeVersion) {
      context.addIssue({
        code: "custom",
        path: ["noticeVersion"],
        message: "Consent notice is not current.",
      });
    }
    if (input.purpose !== notice.purpose) {
      context.addIssue({
        code: "custom",
        path: ["purpose"],
        message: "Consent purpose does not match its closed kind.",
      });
    }
  });

export type UserConsentEventInput = z.infer<typeof userConsentCommandSchema>;

export interface UserConsentRepository {
  append(input: UserConsentEventInput): Promise<void>;
  latest(
    userId: string,
    kind: UserConsentKindType,
    at: Date,
  ): Promise<Readonly<{ granted: boolean; noticeVersion: string }> | null>;
}

export async function recordUserConsent(
  input: unknown,
  repository: UserConsentRepository,
): Promise<void> {
  await repository.append(userConsentCommandSchema.parse(input));
}

export async function hasCurrentUserConsent(
  userId: string,
  kind: UserConsentKindType,
  at: Date,
  repository: UserConsentRepository,
): Promise<boolean> {
  if (
    !z.string().uuid().safeParse(userId).success ||
    !userConsentKindSchema.safeParse(kind).success ||
    !(at instanceof Date) ||
    !Number.isFinite(at.getTime())
  ) {
    return false;
  }
  const event = await repository.latest(userId, kind, at);
  return event?.granted === true &&
    event.noticeVersion === USER_CONSENT_NOTICES_V1[kind].noticeVersion;
}
