import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_CAPABILITIES_V1 } from "@/lib/admin/capabilities";
import {
  closeCompany,
  reactivateCompany,
  suspendCompany,
} from "@/lib/admin/companies";
import type { AdminDependencies } from "@/lib/admin/common";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-08-06T18:00:00.000Z");
const PERIOD_END = new Date("2026-09-06T18:00:00.000Z");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let adminUserId = "";
let employerUserId = "";
let candidateProfileId = "";
let categoryId = "";
let cantonId = "";
let cityId = "";
let paidPlanVersionId = "";

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase34_company_closure", {
    useTemplate: false,
  });
  database = createDatabaseClient(migrated.connectionString);

  const [admin, employer, candidate] = await Promise.all([
    db().user.create({
      data: {
        email: "phase34-company-close-admin@example.test",
        emailNormalized: "phase34-company-close-admin@example.test",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
        emailVerifiedAt: NOW,
      },
    }),
    db().user.create({
      data: {
        email: "phase34-company-close-employer@example.test",
        emailNormalized: "phase34-company-close-employer@example.test",
        role: "EMPLOYER",
        status: "ACTIVE",
        dataProvenance: "TEST",
        emailVerifiedAt: NOW,
      },
    }),
    db().user.create({
      data: {
        email: "phase34-company-close-candidate@example.test",
        emailNormalized: "phase34-company-close-candidate@example.test",
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "TEST",
        emailVerifiedAt: NOW,
      },
    }),
  ]);
  adminUserId = admin.id;
  employerUserId = employer.id;

  const canton = await db().canton.create({
    data: {
      code: "ZG",
      name: "Zug",
      slug: "phase34-zug",
      language: "DE",
    },
  });
  cantonId = canton.id;
  const [city, category, candidateProfile, plan] = await Promise.all([
    db().city.create({
      data: {
        cantonId,
        name: "Zug",
        slug: "phase34-zug-stadt",
      },
    }),
    db().category.create({
      data: {
        name: "Phase 34 Technik",
        slug: "phase34-technik",
      },
    }),
    db().candidateProfile.create({
      data: {
        userId: candidate.id,
        firstName: "Phase",
        lastName: "Closure",
        onboardingStatus: "DRAFT",
      },
    }),
    db().plan.create({
      data: {
        code: "PHASE34_PAID",
        name: "Phase 34 Paid",
        isDefaultFree: false,
      },
    }),
  ]);
  cityId = city.id;
  categoryId = category.id;
  candidateProfileId = candidateProfile.id;
  paidPlanVersionId = (
    await db().planVersion.create({
      data: {
        planId: plan.id,
        version: 1,
        status: "ACTIVE",
        priceMode: "FIXED",
        billingInterval: "MONTHLY",
        termMonths: 1,
        netPriceRappen: 14_900,
        monthlyEquivalentRappen: 14_900,
        currency: "CHF",
        isPublic: false,
        isSelfService: false,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    })
  ).id;
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase 34 company closure PostgreSQL boundary", () => {
  it("closes only from SUSPENDED, pauses stale published Jobs, revokes Radar mappings and audits once", async () => {
    const company = await createCompany("closable", "ACTIVE");
    const job = await createPublishedJob(company.id, "closable-job");

    requireSuccess(
      await suspendCompany(
        {
          companyId: company.id,
          expectedStatus: "ACTIVE",
          reasonCode: "PLATFORM_RISK_REVIEW",
          idempotencyKey: randomUUID(),
        },
        adminDependencies("phase34-company-suspend"),
      ),
    );

    // Reproduce a legacy/inconsistent row: SUSPENDED companies must still fail
    // closed when an old writer has republished a technically valid Job.
    await db().job.update({
      where: { id: job.id },
      data: { status: "PUBLISHED" },
    });
    const mapping = await db().radarOpaqueMapping.create({
      data: {
        candidateProfileId,
        companyId: company.id,
        epoch: new Date("2026-08-01T00:00:00.000Z"),
        lookupHmac: createHash("sha256")
          .update(`phase34-company-close:${company.id}`, "utf8")
          .digest("hex"),
        encryptedToken: Buffer.alloc(32, 34),
        nonce: Buffer.alloc(12, 3),
        authTag: Buffer.alloc(16, 4),
        lookupKeyVersion: "phase34-lookup-v1",
        encryptionKeyVersion: "phase34-encryption-v1",
        validFrom: NOW,
        validTo: PERIOD_END,
      },
    });
    const idempotencyKey = randomUUID();
    const input = {
      companyId: company.id,
      expectedStatus: "SUSPENDED" as const,
      reasonCode: "COMPANY_OFFBOARDING_COMPLETED",
      confirmationCode: "FIRMA_SCHLIESSEN" as const,
      idempotencyKey,
    };

    await expect(
      closeCompany(input, adminDependencies("phase34-company-close")),
    ).resolves.toEqual({
      ok: true,
      value: { companyId: company.id, status: "CLOSED", pausedJobs: 1 },
    });
    await expect(
      closeCompany(input, adminDependencies("phase34-company-close-replay")),
    ).resolves.toEqual({
      ok: true,
      replay: true,
      value: { companyId: company.id, status: "CLOSED", pausedJobs: 0 },
    });

    await expect(
      db().company.findUniqueOrThrow({
        where: { id: company.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "CLOSED" });
    await expect(
      db().job.findUniqueOrThrow({
        where: { id: job.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PAUSED" });
    await expect(
      db().jobStatusEvent.findFirstOrThrow({
        where: { jobId: job.id, idempotencyKey: { contains: idempotencyKey } },
        select: { kind: true, fromStatus: true, toStatus: true, reasonCode: true },
      }),
    ).resolves.toEqual({
      kind: "PAUSED",
      fromStatus: "PUBLISHED",
      toStatus: "PAUSED",
      reasonCode: "COMPANY_CLOSED",
    });
    await expect(
      db().radarOpaqueMapping.findUniqueOrThrow({
        where: { id: mapping.id },
        select: { revokedAt: true, revocationReason: true },
      }),
    ).resolves.toEqual({
      revokedAt: NOW,
      revocationReason: "COMPANY_INACTIVE",
    });
    await expect(
      db().companyStatusEvent.findMany({
        where: { companyId: company.id, kind: "CLOSED" },
        select: { fromStatus: true, toStatus: true, reasonCode: true },
      }),
    ).resolves.toEqual([
      {
        fromStatus: "SUSPENDED",
        toStatus: "CLOSED",
        reasonCode: "COMPANY_OFFBOARDING_COMPLETED",
      },
    ]);
    await expect(
      db().auditLog.findMany({
        where: { targetId: company.id, action: "COMPANY_CLOSED" },
        select: { action: true, targetType: true, result: true, reasonCode: true },
      }),
    ).resolves.toEqual([
      {
        action: "COMPANY_CLOSED",
        targetType: "COMPANY",
        result: "SUCCEEDED",
        reasonCode: "COMPANY_OFFBOARDING_COMPLETED",
      },
    ]);
    await expect(
      reactivateCompany(
        {
          companyId: company.id,
          expectedStatus: "SUSPENDED",
          reasonCode: "FORGED_REACTIVATION",
          idempotencyKey: randomUUID(),
        },
        adminDependencies("phase34-company-reactivate-closed"),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
  });

  it.each(["SCHEDULED", "ACTIVE", "CANCELLING", "SUSPENDED"] as const)(
    "keeps the company SUSPENDED when a %s paid subscription is unresolved",
    async (subscriptionStatus) => {
      const company = await createCompany(
        `billing-${subscriptionStatus.toLowerCase()}`,
        "SUSPENDED",
      );
      await db().employerSubscription.create({
        data: {
          companyId: company.id,
          planVersionId: paidPlanVersionId,
          status: subscriptionStatus,
          currentPeriodStart: NOW,
          currentPeriodEnd: PERIOD_END,
          billingIntervalSnapshot: "MONTHLY",
          termMonthsSnapshot: 1,
          recurringNetRappenSnapshot: 14_900,
          monthlyEquivalentRappenSnapshot: 14_900,
          currencySnapshot: "CHF",
          activatedAt: subscriptionStatus === "SCHEDULED" ? null : NOW,
        },
      });

      await expect(
        closeCompany(
          {
            companyId: company.id,
            expectedStatus: "SUSPENDED",
            reasonCode: "COMPANY_OFFBOARDING_COMPLETED",
            confirmationCode: "FIRMA_SCHLIESSEN",
            idempotencyKey: randomUUID(),
          },
          adminDependencies(`phase34-company-close-${subscriptionStatus}`),
        ),
      ).resolves.toEqual({
        ok: false,
        code: "ACTIVE_SUBSCRIPTION",
        issues: [subscriptionStatus],
      });
      await expect(
        db().company.findUniqueOrThrow({
          where: { id: company.id },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "SUSPENDED" });
      await expect(
        db().companyStatusEvent.count({
          where: { companyId: company.id, kind: "CLOSED" },
        }),
      ).resolves.toBe(0);
      await expect(
        db().auditLog.count({
          where: { targetId: company.id, action: "COMPANY_CLOSED" },
        }),
      ).resolves.toBe(0);
    },
  );

  it("rejects missing confirmation and actors without the moderation capability before any write", async () => {
    const company = await createCompany("denied", "SUSPENDED");
    const baseInput = {
      companyId: company.id,
      expectedStatus: "SUSPENDED" as const,
      reasonCode: "COMPANY_OFFBOARDING_COMPLETED",
      idempotencyKey: randomUUID(),
    };

    await expect(
      closeCompany(baseInput, adminDependencies("phase34-company-close-unconfirmed")),
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(
      closeCompany(
        { ...baseInput, confirmationCode: "FIRMA_SCHLIESSEN" },
        {
          actor: {
            userId: employerUserId,
            email: "phase34-company-close-employer@example.test",
            role: "EMPLOYER",
            status: "ACTIVE",
            capabilities: [],
          },
          correlationId: "phase34-company-close-forbidden",
          database: db(),
          now: NOW,
        },
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      db().company.findUniqueOrThrow({
        where: { id: company.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "SUSPENDED" });
  });

  it("rejects a direct ACTIVE-to-CLOSED request even with a valid confirmation", async () => {
    const company = await createCompany("active-denied", "ACTIVE");

    await expect(
      closeCompany(
        {
          companyId: company.id,
          expectedStatus: "SUSPENDED",
          reasonCode: "FORGED_DIRECT_CLOSURE",
          confirmationCode: "FIRMA_SCHLIESSEN",
          idempotencyKey: randomUUID(),
        },
        adminDependencies("phase34-company-close-active-denied"),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      db().company.findUniqueOrThrow({
        where: { id: company.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "ACTIVE" });
    await expect(
      db().companyStatusEvent.count({
        where: { companyId: company.id, kind: "CLOSED" },
      }),
    ).resolves.toBe(0);
  });
});

async function createCompany(slugSuffix: string, status: "ACTIVE" | "SUSPENDED") {
  const company = await db().company.create({
    data: {
      name: `Phase 34 ${slugSuffix} AG`,
      slug: `phase34-company-${slugSuffix}`,
      industry: "Technology",
      size: "10-49",
      website: `https://${slugSuffix}.example.test`,
      about: "A complete isolated company fixture for closure boundary testing.",
      status: "DRAFT",
      dataProvenance: "TEST",
    },
  });
  await db().companyLocation.create({
    data: {
      companyId: company.id,
      cantonId,
      cityId,
      address: "Teststrasse 34",
      postalCode: "6300",
      isPrimary: true,
    },
  });
  await db().companyMembership.create({
    data: {
      companyId: company.id,
      userId: employerUserId,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  return db().company.update({
    where: { id: company.id },
    data: { status },
  });
}

async function createPublishedJob(companyId: string, slugSuffix: string) {
  const job = await db().job.create({
    data: {
      companyId,
      slug: `phase34-${slugSuffix}`,
      status: "DRAFT",
      dataProvenance: "TEST",
      createdByUserId: employerUserId,
    },
  });
  const validThrough = PERIOD_END;
  const revision = await db().jobRevision.create({
    data: {
      jobId: job.id,
      revisionNumber: 1,
      title: "Phase 34 Software Engineer",
      description: "A reproducible published Job used only for company closure tests.",
      tasks: ["Sichere Plattformfunktionen umsetzen"],
      requirements: ["Nachvollziehbare Tests schreiben"],
      applicationProcessSteps: ["Bewerbung", "Gespräch"],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId,
      cantonId,
      cityId,
      locationLabel: "Zug",
      workloadMin: 80,
      workloadMax: 100,
      salaryPeriod: "YEARLY",
      salaryMin: 100_000,
      salaryMax: 120_000,
      validThrough,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@example.test",
      authoredByUserId: employerUserId,
      contentChecksum: createHash("sha256")
        .update(`phase34-job-revision:${job.id}`, "utf8")
        .digest("hex"),
      submittedAt: new Date(NOW.getTime() - 2_000),
      approvedAt: new Date(NOW.getTime() - 1_000),
    },
  });
  return db().job.update({
    where: { id: job.id },
    data: {
      status: "PUBLISHED",
      currentRevisionId: revision.id,
      publishedRevisionId: revision.id,
      publishedAt: NOW,
      expiresAt: validThrough,
      publishedCategoryId: categoryId,
      publishedCantonId: cantonId,
      publishedCityId: cityId,
      publishedSalaryPeriod: "YEARLY",
      publishedSalaryMin: 100_000,
      publishedSalaryMax: 120_000,
    },
  });
}

function adminDependencies(_operation: string): AdminDependencies {
  return Object.freeze({
    actor: Object.freeze({
      userId: adminUserId,
      email: "phase34-company-close-admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
      capabilities: ADMIN_CAPABILITIES_V1,
    }),
    correlationId: randomUUID(),
    database: db(),
    now: NOW,
  });
}

function db(): DatabaseClient {
  if (database === undefined) throw new Error("Company closure database is unavailable.");
  return database;
}

function requireSuccess<T>(
  result: Readonly<{ ok: true; value: T } | { ok: false; code: string }>,
): Readonly<{ ok: true; value: T }> {
  if (!result.ok) throw new Error(`Expected success, received ${result.code}.`);
  return result;
}
