import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { approveCompanyClaim } from "@/lib/admin/companies";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-21T12:00:00.000Z");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let adminUserId = "";

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase12_claim_seat_limit");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  adminUserId = (
    await database.user.create({
      data: {
        email: "phase12-claim-admin@example.ch",
        emailNormalized: "phase12-claim-admin@example.ch",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
      select: { id: true },
    })
  ).id;
  await createDefaultFreePlan(database);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe("Phase 12 Company-claim seat enforcement", () => {
  it("counts a current pending Invitation as a reserved seat and rejects approval atomically", async () => {
    const client = db();
    const owner = await createEmployer("owner");
    const claimant = await createEmployer("claimant");
    const company = await client.company.create({
      data: {
        name: "Phase 12 Claim Seat AG",
        slug: `phase12-claim-seat-${randomUUID()}`,
        status: "DRAFT",
        dataProvenance: "TEST",
        values: [],
        benefits: [],
      },
      select: { id: true },
    });
    await client.companyMembership.create({
      data: {
        companyId: company.id,
        userId: owner.id,
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: new Date(NOW.getTime() - 86_400_000),
      },
    });
    await client.companyInvitation.create({
      data: {
        companyId: company.id,
        inviterUserId: owner.id,
        inviteeEmailNormalized: "phase12-reserved-seat@example.ch",
        intendedRole: "RECRUITER",
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        status: "PENDING",
        expiresAt: new Date(NOW.getTime() + 86_400_000),
      },
    });
    const claim = await client.companyClaimRequest.create({
      data: {
        requesterEmployerUserId: claimant.id,
        candidateCompanyId: company.id,
        requestedRole: "OWNER",
        matchSignals: { schemaVersion: "1", source: "MANUAL_REVIEW" },
        evidenceSummary: "Reviewed test evidence",
        status: "PENDING",
        idempotencyKey: `phase12-claim-request:${randomUUID()}`,
      },
      select: { id: true },
    });

    await expect(
      approveCompanyClaim(
        {
          claimId: claim.id,
          expectedStatus: "PENDING",
          approvedRole: "ADMIN",
          reasonCode: "MANUAL_EVIDENCE_CONFIRMED",
          evidenceRef: "evidence://phase-12/seat-limit",
          idempotencyKey: randomUUID(),
        },
        dependencies(),
      ),
    ).resolves.toEqual({ ok: false, code: "QUOTA_EXCEEDED" });

    await expect(
      client.companyMembership.count({
        where: { companyId: company.id, userId: claimant.id },
      }),
    ).resolves.toBe(0);
    await expect(
      client.companyClaimRequest.findUniqueOrThrow({
        where: { id: claim.id },
        select: { status: true, approvedRole: true, reviewedAt: true },
      }),
    ).resolves.toEqual({
      status: "PENDING",
      approvedRole: null,
      reviewedAt: null,
    });
    await expect(
      client.companyClaimEvent.count({ where: { claimRequestId: claim.id } }),
    ).resolves.toBe(0);
    await expect(
      client.auditLog.count({
        where: {
          action: "COMPANY_CLAIM_APPROVED",
          targetId: claim.id,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(0);
  });
});

function db(): DatabaseClient {
  if (database === undefined) throw new Error("Claim seat test DB unavailable.");
  return database;
}

function dependencies() {
  return Object.freeze({
    actor: {
      userId: adminUserId,
      email: "phase12-claim-admin@example.ch",
      role: "ADMIN" as const,
      status: "ACTIVE" as const,
    },
    correlationId: randomUUID(),
    database: db(),
    now: NOW,
  });
}

function createEmployer(suffix: string) {
  const email = `phase12-claim-${suffix}-${randomUUID()}@example.ch`;
  return db().user.create({
    data: {
      email,
      emailNormalized: email,
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
    },
    select: { id: true },
  });
}

async function createDefaultFreePlan(client: DatabaseClient) {
  const plan = await client.plan.create({
    data: {
      code: "FREE_BASIC",
      name: "Free Basic",
      isDefaultFree: true,
    },
    select: { id: true },
  });
  const version = await client.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 0,
      monthlyEquivalentRappen: 0,
      currency: "CHF",
      isPublic: true,
      isSelfService: false,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      entitlements: {
        create: [
          integerEntitlement("ACTIVE_JOB_LIMIT", 1),
          integerEntitlement("SEAT_LIMIT", 2),
          booleanEntitlement("TALENT_RADAR_ACCESS", false),
          integerEntitlement("TALENT_CONTACT_ALLOWANCE", 0),
          integerEntitlement("JOB_BOOST_ALLOWANCE", 0),
          {
            key: "ANALYTICS_LEVEL",
            valueType: "ANALYTICS_LEVEL",
            analyticsLevelValue: "NONE",
          },
          booleanEntitlement("ENHANCED_COMPANY_PROFILE", false),
          booleanEntitlement("EMPLOYER_IMPORT_ACCESS", false),
        ],
      },
    },
    select: { id: true },
  });
  await client.planVersion.update({
    where: { id: version.id },
    data: { status: "ACTIVE" },
  });
}

function integerEntitlement(key: "ACTIVE_JOB_LIMIT" | "SEAT_LIMIT" | "TALENT_CONTACT_ALLOWANCE" | "JOB_BOOST_ALLOWANCE", value: number) {
  return { key, valueType: "INTEGER" as const, integerValue: value };
}

function booleanEntitlement(key: "TALENT_RADAR_ACCESS" | "ENHANCED_COMPANY_PROFILE" | "EMPLOYER_IMPORT_ACCESS", value: boolean) {
  return { key, valueType: "BOOLEAN" as const, booleanValue: value };
}
