import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  decideTalentRadarRuntimeGate,
  lockTalentRadarRuntimeGate,
  type TalentRadarLegalScope,
} from "@/lib/talentradar/legal-gate";
import { listRadarCandidatesWithLockedLegalGate } from "@/lib/talentradar/list-candidates";
import {
  PHASE22_NOW,
  seedPhase22Actors,
  seedPublishedPrivacyNotice,
} from "@/tests/fixtures/phase22-privacy";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const ENVIRONMENT = Object.freeze({
  APP_ENV: "preview" as const,
  LEGAL_PUBLICATION_PRIVACY: true,
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let competingDatabase: DatabaseClient | undefined;
let listDatabase: DatabaseClient | undefined;
let inventoryId = "";
let publicationId = "";
const approvalIds = new Map<TalentRadarLegalScope, string>();
const LIST_APPLICATION_NAME = "phase34_radar_list_revoke";
const TEST_KEY = Object.freeze({
  version: "phase34-v1",
  secret: Buffer.alloc(32, 0x34).toString("base64"),
});

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase34_talent_radar_legal_gate",
  );
  database = createDatabaseClient(migrated.connectionString);
  competingDatabase = createDatabaseClient(migrated.connectionString);
  listDatabase = createDatabaseClient(
    withApplicationName(migrated.connectionString, LIST_APPLICATION_NAME),
  );
  await Promise.all([
    database.$connect(),
    competingDatabase.$connect(),
    listDatabase.$connect(),
  ]);

  const actors = await seedPhase22Actors(database, "phase34-radar-gate");
  const legal = await seedPublishedPrivacyNotice(
    database,
    actors,
    "phase34-radar-gate",
  );
  publicationId = legal.publication.id;
  const inventory = await database.privacyDataInventoryVersion.create({
    data: {
      version: "phase34-radar-v1",
      status: "DRAFT",
      contentHash: createHash("sha256")
        .update("phase34:talent-radar:inventory:v1")
        .digest("hex"),
      owner: "Phase 34 Privacy Owner",
      reviewRef: "counsel:inventory:talent-radar:v1",
      effectiveAt: null,
      entries: {
        create: [
          {
            entityKey: "RADAR_PROFILE",
            fieldScope: "anonymous projection, consent and contact lifecycle",
            subjectClass: "CANDIDATE",
            purposeCode: "TALENT_RADAR",
            legalBasisCode: "COUNSEL_APPROVED_TALENT_RADAR",
            processorKey: "postgres-primary",
            storageRegion: "ch-sandbox",
            retentionDays: 180,
            exportOutcome: "INCLUDE",
            correctionOutcome: "CORRECT",
            erasureOutcome: "DELETE",
            holdRuleCode: "PHASE34_RADAR_HOLD_V1",
            owner: "Phase 34 Privacy Owner",
          },
          {
            entityKey: "MESSAGE",
            fieldScope: "candidate-authored recruiting conversation content",
            subjectClass: "CANDIDATE",
            purposeCode: "RECRUITING_CONVERSATION",
            legalBasisCode: "COUNSEL_APPROVED_RECRUITING_CONVERSATION",
            processorKey: "postgres-primary",
            storageRegion: "ch-sandbox",
            retentionDays: 400,
            exportOutcome: "INCLUDE",
            correctionOutcome: "CORRECT",
            erasureOutcome: "DELETE",
            holdRuleCode: "PHASE34_CONVERSATION_HOLD_V1",
            owner: "Phase 34 Privacy Owner",
          },
        ],
      },
    },
  });
  expect(inventory.id).toMatch(/^[a-f0-9-]{36}$/u);
  inventoryId = inventory.id;
  await database.privacyDataInventoryVersion.update({
    where: { id: inventory.id },
    data: {
      status: "ACTIVE",
      effectiveAt: new Date(PHASE22_NOW.getTime() - 60_000),
    },
  });

  for (const scope of ["TALENT_RADAR", "RECRUITING_CONVERSATION"] as const) {
    const approval = await database.processingApproval.create({
      data: approvedProcessingApproval(scope, legal.publication.id),
    });
    approvalIds.set(scope, approval.id);
  }
}, 120_000);

afterAll(async () => {
  await Promise.all([
    database?.$disconnect().catch(() => undefined),
    competingDatabase?.$disconnect().catch(() => undefined),
    listDatabase?.$disconnect().catch(() => undefined),
  ]);
  database = undefined;
  competingDatabase = undefined;
  listDatabase = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 34 Talent Radar legal evidence lock", () => {
  it.each(["TALENT_RADAR", "RECRUITING_CONVERSATION"] as const)(
    "holds the exact %s approval against a concurrent revoke",
    async (scope) => {
      const approvalId = requireApprovalId(scope);
      const decision = await db().$transaction(async (transaction) => {
        const locked = await lockTalentRadarRuntimeGate(transaction, {
          scope,
          environment: ENVIRONMENT,
          now: PHASE22_NOW,
        });
        expect(locked).toMatchObject({
          allowed: true,
          mode: "APPROVED_PROCESSING",
          approvalId,
        });

        await expect(
          otherDb().$transaction(async (competingTransaction) => {
            await competingTransaction.$executeRawUnsafe(
              "SET LOCAL lock_timeout = '100ms'",
            );
            await competingTransaction.processingApproval.update({
              where: { id: approvalId },
              data: {
                status: "REVOKED",
                revokedAt: PHASE22_NOW,
                revokeReasonCode: "PHASE34_CONCURRENT_REVOKE",
              },
            });
          }),
        ).rejects.toThrow();

        return locked;
      });
      expect(decision.allowed).toBe(true);
    },
  );

  it.each(["TALENT_RADAR", "RECRUITING_CONVERSATION"] as const)(
    "rejects a second current APPROVED row for %s",
    async (scope) => {
      await expect(
        db().processingApproval.create({
          data: {
            ...approvedProcessingApproval(scope, requirePublicationId()),
            version: `phase34-duplicate-${scope.toLowerCase()}`.slice(0, 32),
            createdAt: PHASE22_NOW,
          },
        }),
      ).rejects.toThrow();
      await expect(
        db().processingApproval.count({
          where: {
            scope,
            region: "ch-sandbox",
            processorKey: "postgres-primary",
            status: "APPROVED",
          },
        }),
      ).resolves.toBe(1);
    },
  );

  it.each([
    ["RADAR_PROFILE", "TALENT_RADAR"],
    ["MESSAGE", "RECRUITING_CONVERSATION"],
  ] as const)(
    "rejects a late %s entry after inventory activation",
    async (entityKey, purposeCode) => {
      await expect(
        db().privacyDataInventoryEntry.create({
          data: {
            inventoryVersionId: inventoryId,
            entityKey,
            fieldScope: `late forbidden ${purposeCode.toLowerCase()} scope`,
            subjectClass: "CANDIDATE",
            purposeCode,
            legalBasisCode: "COUNSEL_APPROVED_LATE_ENTRY",
            processorKey: "postgres-primary",
            storageRegion: "ch-sandbox",
            retentionDays: 30,
            exportOutcome: "INCLUDE",
            correctionOutcome: "CORRECT",
            erasureOutcome: "DELETE",
            holdRuleCode: "PHASE34_LATE_ENTRY_HOLD_V1",
            owner: "Phase 34 Privacy Owner",
          },
        }),
      ).rejects.toThrow(/DRAFT/iu);
    },
  );

  it("fails a mid-flight Radar listing closed after the approval revoke wins, with zero downstream effects", async () => {
    const approvalId = requireApprovalId("TALENT_RADAR");
    let releaseRevoke!: () => void;
    const holdRevoke = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    let markUpdated!: () => void;
    const updated = new Promise<void>((resolve) => {
      markUpdated = resolve;
    });
    const revoke = otherDb().$transaction(async (transaction) => {
      await transaction.processingApproval.update({
        where: { id: approvalId },
        data: {
          status: "REVOKED",
          revokedAt: PHASE22_NOW,
          revokeReasonCode: "PHASE34_LIST_MID_FLIGHT_REVOKE",
        },
      });
      markUpdated();
      await holdRevoke;
    });
    await updated;

    let downstreamCalls = 0;
    const listing = listRadarCandidatesWithLockedLegalGate(
      radarListDb(),
      {
        actorUserId: "34000000-0000-4000-8000-000000000101",
        companyId: "34000000-0000-4000-8000-000000000102",
        filters: {},
        now: PHASE22_NOW,
        environment: "production",
        legalGateEnvironment: ENVIRONMENT,
      },
      {
        membershipRateLimit: {
          async consume() {
            downstreamCalls += 1;
            return { allowed: true };
          },
        },
        distinctFilterBudget: {
          async consume() {
            downstreamCalls += 1;
            throw new Error("Legal denial must precede the Radar repository.");
          },
        },
        samplingKey: TEST_KEY,
        cursorKeyring: [TEST_KEY],
        opaqueLookupKeyring: [TEST_KEY],
        opaqueEncryptionKeyring: [TEST_KEY],
      },
    );

    try {
      await waitForListLock();
    } finally {
      releaseRevoke();
    }
    await revoke;

    await expect(listing).resolves.toEqual({
      status: "LOCKED",
      reason: "LEGAL_REVIEW_REQUIRED",
    });
    expect(downstreamCalls).toBe(0);
    await expect(db().radarSearchSession.count()).resolves.toBe(0);
    await expect(db().radarOpaqueMapping.count()).resolves.toBe(0);
    await expect(
      decideTalentRadarRuntimeGate(db(), {
        scope: "TALENT_RADAR",
        environment: ENVIRONMENT,
        now: PHASE22_NOW,
      }),
    ).resolves.toMatchObject({ allowed: false, mode: "BLOCKED" });
  });
});

function approvedProcessingApproval(
  scope: TalentRadarLegalScope,
  legalPublicationId: string,
) {
  const slug = scope.toLowerCase().replaceAll("_", "-");
  return {
    scope,
    region: "ch-sandbox",
    processorKey: "postgres-primary",
    version: `phase34-${slug}`.slice(0, 32),
    status: "APPROVED" as const,
    legalPublicationId,
    legalBasisRef: `counsel:${slug}:v1`,
    avgDecisionRef: `seco:avg:${slug}:v1`,
    dpaRef: null,
    dsfaDecision: "NOT_REQUIRED",
    dsfaDecisionRef: `dsfa:${slug}:not-required:v1`,
    owner: "Phase 34 Privacy Owner",
    approvedBy: "Phase 34 Independent Reviewer",
    effectiveAt: new Date(PHASE22_NOW.getTime() - 60_000),
    expiresAt: new Date(PHASE22_NOW.getTime() + 86_400_000),
    reviewAt: new Date(PHASE22_NOW.getTime() + 43_200_000),
    createdAt: new Date(PHASE22_NOW.getTime() - 120_000),
  } as const;
}

async function waitForListLock(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await db().$queryRaw<readonly { waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE application_name = ${LIST_APPLICATION_NAME}
          AND wait_event_type = 'Lock'
      ) AS waiting
    `;
    if (rows[0]?.waiting === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Radar listing did not reach the concurrent legal row lock.");
}

function withApplicationName(
  connectionString: string,
  applicationName: string,
) {
  const url = new URL(connectionString);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

function requireApprovalId(scope: TalentRadarLegalScope): string {
  const id = approvalIds.get(scope);
  if (id === undefined) throw new Error(`Missing ${scope} approval fixture.`);
  return id;
}

function requirePublicationId(): string {
  if (publicationId.length === 0) {
    throw new Error("Missing Phase 34 legal publication fixture.");
  }
  return publicationId;
}

function db(): DatabaseClient {
  if (database === undefined)
    throw new Error("Phase 34 legal-gate DB unavailable.");
  return database;
}

function radarListDb(): DatabaseClient {
  if (listDatabase === undefined) {
    throw new Error("Phase 34 Radar list database unavailable.");
  }
  return listDatabase;
}

function otherDb(): DatabaseClient {
  if (competingDatabase === undefined) {
    throw new Error("Phase 34 competing legal-gate DB unavailable.");
  }
  return competingDatabase;
}
