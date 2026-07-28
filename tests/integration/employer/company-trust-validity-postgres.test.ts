import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { projectCompanyTrustLifecycle } from "@/lib/companies/verification/lifecycle";
import { evaluateCompanyTrustForCompany } from "@/lib/companies/verification/read-model";
import {
  createPhase26CompanyTrustFixture,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

const DAY = 86_400_000;
let fixture: Phase26CompanyTrustFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("validity");
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe.sequential("Phase 26 trust validity and lifecycle boundaries", () => {
  it("keeps EXPIRING current, fails closed at the exact expiry and deduplicates reminders", async () => {
    const current = fixture!;
    const expiresAt = new Date(current.now.getTime() + 7 * DAY);
    await current.createStrongTrust({ expiresAt });
    const options = {
      environment: "production" as const,
      activation: {
        policyMode: "enforce" as const,
        strongBadge: true,
        publicEligibility: true,
        rapidRevoke: true,
        legacyDemoCompatibility: false,
      },
    };

    const firstLifecycle = await projectCompanyTrustLifecycle({
      database: current.database,
      correlationId: randomUUID(),
      now: current.now,
    });
    expect(firstLifecycle).toEqual({
      inspected: 1,
      expired: 0,
      markedExpiring: 1,
      remindersCreated: 3,
      radarRequestsCancelled: 0,
    });
    const beforeBoundary = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      {
        ...options,
        now: new Date(expiresAt.getTime() - 1),
      },
    );
    expect(beforeBoundary).toMatchObject({
      current: true,
      publicEligible: true,
      reason: "STRONG_CURRENT",
    });

    const replay = await projectCompanyTrustLifecycle({
      database: current.database,
      correlationId: randomUUID(),
      now: current.now,
    });
    expect(replay).toMatchObject({
      inspected: 1,
      expired: 0,
      markedExpiring: 0,
      remindersCreated: 0,
    });

    const atBoundary = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      { ...options, now: expiresAt },
    );
    expect(atBoundary).toMatchObject({
      current: false,
      badge: null,
      publicEligible: false,
      radarEligible: false,
      reason: "TRUST_NOT_CURRENT",
    });

    const expiry = await projectCompanyTrustLifecycle({
      database: current.database,
      correlationId: randomUUID(),
      now: expiresAt,
    });
    expect(expiry).toMatchObject({
      inspected: 1,
      expired: 1,
      markedExpiring: 0,
      remindersCreated: 1,
    });
    const expiryReplay = await projectCompanyTrustLifecycle({
      database: current.database,
      correlationId: randomUUID(),
      now: expiresAt,
    });
    expect(expiryReplay).toEqual({
      inspected: 0,
      expired: 0,
      markedExpiring: 0,
      remindersCreated: 0,
      radarRequestsCancelled: 0,
    });
    expect(
      await current.database.notification.count({
        where: {
          recipientUserId: current.owner.userId,
          kind: "COMPANY_VERIFICATION_CHANGED",
        },
      }),
    ).toBe(4);
    expect(
      await current.database.companyVerificationEvidence.count({
        where: {
          companyId: current.companyId,
          status: "VALID",
          validTo: { lte: expiresAt },
        },
      }),
    ).toBe(0);
  });
});
