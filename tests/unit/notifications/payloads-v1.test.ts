import { describe, expect, it } from "vitest";

import {
  NotificationKind as NotificationKinds,
  type NotificationKind,
} from "@/lib/generated/prisma/enums";
import {
  NOTIFICATION_PAYLOADS_V1,
  parseNotificationPayloadV1,
  type NotificationPayloadsV1,
} from "@/lib/notifications/payloads-v1";

const id = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const VALID_PAYLOADS = {
  APPLICATION_SUBMITTED: { applicationId: id(1), status: "SUBMITTED" },
  APPLICATION_STATUS_CHANGED: {
    applicationId: id(2),
    status: "REJECTED",
    reasonCode: "NOT_A_MATCH",
  },
  MESSAGE_RECEIVED: { conversationId: id(3), status: "UNREAD" },
  CONTACT_REQUEST_RECEIVED: { requestId: id(4), status: "PENDING" },
  CONTACT_REQUEST_ACCEPTED: { requestId: id(5), status: "ACCEPTED" },
  CONTACT_REQUEST_DECLINED: { requestId: id(6), status: "DECLINED" },
  CONTACT_REQUEST_CANCELLED: {
    requestId: id(7),
    status: "CANCELLED",
    reasonCode: "COMPANY_INACTIVE",
  },
  IDENTITY_REVEAL_GRANTED: {
    contactRequestId: id(8),
    grantId: id(9),
    status: "GRANTED",
  },
  IDENTITY_REVEAL_REVOKED: {
    contactRequestId: id(10),
    grantId: id(11),
    status: "REVOKED",
  },
  JOB_REVIEW_CHANGED: {
    jobId: id(12),
    status: "CHANGES_REQUESTED",
    reasonCode: "CHANGES_REQUESTED",
  },
  COMPANY_VERIFICATION_CHANGED: {
    verificationRequestId: id(13),
    status: "VERIFIED",
    reasonCode: "VERIFIED",
  },
  TEAM_INVITATION_CREATED: { invitationId: id(14), status: "PENDING" },
  TEAM_MEMBERSHIP_CHANGED: {
    membershipId: id(15),
    status: "SUSPENDED",
    reasonCode: "PLAN_LIMIT_SUSPENDED",
  },
  ORDER_PAID: { orderId: id(16), status: "PAID" },
  INVOICE_ISSUED: { invoiceId: id(17), status: "ISSUED" },
  SUBSCRIPTION_CHANGED: {
    subscriptionId: id(18),
    status: "CANCELLING",
    reasonCode: "CANCELLATION_SCHEDULED",
  },
  USAGE_WARNING: {
    companyId: id(19),
    status: "WARNING",
    reasonCode: "ACTIVE_JOB_LIMIT_NEAR",
  },
  SYSTEM_TASK_ASSIGNED: { taskId: id(20), status: "ASSIGNED" },
  SUPPORT_CASE_CHANGED: {
    caseId: id(21),
    status: "WAITING_FOR_REQUESTER",
    reasonCode: "REQUESTER_INPUT_REQUIRED",
  },
  PRIVACY_REQUEST_CHANGED: {
    requestId: id(22),
    type: "EXPORT",
    status: "IDENTITY_CHECK",
    reasonCode: "IDENTITY_CHECK_REQUIRED",
  },
} as const satisfies NotificationPayloadsV1;

const ROUTE_ID_KEYS = {
  APPLICATION_SUBMITTED: "applicationId",
  APPLICATION_STATUS_CHANGED: "applicationId",
  MESSAGE_RECEIVED: "conversationId",
  CONTACT_REQUEST_RECEIVED: "requestId",
  CONTACT_REQUEST_ACCEPTED: "requestId",
  CONTACT_REQUEST_DECLINED: "requestId",
  CONTACT_REQUEST_CANCELLED: "requestId",
  IDENTITY_REVEAL_GRANTED: "contactRequestId",
  IDENTITY_REVEAL_REVOKED: "contactRequestId",
  JOB_REVIEW_CHANGED: "jobId",
  COMPANY_VERIFICATION_CHANGED: "verificationRequestId",
  TEAM_INVITATION_CREATED: "invitationId",
  TEAM_MEMBERSHIP_CHANGED: "membershipId",
  ORDER_PAID: "orderId",
  INVOICE_ISSUED: "invoiceId",
  SUBSCRIPTION_CHANGED: "subscriptionId",
  USAGE_WARNING: "companyId",
  SYSTEM_TASK_ASSIGNED: "taskId",
  SUPPORT_CASE_CHANGED: "caseId",
  PRIVACY_REQUEST_CHANGED: "requestId",
} as const satisfies Record<NotificationKind, string>;

describe("NOTIFICATION_PAYLOADS_V1", () => {
  it("covers every Prisma NotificationKind exactly once", () => {
    expect(Object.keys(NOTIFICATION_PAYLOADS_V1)).toEqual(
      Object.values(NotificationKinds),
    );
    expect(Object.keys(NOTIFICATION_PAYLOADS_V1)).toHaveLength(20);
  });

  it("accepts one strict recipient-scoped payload for every kind", () => {
    for (const kind of Object.values(NotificationKinds)) {
      expect(parseNotificationPayloadV1(kind, VALID_PAYLOADS[kind])).toEqual(
        VALID_PAYLOADS[kind],
      );
    }
  });

  it("freezes the four explicitly required payload shapes", () => {
    expect(Object.keys(VALID_PAYLOADS.CONTACT_REQUEST_CANCELLED).sort()).toEqual(
      ["reasonCode", "requestId", "status"],
    );
    expect(Object.keys(VALID_PAYLOADS.IDENTITY_REVEAL_REVOKED).sort()).toEqual([
      "contactRequestId",
      "grantId",
      "status",
    ]);
    expect(Object.keys(VALID_PAYLOADS.SUPPORT_CASE_CHANGED).sort()).toEqual([
      "caseId",
      "reasonCode",
      "status",
    ]);
    expect(Object.keys(VALID_PAYLOADS.PRIVACY_REQUEST_CHANGED).sort()).toEqual([
      "reasonCode",
      "requestId",
      "status",
      "type",
    ]);
  });

  it("rejects unknown properties for every kind", () => {
    for (const kind of Object.values(NotificationKinds)) {
      expect(() =>
        parseNotificationPayloadV1(kind, {
          ...VALID_PAYLOADS[kind],
          unexpected: "not-allowlisted",
        }),
      ).toThrow();
    }
  });

  it("rejects a missing recipient-scoped route id for every kind", () => {
    for (const kind of Object.values(NotificationKinds)) {
      const routeIdKey = ROUTE_ID_KEYS[kind];
      const withoutRouteId = Object.fromEntries(
        Object.entries(VALID_PAYLOADS[kind]).filter(
          ([key]) => key !== routeIdKey,
        ),
      );
      expect(() => parseNotificationPayloadV1(kind, withoutRouteId)).toThrow();
    }
  });

  it("rejects status drift and open reason codes", () => {
    for (const kind of Object.values(NotificationKinds)) {
      expect(() =>
        parseNotificationPayloadV1(kind, {
          ...VALID_PAYLOADS[kind],
          status: "ARBITRARY_STATUS",
        }),
      ).toThrow();
    }

    for (const kind of [
      "APPLICATION_STATUS_CHANGED",
      "CONTACT_REQUEST_CANCELLED",
      "JOB_REVIEW_CHANGED",
      "COMPANY_VERIFICATION_CHANGED",
      "TEAM_MEMBERSHIP_CHANGED",
      "SUBSCRIPTION_CHANGED",
      "USAGE_WARNING",
      "SUPPORT_CASE_CHANGED",
      "PRIVACY_REQUEST_CHANGED",
    ] as const) {
      expect(() =>
        parseNotificationPayloadV1(kind, {
          ...VALID_PAYLOADS[kind],
          reasonCode: "FREE_TEXT_REASON",
        }),
      ).toThrow();
    }
  });

  it("rejects PII/content canaries from every payload", () => {
    const forbiddenProperties = [
      "message",
      "note",
      "correctionText",
      "manifest",
      "email",
      "name",
      "phone",
      "cv",
    ];

    for (const kind of Object.values(NotificationKinds)) {
      for (const property of forbiddenProperties) {
        expect(() =>
          parseNotificationPayloadV1(kind, {
            ...VALID_PAYLOADS[kind],
            [property]: "private-canary-value",
          }),
        ).toThrow();
      }
    }
  });
});
