// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  AuditInputValidationError,
  buildAuditPersistenceRecord,
  type RequiredAuditInput,
} from "@/lib/audit/log";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";
const IDENTIFIER_HASH = `auth-v1:${"a".repeat(64)}`;

function input(
  overrides: Partial<RequiredAuditInput>,
): RequiredAuditInput {
  return {
    action: "USER_REGISTERED",
    actorKind: "USER",
    actorUserId: USER_ID,
    capability: "AUTH_REGISTER",
    correlationId: CORRELATION_ID,
    result: "SUCCEEDED",
    retainUntil: new Date("2036-07-20T00:00:00.000Z"),
    targetId: USER_ID,
    targetType: "USER",
    ...overrides,
  };
}

describe("Phase 06 auth audit metadata allowlist", () => {
  it.each(["CANDIDATE", "EMPLOYER"] as const)(
    "allows only the bounded registration role %s",
    (role) => {
      expect(
        buildAuditPersistenceRecord(input({ metadata: { role } })),
      ).toMatchObject({ metadata: { role } });
    },
  );

  it("allows only a versioned keyed identifier hash for failed login", () => {
    expect(
      buildAuditPersistenceRecord(
        input({
          action: "USER_LOGIN_FAILED",
          actorKind: "ANONYMOUS",
          actorUserId: null,
          result: "DENIED",
          metadata: { identifierHash: IDENTIFIER_HASH },
        }),
      ),
    ).toMatchObject({ metadata: { identifierHash: IDENTIFIER_HASH } });

    for (const metadata of [
      { identifierHash: "person@example.ch" },
      { identifierHash: "a".repeat(64) },
      { identifierHash: IDENTIFIER_HASH, email: "person@example.ch" },
    ]) {
      expect(() =>
        buildAuditPersistenceRecord(
          input({
            action: "USER_LOGIN_FAILED",
            actorKind: "ANONYMOUS",
            actorUserId: null,
            result: "DENIED",
            metadata,
          }),
        ),
      ).toThrow(AuditInputValidationError);
    }
  });

  it.each([
    "COMPANY_CREATED_WITH_OWNER",
    "COMPANY_CLAIM_REQUESTED",
  ] as const)("allows only closed, unique %s signal codes", (action) => {
    expect(
      buildAuditPersistenceRecord(
        input({
          action,
          companyId: COMPANY_ID,
          targetId: COMPANY_ID,
          targetType: action === "COMPANY_CLAIM_REQUESTED" ? "CLAIM_REQUEST" : "COMPANY",
          metadata: { signalCodes: ["EMAIL_DOMAIN", "NAME_CANTON"] },
        }),
      ),
    ).toMatchObject({
      metadata: { signalCodes: ["EMAIL_DOMAIN", "NAME_CANTON"] },
    });

    for (const metadata of [
      { signalCodes: ["UID", "UID"] },
      { signalCodes: ["RAW_DOMAIN"] },
      { signalCodes: ["UID"], uid: "CHE-116.075.613" },
      { signalCodes: ["EMAIL_DOMAIN"], domain: "example.ch" },
    ]) {
      expect(() =>
        buildAuditPersistenceRecord(
          input({ action, metadata }),
        ),
      ).toThrow(AuditInputValidationError);
    }
  });
});
