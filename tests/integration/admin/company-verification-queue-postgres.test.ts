import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listCompanyVerificationQueue } from "@/lib/companies/verification/admin-service";
import { beginCompanyVerification } from "@/lib/companies/verification/owner-service";
import { assessCompanyVerificationCapacity } from "@/lib/companies/verification/capacity";
import {
  createPhase26CompanyTrustFixture,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

let fixture: Phase26CompanyTrustFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("queue");
  const current = fixture;
  const companyIds = Array.from({ length: 100 }, () => randomUUID());
  await current.database.company.createMany({
    data: companyIds.map((id, index) => ({
      id,
      name: `Phase 26 Queue Company ${index}`,
      slug: `phase26-queue-company-${id}`,
      status: "DRAFT" as const,
      dataProvenance: "TEST" as const,
      values: [],
      benefits: [],
    })),
  });
  await current.database.companyVerificationRequest.createMany({
    data: Array.from({ length: 100 }, (_, index) => {
      const createdAt = new Date(current.now.getTime() - index * 60_000);
      return {
        id: randomUUID(),
        companyId: companyIds[index]!,
        requestedByUserId: current.owner.userId,
        status: "PENDING" as const,
        riskLevel:
          index % 10 === 0 ? ("HIGH" as const) : ("NORMAL" as const),
        policyVersion: "COMPANY_TRUST_POLICY_V2",
        priority: 100 - index,
        version: 1,
        reviewDueAt: new Date(
          current.now.getTime() + (index % 4) * 86_400_000,
        ),
        createdAt,
        updatedAt: createdAt,
      };
    }),
  });
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe.sequential("Phase 26 reviewer queue and capacity", () => {
  it("keyset-pages all 100 rows in stable priority/SLA order with no duplicates", async () => {
    const current = fixture!;
    const dependencies = current.adminDependencies();
    const rows: NonNullable<
      Awaited<ReturnType<typeof listCompanyVerificationQueue>>
    > = [];
    let after:
      | { priority: number; reviewDueAt: Date; id: string }
      | undefined;
    while (rows.length < 100) {
      const page = await listCompanyVerificationQueue(dependencies, {
        limit: 37,
        ...(after === undefined ? {} : { after }),
      });
      expect(page).not.toBeNull();
      if (page === null || page.length === 0) break;
      rows.push(...page);
      const last = page.at(-1)!;
      if (last.reviewDueAt === null) {
        throw new Error("Phase 26 queue row lacks its SLA boundary.");
      }
      after = {
        priority: last.priority,
        reviewDueAt: last.reviewDueAt,
        id: last.id,
      };
    }
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map((row) => row.id)).size).toBe(100);
    expect(rows.map((row) => row.priority)).toEqual(
      Array.from({ length: 100 }, (_, index) => 100 - index),
    );
    await expect(
      listCompanyVerificationQueue(
        current.adminDependencies(current.approver),
        { limit: 10 },
      ),
    ).resolves.toBeNull();
  });

  it("uses p95 handling time plus the 30 percent buffer to stop unsafe admission", () => {
    const handlingMinutes = Array.from(
      { length: 100 },
      (_, index) => 10 + (index % 10),
    );
    const available = assessCompanyVerificationCapacity({
      handlingMinutes,
      reviewerMinutesPerDay: [480, 480],
      arrivalsPerDay: 2,
      openQueueCount: 10,
      oldestQueueAgeHours: 4,
    });
    expect(available).toMatchObject({
      sampleSize: 100,
      p50HandlingMinutes: 14,
      p95HandlingMinutes: 19,
      admissionAllowed: true,
      reason: "CAPACITY_AVAILABLE",
    });
    const blocked = assessCompanyVerificationCapacity({
      handlingMinutes,
      reviewerMinutesPerDay: [480],
      arrivalsPerDay: 30,
      openQueueCount: 100,
      oldestQueueAgeHours: 96,
    });
    expect(blocked).toMatchObject({
      sampleSize: 100,
      admissionAllowed: false,
      reason: "FORECAST_EXCEEDS_BUFFERED_CAPACITY",
    });
  });

  it("fails closed before admitting request 101 into the bounded sandbox queue", async () => {
    const current = fixture!;
    const before = await current.database.companyVerificationRequest.count({
      where: {
        policyVersion: "COMPANY_TRUST_POLICY_V2",
        status: { in: ["PENDING", "CHANGES_REQUESTED"] },
      },
    });
    expect(before).toBe(100);
    await expect(
      beginCompanyVerification(
        {
          companyId: current.companyId,
          membershipId: current.ownerMembershipId,
          expectedCurrentRequestId: null,
          uid: "CHE-111.000.001",
          legalName: "Phase 26 Prüfwerk AG",
          cantonCode: "ZH",
          domain: "phase26-company.example.test",
          idempotencyKey: randomUUID(),
        },
        current.ownerDependencies(),
      ),
    ).resolves.toEqual({ ok: false, code: "CAPACITY_BLOCKED" });
    await expect(
      current.database.companyVerificationRequest.count({
        where: {
          policyVersion: "COMPANY_TRUST_POLICY_V2",
          status: { in: ["PENDING", "CHANGES_REQUESTED"] },
        },
      }),
    ).resolves.toBe(100);
  });
});
