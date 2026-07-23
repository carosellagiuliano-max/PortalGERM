import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { getServerEnvironment } from "@/lib/config/env";
import {
  completeEmployerCompanyOnboarding,
  saveEmployerCompanyProfile,
  startNewCompanyVerificationCycle,
  submitCurrentCompanyVerification,
  type EmployerCompanyScope,
} from "@/lib/employer/company";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
type SqlStatement = Readonly<{
  text: string;
  values: ReadonlyArray<unknown>;
}>;
type WriteOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ error: unknown; ok: false }>;

const uuid = (sequence: number) =>
  `71000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
const IDS = Object.freeze({
  owner: uuid(1),
  recruiter: uuid(2),
  company: uuid(3),
  ownerMembership: uuid(4),
  recruiterMembership: uuid(5),
  canton: uuid(6),
  city: uuid(7),
  profileCorrelation: uuid(8),
  onboardingCorrelation: uuid(9),
  verificationCorrelation: uuid(10),
  resubmissionCorrelation: uuid(11),
  newCycleCorrelation: uuid(12),
  recruiterCorrelation: uuid(13),
  initialIdempotency: uuid(14),
  resubmissionIdempotency: uuid(15),
  newCycleIdempotency: uuid(16),
  plan: uuid(17),
  planVersion: uuid(18),
  enhancedGrant: uuid(19),
  childFirstPredecessor: uuid(30),
  childFirstSuccessor: uuid(31),
  predecessorFirstPredecessor: uuid(32),
  predecessorFirstSuccessor: uuid(33),
});
const PROFILE_TIME = new Date("2026-07-21T08:00:00.000Z");
const ONBOARDING_TIME = new Date("2026-07-21T08:01:00.000Z");
const VERIFICATION_TIME = new Date("2026-07-21T08:02:00.000Z");
const RESUBMISSION_TIME = new Date("2026-07-21T08:03:00.000Z");
const NEW_CYCLE_TIME = new Date("2026-07-21T08:04:00.000Z");

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase10_company_verification");
  database = createDatabaseClient(isolated.connectionString);
  await seed(client());
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-10 Company onboarding and verification", () => {
  it("updates a fresh Free company with the production audit-IP context", async () => {
    const freshUserId = uuid(40);
    const freshCompanyId = uuid(41);
    const freshMembershipId = uuid(42);
    await client().user.create({
      data: {
        id: freshUserId,
        email: "phase17-company-owner@example.ch",
        emailNormalized: "phase17-company-owner@example.ch",
        role: "EMPLOYER",
      },
    });
    const freshCompany = await client().company.create({
      data: {
        id: freshCompanyId,
        name: "Phase 17 Prüfwerk AG",
        slug: "phase-17-pruefwerk",
        values: [],
        benefits: [],
        status: "DRAFT",
      },
      select: { updatedAt: true },
    });
    await client().companyMembership.create({
      data: {
        id: freshMembershipId,
        companyId: freshCompanyId,
        userId: freshUserId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    const environment = getServerEnvironment();
    await expect(
      saveEmployerCompanyProfile(
        client(),
        {
          companyId: freshCompanyId,
          membershipId: freshMembershipId,
          actorUserId: freshUserId,
          correlationId: uuid(43),
          now: new Date("2026-07-21T08:00:00.000Z"),
          auditIpContext: {
            sourceIp: "127.0.0.1",
            keyring: environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
          },
        },
        {
          name: "Phase 17 Prüfwerk AG",
          uid: null,
          industry: "Prüftechnik",
          size: "10-49",
          website: "https://phase17-pruefwerk.example",
          logoStorageKey: null,
          coverStorageKey: null,
          linkedinUrl: null,
          facebookUrl: null,
          instagramUrl: null,
          about:
            "Fiktive Schweizer Prüftechnikfirma für den vollständigen Phase-17-Verifikationspfad.",
          values: [],
          benefits: [],
          locations: [
            {
              id: null,
              cantonId: IDS.canton,
              cityId: IDS.city,
              address: null,
              postalCode: null,
              isPrimary: true,
            },
          ],
        },
        freshCompany.updatedAt,
      ),
    ).resolves.toMatchObject({ companyId: freshCompanyId });
  });

  it(
    "persists profile metadata, performs exact DRAFT to ACTIVE and enforces verification cycles",
    async () => {
      const initialCompany = await client().company.findUniqueOrThrow({
        where: { id: IDS.company },
        select: { updatedAt: true },
      });
      const profile = validProfile();
      const saved = await saveEmployerCompanyProfile(
        client(),
        ownerScope(IDS.profileCorrelation, PROFILE_TIME),
        profile,
        initialCompany.updatedAt,
      );

      await expect(
        saveEmployerCompanyProfile(
          client(),
          recruiterScope(IDS.recruiterCorrelation, PROFILE_TIME),
          { ...profile, name: "Unzulässige Recruiter-Änderung" },
          saved.updatedAt,
        ),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      await client().entitlementGrant.update({
        where: { id: IDS.enhancedGrant },
        data: { revokedAt: new Date(PROFILE_TIME.getTime() + 1_000) },
      });
      const baseOnlySaved = await saveEmployerCompanyProfile(
        client(),
        ownerScope(
          IDS.profileCorrelation,
          new Date(PROFILE_TIME.getTime() + 2_000),
        ),
        { ...profile, name: "Swiss Talent Integration AG – aktualisiert" },
        saved.updatedAt,
      );
      await expect(
        saveEmployerCompanyProfile(
          client(),
          ownerScope(
            IDS.profileCorrelation,
            new Date(PROFILE_TIME.getTime() + 3_000),
          ),
          {
            ...profile,
            name: "Swiss Talent Integration AG – aktualisiert",
            coverStorageKey: "/assets/company-media/alpine-cover.svg",
          },
          baseOnlySaved.updatedAt,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const completed = await completeEmployerCompanyOnboarding(
        client(),
        ownerScope(IDS.onboardingCorrelation, ONBOARDING_TIME),
        baseOnlySaved.updatedAt,
      );
      expect(completed.outcome).toBe("COMPLETED");
      const replayedOnboarding = await completeEmployerCompanyOnboarding(
        client(),
        ownerScope(IDS.onboardingCorrelation, ONBOARDING_TIME),
        saved.updatedAt,
      );
      expect(replayedOnboarding.outcome).toBe("ALREADY_ACTIVE");

      const [company, statusEvents, onboardingAudits, onboardingAnalytics] =
        await Promise.all([
          client().company.findUniqueOrThrow({
            where: { id: IDS.company },
            include: { locations: true },
          }),
          client().companyStatusEvent.findMany({
            where: { companyId: IDS.company },
          }),
          client().auditLog.findMany({
            where: {
              companyId: IDS.company,
              action: "COMPANY_ONBOARDING_COMPLETED",
            },
          }),
          client().analyticsEvent.findMany({
            where: {
              companyId: IDS.company,
              kind: "COMPANY_ONBOARDING_COMPLETED",
            },
          }),
        ]);
      expect(company).toMatchObject({
        status: "ACTIVE",
        linkedinUrl: profile.linkedinUrl,
        facebookUrl: profile.facebookUrl,
        instagramUrl: profile.instagramUrl,
        logoStorageKey: profile.logoStorageKey,
        coverStorageKey: profile.coverStorageKey,
      });
      expect(company.locations).toHaveLength(1);
      expect(company.locations[0]).toMatchObject({ isPrimary: true });
      expect(statusEvents).toEqual([
        expect.objectContaining({
          kind: "ONBOARDING_COMPLETED",
          fromStatus: "DRAFT",
          toStatus: "ACTIVE",
        }),
      ]);
      expect(onboardingAudits).toHaveLength(1);
      expect(onboardingAnalytics).toHaveLength(1);
      await expect(
        client().auditLog.count({
          where: {
            companyId: IDS.company,
            action: "COMPANY_PROFILE_UPDATED",
            targetId: IDS.company,
          },
        }),
      ).resolves.toBe(2);

      const initialCommand = {
        expectedCurrentRequestId: null,
        idempotencyKey: IDS.initialIdempotency,
        evidence: {
          summary:
            "Handelsregistereintrag und kontrollierte Firmendomain stimmen überein.",
          reference: "HR-2026-INITIAL",
        },
      };
      const firstCycle = await startNewCompanyVerificationCycle(
        client(),
        ownerScope(IDS.verificationCorrelation, VERIFICATION_TIME),
        initialCommand,
      );
      expect(firstCycle).toMatchObject({ status: "PENDING", duplicate: false });
      const duplicate = await startNewCompanyVerificationCycle(
        client(),
        ownerScope(IDS.verificationCorrelation, VERIFICATION_TIME),
        initialCommand,
      );
      expect(duplicate).toMatchObject({
        requestId: firstCycle.requestId,
        status: "PENDING",
        duplicate: true,
      });

      await expect(
        submitCurrentCompanyVerification(
          client(),
          recruiterScope(IDS.recruiterCorrelation, VERIFICATION_TIME),
          {
            expectedCurrentRequestId: firstCycle.requestId,
            idempotencyKey: uuid(20),
            evidence: initialCommand.evidence,
          },
        ),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      await client().$transaction(async (transaction) => {
        await transaction.companyVerificationRequest.update({
          where: { id: firstCycle.requestId },
          data: { status: "CHANGES_REQUESTED", updatedAt: RESUBMISSION_TIME },
        });
        await transaction.companyVerificationEvent.create({
          data: {
            verificationRequestId: firstCycle.requestId,
            kind: "EVIDENCE_REQUESTED",
            fromStatus: "PENDING",
            toStatus: "CHANGES_REQUESTED",
            actorUserId: IDS.owner,
            reasonCode: "REGISTER_EXTRACT_REQUIRED",
            idempotencyKey: "test-review:evidence-requested",
            correlationId: IDS.resubmissionCorrelation,
            createdAt: RESUBMISSION_TIME,
          },
        });
      });
      const resubmitted = await submitCurrentCompanyVerification(
        client(),
        ownerScope(
          IDS.resubmissionCorrelation,
          new Date(RESUBMISSION_TIME.getTime() + 1),
        ),
        {
          expectedCurrentRequestId: firstCycle.requestId,
          idempotencyKey: IDS.resubmissionIdempotency,
          evidence: {
            summary:
              "Der aktuelle Handelsregisterauszug ergänzt die bereits geprüfte Domain.",
            reference: "HR-2026-UPDATED",
          },
        },
      );
      expect(resubmitted).toMatchObject({
        requestId: firstCycle.requestId,
        status: "PENDING",
        duplicate: false,
      });

      await client().$transaction(async (transaction) => {
        await transaction.companyVerificationRequest.update({
          where: { id: firstCycle.requestId },
          data: { status: "REJECTED", updatedAt: NEW_CYCLE_TIME },
        });
        await transaction.companyVerificationEvent.create({
          data: {
            verificationRequestId: firstCycle.requestId,
            kind: "REJECTED",
            fromStatus: "PENDING",
            toStatus: "REJECTED",
            actorUserId: IDS.owner,
            reasonCode: "EVIDENCE_NOT_SUFFICIENT",
            idempotencyKey: "test-review:rejected",
            correlationId: IDS.newCycleCorrelation,
            createdAt: NEW_CYCLE_TIME,
          },
        });
      });
      const secondCycle = await startNewCompanyVerificationCycle(
        client(),
        ownerScope(IDS.newCycleCorrelation, NEW_CYCLE_TIME),
        {
          expectedCurrentRequestId: firstCycle.requestId,
          idempotencyKey: IDS.newCycleIdempotency,
          evidence: {
            summary:
              "Ein neuer, unabhängiger Registerauszug behebt die frühere Ablehnung.",
            reference: "HR-2026-NEW-CYCLE",
          },
        },
      );
      expect(secondCycle.requestId).not.toBe(firstCycle.requestId);
      expect(secondCycle.status).toBe("PENDING");
      await expect(
        client().companyVerificationRequest.update({
          where: { id: firstCycle.requestId },
          data: { status: "PENDING" },
        }),
      ).rejects.toBeDefined();

      const [requests, firstEvents, secondEvents, verificationAudits, analytics] =
        await Promise.all([
          client().companyVerificationRequest.findMany({
            where: { companyId: IDS.company },
            orderBy: { createdAt: "asc" },
          }),
          client().companyVerificationEvent.findMany({
            where: { verificationRequestId: firstCycle.requestId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }),
          client().companyVerificationEvent.findMany({
            where: { verificationRequestId: secondCycle.requestId },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }),
          client().auditLog.findMany({
            where: {
              companyId: IDS.company,
              action: "COMPANY_VERIFICATION_SUBMITTED",
            },
          }),
          client().analyticsEvent.findMany({
            where: {
              companyId: IDS.company,
              kind: "COMPANY_VERIFICATION_SUBMITTED",
            },
          }),
        ]);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({
        id: firstCycle.requestId,
        status: "REJECTED",
        supersedesRequestId: null,
      });
      expect(requests[1]).toMatchObject({
        id: secondCycle.requestId,
        status: "PENDING",
        supersedesRequestId: firstCycle.requestId,
      });
      expect(firstEvents.map(({ kind }) => kind)).toEqual([
        "DRAFT_CREATED",
        "SUBMITTED",
        "EVIDENCE_REQUESTED",
        "RESUBMITTED",
        "REJECTED",
      ]);
      expect(secondEvents.map(({ kind }) => kind)).toEqual([
        "DRAFT_CREATED",
        "SUBMITTED",
      ]);
      expect(verificationAudits).toHaveLength(3);
      expect(analytics).toHaveLength(3);
    },
    180_000,
  );

  it(
    "serializes successor creation and predecessor reopening in both lock orders",
    async () => {
      const target = rawPool();
      const now = "2026-07-21T08:10:00.000Z";

      await insertVerificationRequest(
        target,
        IDS.childFirstPredecessor,
        "REJECTED",
        null,
        now,
      );
      await expectSerializedVerificationConflict(
        target,
        verificationInsertStatement({
          id: IDS.childFirstSuccessor,
          supersedesRequestId: IDS.childFirstPredecessor,
          status: "REJECTED",
          now,
        }),
        verificationStatusStatement(IDS.childFirstPredecessor, "VERIFIED", now),
      );

      const childFirstRows = await target.query<{
        id: string;
        status: string;
        supersedesRequestId: string | null;
      }>(
        [
          'SELECT "id", "status", "supersedesRequestId"',
          'FROM "CompanyVerificationRequest"',
          'WHERE "id" = ANY($1::uuid[])',
          'ORDER BY "id"',
        ].join("\n"),
        [[IDS.childFirstPredecessor, IDS.childFirstSuccessor]],
      );
      expect(childFirstRows.rows).toEqual([
        {
          id: IDS.childFirstPredecessor,
          status: "REJECTED",
          supersedesRequestId: null,
        },
        {
          id: IDS.childFirstSuccessor,
          status: "REJECTED",
          supersedesRequestId: IDS.childFirstPredecessor,
        },
      ]);

      await insertVerificationRequest(
        target,
        IDS.predecessorFirstPredecessor,
        "REJECTED",
        null,
        now,
      );
      await expectSerializedVerificationConflict(
        target,
        verificationStatusStatement(
          IDS.predecessorFirstPredecessor,
          "VERIFIED",
          now,
        ),
        verificationInsertStatement({
          id: IDS.predecessorFirstSuccessor,
          supersedesRequestId: IDS.predecessorFirstPredecessor,
          status: "REJECTED",
          now,
        }),
      );

      const predecessorFirstRows = await target.query<{
        id: string;
        status: string;
      }>(
        [
          'SELECT "id", "status"',
          'FROM "CompanyVerificationRequest"',
          'WHERE "id" = ANY($1::uuid[])',
          'ORDER BY "id"',
        ].join("\n"),
        [[IDS.predecessorFirstPredecessor, IDS.predecessorFirstSuccessor]],
      );
      expect(predecessorFirstRows.rows).toEqual([
        { id: IDS.predecessorFirstPredecessor, status: "VERIFIED" },
      ]);
    },
    60_000,
  );
});

async function expectSerializedVerificationConflict(
  target: Pool,
  winningStatement: SqlStatement,
  competingStatement: SqlStatement,
) {
  const winner = await target.connect();
  const competitor = await target.connect();
  let competingWrite: Promise<WriteOutcome> | undefined;
  let competingSettled = false;

  try {
    await winner.query("BEGIN");
    await competitor.query("BEGIN");
    const backend = await competitor.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const backendPid = backend.rows[0]?.pid;

    if (backendPid === undefined) {
      throw new Error("Could not resolve the competing PostgreSQL backend.");
    }

    await winner.query(winningStatement.text, [...winningStatement.values]);
    competingWrite = competitor
      .query(competingStatement.text, [...competingStatement.values])
      .then(
        (): WriteOutcome => ({ ok: true }),
        (error: unknown): WriteOutcome => ({ error, ok: false }),
      );
    void competingWrite.then(() => {
      competingSettled = true;
    });

    await waitUntilBlocked(target, backendPid, () => competingSettled);
    await winner.query("COMMIT");

    const outcome = await competingWrite;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error).toMatchObject({
        code: "23514",
        constraint: "company_verification_supersession_terminal",
      });
    }
  } finally {
    await winner.query("ROLLBACK").catch(() => undefined);
    if (competingWrite) {
      await competingWrite;
    }
    await competitor.query("ROLLBACK").catch(() => undefined);
    winner.release();
    competitor.release();
  }
}

async function waitUntilBlocked(
  target: Pool,
  backendPid: number,
  isSettled: () => boolean,
) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (isSettled()) {
      throw new Error(
        "The competing verification write settled before PostgreSQL observed a lock wait.",
      );
    }

    const activity = await target.query<{
      state: string;
      wait_event_type: string | null;
    }>(
      [
        "SELECT state, wait_event_type",
        "FROM pg_stat_activity",
        "WHERE pid = $1",
      ].join("\n"),
      [backendPid],
    );
    const row = activity.rows[0];

    if (row?.state === "active" && row.wait_event_type === "Lock") {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error("Timed out while waiting for the verification lock conflict.");
}

function verificationInsertStatement(input: {
  id: string;
  now: string;
  status: "REJECTED";
  supersedesRequestId: string;
}): SqlStatement {
  return {
    text: [
      'INSERT INTO "CompanyVerificationRequest" (',
      '  "id", "companyId", "requestedByUserId", "supersedesRequestId",',
      '  "status", "createdAt", "updatedAt"',
      ") VALUES ($1, $2, $3, $4, $5::\"CompanyVerificationStatus\", $6::timestamptz, $6::timestamptz)",
    ].join("\n"),
    values: [
      input.id,
      IDS.company,
      IDS.owner,
      input.supersedesRequestId,
      input.status,
      input.now,
    ],
  };
}

function verificationStatusStatement(
  id: string,
  status: "VERIFIED",
  now: string,
): SqlStatement {
  return {
    text: [
      'UPDATE "CompanyVerificationRequest"',
      'SET "status" = $2::"CompanyVerificationStatus", "updatedAt" = $3::timestamptz',
      'WHERE "id" = $1',
    ].join("\n"),
    values: [id, status, now],
  };
}

async function insertVerificationRequest(
  target: Pool,
  id: string,
  status: "REJECTED",
  supersedesRequestId: string | null,
  now: string,
) {
  await target.query(
    [
      'INSERT INTO "CompanyVerificationRequest" (',
      '  "id", "companyId", "requestedByUserId", "supersedesRequestId",',
      '  "status", "createdAt", "updatedAt"',
      ") VALUES ($1, $2, $3, $4, $5::\"CompanyVerificationStatus\", $6::timestamptz, $6::timestamptz)",
    ].join("\n"),
    [id, IDS.company, IDS.owner, supersedesRequestId, status, now],
  );
}

async function seed(db: DatabaseClient) {
  await db.user.createMany({
    data: [
      {
        id: IDS.owner,
        email: "phase10-owner@example.ch",
        emailNormalized: "phase10-owner@example.ch",
        role: "EMPLOYER",
      },
      {
        id: IDS.recruiter,
        email: "phase10-recruiter@example.ch",
        emailNormalized: "phase10-recruiter@example.ch",
        role: "RECRUITER",
      },
    ],
  });
  await db.canton.create({
    data: {
      id: IDS.canton,
      code: "ZH",
      name: "Zürich",
      slug: "zuerich-phase10",
      language: "DE",
    },
  });
  await db.city.create({
    data: {
      id: IDS.city,
      cantonId: IDS.canton,
      name: "Zürich",
      slug: "zuerich-phase10",
    },
  });
  await db.company.create({
    data: {
      id: IDS.company,
      name: "Phase 10 Company",
      slug: "phase-10-company",
      values: [],
      benefits: [],
      status: "DRAFT",
    },
  });
  await db.companyMembership.createMany({
    data: [
      {
        id: IDS.ownerMembership,
        companyId: IDS.company,
        userId: IDS.owner,
        role: "OWNER",
        status: "ACTIVE",
      },
      {
        id: IDS.recruiterMembership,
        companyId: IDS.company,
        userId: IDS.recruiter,
        role: "RECRUITER",
        status: "ACTIVE",
      },
    ],
  });
  await seedEnhancedProfileEntitlements(db);
}

async function seedEnhancedProfileEntitlements(db: DatabaseClient) {
  await db.plan.create({
    data: {
      id: IDS.plan,
      code: "PHASE10_COMPANY_FREE",
      name: "Phase 10 Company Free",
      isDefaultFree: true,
    },
  });
  await db.planVersion.create({
    data: {
      id: IDS.planVersion,
      planId: IDS.plan,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 0,
      monthlyEquivalentRappen: 0,
      validFrom: new Date(PROFILE_TIME.getTime() - 86_400_000),
    },
  });
  await db.planEntitlement.createMany({
    data: [
      integerEntitlement("ACTIVE_JOB_LIMIT", 1),
      integerEntitlement("SEAT_LIMIT", 5),
      booleanEntitlement("TALENT_RADAR_ACCESS", false),
      integerEntitlement("TALENT_CONTACT_ALLOWANCE", 0),
      integerEntitlement("JOB_BOOST_ALLOWANCE", 0),
      {
        planVersionId: IDS.planVersion,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "NONE",
      },
      booleanEntitlement("ENHANCED_COMPANY_PROFILE", false),
      booleanEntitlement("EMPLOYER_IMPORT_ACCESS", false),
    ],
  });
  await db.planVersion.update({
    where: { id: IDS.planVersion },
    data: { status: "ACTIVE" },
  });
  await db.entitlementGrant.create({
    data: {
      id: IDS.enhancedGrant,
      companyId: IDS.company,
      key: "ENHANCED_COMPANY_PROFILE",
      valueType: "BOOLEAN",
      booleanValue: true,
      reasonCode: "PHASE10_TEST",
      grantedByUserId: IDS.owner,
      validFrom: new Date(PROFILE_TIME.getTime() - 86_400_000),
      validTo: new Date(PROFILE_TIME.getTime() + 86_400_000),
      idempotencyKey: "phase10-company-enhanced-profile",
    },
  });
}

function integerEntitlement(
  key: "ACTIVE_JOB_LIMIT" | "SEAT_LIMIT" | "TALENT_CONTACT_ALLOWANCE" | "JOB_BOOST_ALLOWANCE",
  value: number,
) {
  return {
    planVersionId: IDS.planVersion,
    key,
    valueType: "INTEGER" as const,
    integerValue: value,
  };
}

function booleanEntitlement(
  key: "TALENT_RADAR_ACCESS" | "ENHANCED_COMPANY_PROFILE" | "EMPLOYER_IMPORT_ACCESS",
  value: boolean,
) {
  return {
    planVersionId: IDS.planVersion,
    key,
    valueType: "BOOLEAN" as const,
    booleanValue: value,
  };
}

function validProfile() {
  return {
    name: "Swiss Talent Integration AG",
    uid: "CHE-321.654.987",
    industry: "Technology",
    size: "11–50",
    website: "https://phase10.example.ch/company",
    logoStorageKey: "/assets/company-media/default-logo.svg",
    coverStorageKey: "/assets/company-media/default-cover.svg",
    linkedinUrl: "https://www.linkedin.com/company/phase10",
    facebookUrl: "https://www.facebook.com/phase10",
    instagramUrl: "https://www.instagram.com/phase10",
    about:
      "Ein vollständiges Firmenprofil für den transaktionalen Phase-10-Integrationstest.",
    values: ["Verantwortung", "Transparenz"],
    benefits: ["Flexible Arbeitszeiten", "Weiterbildungsbudget"],
    locations: [
      {
        id: null,
        cantonId: IDS.canton,
        cityId: IDS.city,
        address: "Bahnhofstrasse 1",
        postalCode: "8001",
        isPrimary: true,
      },
    ],
  } as const;
}

function ownerScope(correlationId: string, now: Date): EmployerCompanyScope {
  return Object.freeze({
    companyId: IDS.company,
    membershipId: IDS.ownerMembership,
    actorUserId: IDS.owner,
    correlationId,
    now,
  });
}

function recruiterScope(correlationId: string, now: Date): EmployerCompanyScope {
  return Object.freeze({
    companyId: IDS.company,
    membershipId: IDS.recruiterMembership,
    actorUserId: IDS.recruiter,
    correlationId,
    now,
  });
}

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The isolated Company integration database is missing.");
  }
  return database;
}

function rawPool(): Pool {
  if (isolated === undefined) {
    throw new Error("The isolated Company integration database is missing.");
  }
  return isolated.pool;
}
