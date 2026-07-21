import { z } from "zod";

import {
  NotificationKind as NotificationKinds,
  type NotificationKind,
} from "@/lib/generated/prisma/enums";

const routeId = z.uuid();

export const APPLICATION_NOTIFICATION_REASON_CODES_V1 = [
  "NOT_A_MATCH",
  "POSITION_FILLED",
  "REQUIREMENTS_NOT_MET",
  "OTHER_REVIEWED",
  "CANDIDATE_WITHDRAWN",
] as const;

export const CONTACT_CANCELLATION_REASON_CODES_V1 = [
  "CANDIDATE_OPTED_OUT",
  "CANDIDATE_PROFILE_INCOMPLETE",
  "CANDIDATE_USER_UNAVAILABLE",
  "COMPANY_INACTIVE",
  "COMPANY_VERIFICATION_LOST",
  "REQUESTING_COMPANY_CANCELLED",
] as const;

export const JOB_REVIEW_REASON_CODES_V1 = [
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "PUBLISHED",
  "PAUSED",
  "EXPIRED",
  "CLOSED",
] as const;

export const COMPANY_VERIFICATION_REASON_CODES_V1 = [
  "EVIDENCE_REQUESTED",
  "VERIFIED",
  "REJECTED",
  "REVOKED",
] as const;

export const TEAM_MEMBERSHIP_REASON_CODES_V1 = [
  "ROLE_CHANGED",
  "SUSPENDED",
  "REACTIVATED",
  "PLAN_LIMIT_SUSPENDED",
  "PLAN_LIMIT_REACTIVATED",
  "REMOVED",
] as const;

export const SUBSCRIPTION_REASON_CODES_V1 = [
  "ACTIVATED",
  "UPGRADED",
  "DOWNGRADED",
  "CANCELLATION_SCHEDULED",
  "CANCELLED",
  "EXPIRED",
] as const;

export const USAGE_WARNING_REASON_CODES_V1 = [
  "ACTIVE_JOB_LIMIT_NEAR",
  "ACTIVE_JOB_LIMIT_REACHED",
  "SEAT_LIMIT_NEAR",
  "SEAT_LIMIT_REACHED",
  "TALENT_CONTACT_ALLOWANCE_NEAR",
  "TALENT_CONTACT_ALLOWANCE_EXHAUSTED",
  "JOB_BOOST_ALLOWANCE_NEAR",
  "JOB_BOOST_ALLOWANCE_EXHAUSTED",
] as const;

export const SUPPORT_CASE_REASON_CODES_V1 = [
  "TRIAGED",
  "ASSIGNED",
  "REQUESTER_INPUT_REQUIRED",
  "REPLIED",
  "RESOLVED",
  "REOPENED",
  "CLOSED",
] as const;

export const PRIVACY_REQUEST_REASON_CODES_V1 = [
  "IDENTITY_CHECK_REQUIRED",
  "IDENTITY_VERIFIED",
  "PROCESSING_STARTED",
  "MANIFEST_CREATED",
  "COMPLETED",
  "IDENTITY_NOT_VERIFIED",
  "DUPLICATE",
  "OUT_OF_SCOPE",
  "INSUFFICIENT_INFORMATION",
  "ABUSIVE_REQUEST",
  "CANCELLED",
] as const;

export const NOTIFICATION_PAYLOADS_V1 = Object.freeze({
  [NotificationKinds.APPLICATION_SUBMITTED]: z.strictObject({
    applicationId: routeId,
    status: z.literal("SUBMITTED"),
  }),
  [NotificationKinds.APPLICATION_STATUS_CHANGED]: z.strictObject({
    applicationId: routeId,
    status: z.enum([
      "IN_REVIEW",
      "SHORTLISTED",
      "INTERVIEW",
      "OFFER",
      "HIRED",
      "REJECTED",
      "WITHDRAWN",
    ]),
    reasonCode: z.enum(APPLICATION_NOTIFICATION_REASON_CODES_V1).optional(),
  }),
  [NotificationKinds.MESSAGE_RECEIVED]: z.strictObject({
    conversationId: routeId,
    status: z.literal("UNREAD"),
  }),
  [NotificationKinds.CONTACT_REQUEST_RECEIVED]: z.strictObject({
    requestId: routeId,
    status: z.literal("PENDING"),
  }),
  [NotificationKinds.CONTACT_REQUEST_ACCEPTED]: z.strictObject({
    requestId: routeId,
    status: z.literal("ACCEPTED"),
  }),
  [NotificationKinds.CONTACT_REQUEST_DECLINED]: z.strictObject({
    requestId: routeId,
    status: z.literal("DECLINED"),
  }),
  [NotificationKinds.CONTACT_REQUEST_CANCELLED]: z.strictObject({
    requestId: routeId,
    status: z.literal("CANCELLED"),
    reasonCode: z.enum(CONTACT_CANCELLATION_REASON_CODES_V1),
  }),
  [NotificationKinds.IDENTITY_REVEAL_GRANTED]: z.strictObject({
    contactRequestId: routeId,
    grantId: routeId,
    status: z.literal("GRANTED"),
  }),
  [NotificationKinds.IDENTITY_REVEAL_REVOKED]: z.strictObject({
    contactRequestId: routeId,
    grantId: routeId,
    status: z.literal("REVOKED"),
  }),
  [NotificationKinds.JOB_REVIEW_CHANGED]: z.strictObject({
    jobId: routeId,
    status: z.enum([
      "IN_REVIEW",
      "CHANGES_REQUESTED",
      "APPROVED",
      "REJECTED",
      "PUBLISHED",
      "PAUSED",
      "EXPIRED",
      "CLOSED",
    ]),
    reasonCode: z.enum(JOB_REVIEW_REASON_CODES_V1).optional(),
  }),
  [NotificationKinds.COMPANY_VERIFICATION_CHANGED]: z.strictObject({
    verificationRequestId: routeId,
    status: z.enum([
      "PENDING",
      "CHANGES_REQUESTED",
      "VERIFIED",
      "REJECTED",
      "REVOKED",
    ]),
    reasonCode: z.enum(COMPANY_VERIFICATION_REASON_CODES_V1).optional(),
  }),
  [NotificationKinds.TEAM_INVITATION_CREATED]: z.strictObject({
    invitationId: routeId,
    status: z.literal("PENDING"),
  }),
  [NotificationKinds.TEAM_MEMBERSHIP_CHANGED]: z.strictObject({
    membershipId: routeId,
    status: z.enum(["ACTIVE", "SUSPENDED", "REMOVED"]),
    reasonCode: z.enum(TEAM_MEMBERSHIP_REASON_CODES_V1).optional(),
  }),
  [NotificationKinds.ORDER_PAID]: z.strictObject({
    orderId: routeId,
    status: z.literal("PAID"),
  }),
  [NotificationKinds.INVOICE_ISSUED]: z.strictObject({
    invoiceId: routeId,
    status: z.literal("ISSUED"),
  }),
  [NotificationKinds.SUBSCRIPTION_CHANGED]: z.strictObject({
    subscriptionId: routeId,
    status: z.enum([
      "SCHEDULED",
      "ACTIVE",
      "CANCELLING",
      "EXPIRED",
      "CANCELLED",
    ]),
    reasonCode: z.enum(SUBSCRIPTION_REASON_CODES_V1).optional(),
  }),
  [NotificationKinds.USAGE_WARNING]: z.strictObject({
    companyId: routeId,
    status: z.literal("WARNING"),
    reasonCode: z.enum(USAGE_WARNING_REASON_CODES_V1),
  }),
  [NotificationKinds.SYSTEM_TASK_ASSIGNED]: z.strictObject({
    taskId: routeId,
    status: z.literal("ASSIGNED"),
  }),
  [NotificationKinds.SUPPORT_CASE_CHANGED]: z.strictObject({
    caseId: routeId,
    status: z.enum([
      "OPEN",
      "TRIAGED",
      "WAITING_FOR_REQUESTER",
      "IN_PROGRESS",
      "RESOLVED",
      "CLOSED",
    ]),
    reasonCode: z.enum(SUPPORT_CASE_REASON_CODES_V1).optional(),
  }),
  [NotificationKinds.MODERATION_CHANGED]: z.strictObject({
    reportId: routeId,
    restrictionId: routeId,
    status: z.enum(["APPLIED", "LIFTED", "EXPIRED"]),
  }),
  [NotificationKinds.PRIVACY_REQUEST_CHANGED]: z.strictObject({
    requestId: routeId,
    type: z.enum(["EXPORT", "DELETE", "CORRECT"]),
    status: z.enum([
      "PENDING",
      "IDENTITY_CHECK",
      "IN_PROGRESS",
      "COMPLETED",
      "REJECTED",
      "CANCELLED",
    ]),
    reasonCode: z.enum(PRIVACY_REQUEST_REASON_CODES_V1).optional(),
  }),
} satisfies Record<NotificationKind, z.ZodType>);

export type NotificationPayloadsV1 = {
  readonly [Kind in NotificationKind]: z.output<
    (typeof NOTIFICATION_PAYLOADS_V1)[Kind]
  >;
};

export function parseNotificationPayloadV1<Kind extends NotificationKind>(
  kind: Kind,
  payload: unknown,
): NotificationPayloadsV1[Kind] {
  return NOTIFICATION_PAYLOADS_V1[kind].parse(
    payload,
  ) as NotificationPayloadsV1[Kind];
}
