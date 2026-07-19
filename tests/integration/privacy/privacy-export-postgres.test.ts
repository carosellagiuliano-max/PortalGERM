import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  createPostgresPrivacyExportAdapter,
  POSTGRES_PRIVACY_EXPORT_POLICY_V1,
} from "@/lib/privacy/postgres-export-adapter";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-19T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1_000;
const ACTOR_CAPABILITIES = Object.freeze(["PRIVACY_CASE_PROCESS"]);

let database: MigratedDatabase | undefined;
let firstClient: DatabaseClient | undefined;
let secondClient: DatabaseClient | undefined;

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase03_privacy_export");
  firstClient = createDatabaseClient(database.connectionString);
  secondClient = createDatabaseClient(database.connectionString);
});

afterAll(async () => {
  await Promise.allSettled([
    firstClient?.$disconnect() ?? Promise.resolve(),
    secondClient?.$disconnect() ?? Promise.resolve(),
  ]);
  await database?.dispose();
});

describe("PostgreSQL Privacy export adapter", () => {
  it("counts only allowlisted requester roots and persists the completed evidence atomically", async () => {
    const client = requireClients().first;
    const fixture = await createExportFixture(client, "allowlist");
    const request = await createInProgressExportRequest(client, fixture, 7);
    const adapter = createPostgresPrivacyExportAdapter(client);

    await expect(
      adapter.buildExportManifestForCase(
        request.id,
        {
          userId: fixture.otherAdmin.id,
          capabilities: ACTOR_CAPABILITIES,
        },
        NOW,
      ),
    ).rejects.toThrow("Privacy export case is unavailable.");
    await expect(
      client.privacyRequest.findUnique({
        where: { id: request.id },
        select: { status: true, version: true, exportManifest: true },
      }),
    ).resolves.toEqual({
      status: "IN_PROGRESS",
      version: 7,
      exportManifest: null,
    });

    const result = await adapter.buildExportManifestForCase(
      request.id,
      { userId: fixture.admin.id, capabilities: ACTOR_CAPABILITIES },
      NOW,
    );

    expect(result.manifest).toEqual({
      schemaVersion: "v1",
      requestId: request.id,
      categories: {
        account: 1,
        candidateProfile: 1,
        consentHistory: 3,
        applications: 1,
        radar: 1,
      },
      generatedAt: NOW.toISOString(),
    });
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 7 * DAY));
    expect(POSTGRES_PRIVACY_EXPORT_POLICY_V1.categorySources).toEqual({
      account: ["User"],
      candidateProfile: ["CandidateProfile"],
      consentHistory: ["UserConsentEvent", "CandidateConsent"],
      applications: ["Application"],
      radar: ["RadarProfile"],
    });

    const serialized = JSON.stringify(result);
    for (const canary of [
      "PRIVATE_EMPLOYER_NOTE_CANARY",
      "foreign-export-allowlist@example.test",
      "FOREIGN_PROFILE_PII_CANARY",
      "OWN_PROFILE_PII_CANARY",
    ]) {
      expect(serialized).not.toContain(canary);
    }

    const stored = await client.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    expect(stored).toMatchObject({
      requesterUserId: fixture.requester.id,
      assignedAdminUserId: fixture.admin.id,
      status: "COMPLETED",
      version: 8,
      completedAt: NOW,
      exportManifest: result.manifest,
      exportManifestChecksum: result.checksum,
      exportExpiresAt: result.expiresAt,
    });
    expect(stored.events).toHaveLength(2);
    expect(stored.events.map(({ kind }) => kind).sort()).toEqual([
      "COMPLETED",
      "MANIFEST_CREATED",
    ]);
    expect(
      stored.events.every(
        (event) =>
          event.actorUserId === fixture.admin.id &&
          event.correlationId === stored.events[0]?.correlationId,
      ),
    ).toBe(true);

    const audits = await client.auditLog.findMany({
      where: { targetId: request.id },
      orderBy: { action: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits.map(({ action }) => action).sort()).toEqual([
      "PRIVACY_EXPORT_MANIFEST_CREATED",
      "PRIVACY_REQUEST_STATUS_CHANGED",
    ]);
    expect(
      audits.every(
        (audit) =>
          audit.actorUserId === fixture.admin.id &&
          audit.capability === "PRIVACY_CASE_PROCESS" &&
          audit.targetType === "PRIVACY_REQUEST" &&
          JSON.stringify(audit.metadata) === "{}" &&
          audit.correlationId === stored.events[0]?.correlationId,
      ),
    ).toBe(true);
  });

  it("serializes concurrent retries and writes one manifest evidence set", async () => {
    const clients = requireClients();
    const fixture = await createExportFixture(clients.first, "parallel");
    const request = await createInProgressExportRequest(clients.first, fixture, 3);
    const actor = {
      userId: fixture.admin.id,
      capabilities: ACTOR_CAPABILITIES,
    };

    const [first, second] = await Promise.all([
      createPostgresPrivacyExportAdapter(
        clients.first,
      ).buildExportManifestForCase(request.id, actor, NOW),
      createPostgresPrivacyExportAdapter(
        clients.second,
      ).buildExportManifestForCase(request.id, actor, NOW),
    ]);

    expect(first).toEqual(second);
    await expect(
      clients.first.privacyRequest.findUnique({
        where: { id: request.id },
        select: { status: true, version: true },
      }),
    ).resolves.toEqual({ status: "COMPLETED", version: 4 });
    await expect(
      clients.first.privacyRequestEvent.count({
        where: { privacyRequestId: request.id },
      }),
    ).resolves.toBe(2);
    await expect(
      clients.first.auditLog.count({ where: { targetId: request.id } }),
    ).resolves.toBe(2);

    await expect(
      createPostgresPrivacyExportAdapter(
        clients.first,
      ).buildExportManifestForCase(request.id, actor, new Date(NOW.getTime() + DAY)),
    ).resolves.toEqual(first);
    await expect(
      clients.first.privacyRequestEvent.count({
        where: { privacyRequestId: request.id },
      }),
    ).resolves.toBe(2);
  });

  it("rolls manifest, status, events and the first audit back if a required audit fails", async () => {
    const client = requireClients().first;
    const isolated = requireDatabase();
    const fixture = await createExportFixture(client, "rollback");
    const request = await createInProgressExportRequest(client, fixture, 11);

    await isolated.pool.query(`
      CREATE FUNCTION reject_privacy_export_status_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW."action" = 'PRIVACY_REQUEST_STATUS_CHANGED' THEN
          RAISE EXCEPTION 'isolated required export-audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await isolated.pool.query(`
      CREATE TRIGGER reject_privacy_export_status_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION reject_privacy_export_status_audit()
    `);

    try {
      await expect(
        createPostgresPrivacyExportAdapter(client).buildExportManifestForCase(
          request.id,
          { userId: fixture.admin.id, capabilities: ACTOR_CAPABILITIES },
          NOW,
        ),
      ).rejects.toThrow("Privacy export case is unavailable.");

      await expect(
        client.privacyRequest.findUnique({
          where: { id: request.id },
          select: {
            status: true,
            version: true,
            completedAt: true,
            exportManifest: true,
            exportManifestChecksum: true,
            exportExpiresAt: true,
          },
        }),
      ).resolves.toEqual({
        status: "IN_PROGRESS",
        version: 11,
        completedAt: null,
        exportManifest: null,
        exportManifestChecksum: null,
        exportExpiresAt: null,
      });
      await expect(
        client.privacyRequestEvent.count({
          where: { privacyRequestId: request.id },
        }),
      ).resolves.toBe(0);
      await expect(
        client.auditLog.count({ where: { targetId: request.id } }),
      ).resolves.toBe(0);
    } finally {
      await isolated.pool.query(
        'DROP TRIGGER IF EXISTS reject_privacy_export_status_audit_trigger ON "AuditLog"',
      );
      await isolated.pool.query(
        "DROP FUNCTION IF EXISTS reject_privacy_export_status_audit() CASCADE",
      );
    }
  });
});

function requireClients() {
  if (!firstClient || !secondClient) {
    throw new Error("Privacy export test clients are unavailable.");
  }
  return { first: firstClient, second: secondClient };
}

function requireDatabase() {
  if (!database) throw new Error("Privacy export test database is unavailable.");
  return database;
}

async function createExportFixture(client: DatabaseClient, suffix: string) {
  const requester = await createUser(
    client,
    `requester-export-${suffix}@example.test`,
    "CANDIDATE",
  );
  const foreignRequester = await createUser(
    client,
    `foreign-export-${suffix}@example.test`,
    "CANDIDATE",
  );
  const admin = await createUser(
    client,
    `admin-export-${suffix}@example.test`,
    "ADMIN",
  );
  const otherAdmin = await createUser(
    client,
    `other-admin-export-${suffix}@example.test`,
    "ADMIN",
  );
  const employer = await createUser(
    client,
    `employer-export-${suffix}@example.test`,
    "EMPLOYER",
  );
  const profile = await client.candidateProfile.create({
    data: {
      userId: requester.id,
      firstName: "OWN_PROFILE_PII_CANARY",
      publicDisplayName: "Requester",
    },
  });
  const foreignProfile = await client.candidateProfile.create({
    data: {
      userId: foreignRequester.id,
      firstName: "FOREIGN_PROFILE_PII_CANARY",
      publicDisplayName: "Foreign requester",
    },
  });

  await client.userConsentEvent.createMany({
    data: [
      consentRow(requester.id, "TERMS", `${suffix}-terms`),
      consentRow(requester.id, "DATA_USE", `${suffix}-data-use`),
      consentRow(foreignRequester.id, "TERMS", `${suffix}-foreign-terms`),
    ],
  });
  await client.candidateConsent.createMany({
    data: [
      radarConsentRow(profile.id, requester.id, `${suffix}-own`),
      radarConsentRow(
        foreignProfile.id,
        foreignRequester.id,
        `${suffix}-foreign`,
      ),
    ],
  });
  await client.radarProfile.createMany({
    data: [
      radarProfileRow(profile.id, `${suffix}-own`),
      radarProfileRow(foreignProfile.id, `${suffix}-foreign`),
    ],
  });

  const category = await client.category.create({
    data: { name: `Privacy export ${suffix}`, slug: `privacy-export-${suffix}` },
  });
  const company = await client.company.create({
    data: {
      name: `Privacy Export ${suffix} AG`,
      slug: `privacy-export-${suffix}-company`,
      values: [],
      benefits: [],
      dataProvenance: "TEST",
    },
  });
  const job = await client.job.create({
    data: {
      companyId: company.id,
      slug: `privacy-export-${suffix}-job`,
      createdByUserId: employer.id,
      dataProvenance: "TEST",
    },
  });
  const revision = await client.jobRevision.create({
    data: {
      jobId: job.id,
      revisionNumber: 1,
      title: `Privacy export ${suffix} role`,
      description: "A fixture used only to prove requester-owned export counts.",
      tasks: ["Exercise the requester-owned application boundary."],
      requirements: ["Respect private employer notes."],
      applicationProcessSteps: ["Submit through the test fixture."],
      requiredDocumentKinds: ["NONE"],
      jobType: "PERMANENT",
      remoteType: "REMOTE",
      remoteCountryCode: "CH",
      categoryId: category.id,
      workloadMin: 80,
      workloadMax: 100,
      startByArrangement: true,
      responseTargetDays: 14,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: `jobs-${suffix}@example.test`,
      authoredByUserId: employer.id,
      contentChecksum: "a".repeat(64),
    },
  });
  const ownApplication = await client.application.create({
    data: {
      jobId: job.id,
      submittedJobRevisionId: revision.id,
      candidateProfileId: profile.id,
      coverLetter: "OWN_APPLICATION_PII_CANARY",
    },
  });
  await client.application.create({
    data: {
      jobId: job.id,
      submittedJobRevisionId: revision.id,
      candidateProfileId: foreignProfile.id,
      coverLetter: "FOREIGN_APPLICATION_PII_CANARY",
    },
  });
  await client.applicationEmployerNote.create({
    data: {
      applicationId: ownApplication.id,
      companyId: company.id,
      authorUserId: employer.id,
      body: "PRIVATE_EMPLOYER_NOTE_CANARY",
    },
  });

  return { requester, admin, otherAdmin };
}

async function createInProgressExportRequest(
  client: DatabaseClient,
  fixture: Awaited<ReturnType<typeof createExportFixture>>,
  version: number,
) {
  return client.privacyRequest.create({
    data: {
      requesterUserId: fixture.requester.id,
      type: "EXPORT",
      status: "IN_PROGRESS",
      version,
      dueAt: new Date(NOW.getTime() + 30 * DAY),
      assignedAdminUserId: fixture.admin.id,
      assignmentReasonCode: "PRIVACY_CASE_ASSIGNED",
      verifiedAt: new Date(NOW.getTime() - DAY),
      processingStartedAt: new Date(NOW.getTime() - 1_000),
      idempotencyKey: `privacy-export-case-v${version}`,
      deletionDependencies: [],
    },
  });
}

function consentRow(
  userId: string,
  kind: "TERMS" | "DATA_USE",
  suffix: string,
) {
  return {
    userId,
    kind,
    granted: true,
    purpose: `privacy-export-${suffix}`,
    noticeVersion: "privacy-export-v1",
    noticeHash: "b".repeat(64),
    actorUserId: userId,
    effectiveAt: NOW,
  } as const;
}

function radarConsentRow(
  candidateProfileId: string,
  actorUserId: string,
  suffix: string,
) {
  return {
    candidateProfileId,
    kind: "TALENT_RADAR_VISIBILITY" as const,
    granted: true,
    noticeVersion: `radar-${suffix}`,
    noticeHash: "c".repeat(64),
    actorUserId,
    effectiveAt: NOW,
  };
}

function radarProfileRow(candidateProfileId: string, suffix: string) {
  return {
    candidateProfileId,
    displayLabel: `Anonymous ${suffix}`,
    cantonBucket: "ZH",
    categoryBucket: "technology",
    languageCodes: ["de"],
    skillSlugs: ["typescript"],
    projectionVersion: "v1",
    projectionHash: "d".repeat(64),
  };
}

async function createUser(
  client: DatabaseClient,
  email: string,
  role: "ADMIN" | "CANDIDATE" | "EMPLOYER",
) {
  return client.user.create({
    data: {
      email,
      emailNormalized: email.toLowerCase(),
      role,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
}
