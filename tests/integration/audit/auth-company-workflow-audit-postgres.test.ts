import { randomBytes, randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const logoutRuntime = vi.hoisted(() => ({
  database: null as unknown,
  deletedCookies: [] as string[],
  environment: null as unknown,
  sessionToken: "",
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    delete(name: string) {
      logoutRuntime.deletedCookies.push(name);
    },
    get(name: string) {
      return name === "session" && logoutRuntime.sessionToken.length > 0
        ? { value: logoutRuntime.sessionToken }
        : undefined;
    },
  })),
}));

vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: vi.fn(async () => ({
    correlationId: "16000000-0000-4000-8000-000000000001",
    expectedOrigin: "https://phase16-audit.test",
    origin: "https://phase16-audit.test",
    production: true,
    sourceIp: "192.0.2.160",
    userAgent: "Phase 16 workflow audit integration",
  })),
  isValidAuthMutationOrigin: vi.fn(() => true),
}));

vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: vi.fn(() => logoutRuntime.environment),
}));

vi.mock("@/lib/db/client", () => ({
  getDatabase: vi.fn(() => logoutRuntime.database),
}));

import {
  rejectCompanyClaim,
  rejectCompanyVerification,
  requestCompanyClaimEvidence,
  requestCompanyVerificationEvidence,
  revokeCompanyVerification,
  verifyCompany,
} from "@/lib/admin/companies";
import type { AdminDependencies } from "@/lib/admin/common";
import { logoutCurrentSession } from "@/lib/auth/logout-runtime";
import { hashSessionToken } from "@/lib/auth/session";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@/lib/db/factory";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-23T12:00:00.000Z");
const LOGOUT_CORRELATION_ID = "16000000-0000-4000-8000-000000000001";

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

function db(): DatabaseClient {
  if (database === undefined) {
    throw new Error("The Phase-16 workflow-audit database is unavailable.");
  }
  return database;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase16_auth_company_audit");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  environment = parseEnvironment(
    createValidEnvironment({
      APP_URL: "https://phase16-audit.test",
      DATABASE_URL: migrated.connectionString,
    }),
  );
  logoutRuntime.database = database;
  logoutRuntime.environment = environment;
}, 120_000);

afterAll(async () => {
  logoutRuntime.database = null;
  logoutRuntime.environment = null;
  logoutRuntime.sessionToken = "";
  logoutRuntime.deletedCookies.length = 0;
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  environment = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase-16 auth and company workflow audit evidence", () => {
  it("logs out through the owning service, deletes the real session and persists USER_LOGOUT", async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    await db().user.create({
      data: {
        id: userId,
        email: "phase16-logout-audit@fixture.example.test",
        emailNormalized: "phase16-logout-audit@fixture.example.test",
        name: "Phase 16 Logout Audit",
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "TEST",
        sessions: {
          create: {
            id: sessionId,
            tokenHash: hashSessionToken(token),
            createdAt: NOW,
            expiresAt: new Date(NOW.getTime() + 60 * 60 * 1_000),
            absoluteExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
            userAgent: "Phase 16 workflow audit integration",
          },
        },
      },
    });
    logoutRuntime.sessionToken = token;
    logoutRuntime.deletedCookies.length = 0;

    await expect(logoutCurrentSession()).resolves.toBeUndefined();

    await expect(
      db().session.findUnique({ where: { id: sessionId } }),
    ).resolves.toBeNull();
    await expect(
      db().auditLog.findFirstOrThrow({
        where: {
          action: "USER_LOGOUT",
          targetType: "SESSION",
          targetId: sessionId,
          correlationId: LOGOUT_CORRELATION_ID,
        },
        select: {
          action: true,
          actorKind: true,
          actorUserId: true,
          capability: true,
          correlationId: true,
          ipHash: true,
          reasonCode: true,
          result: true,
          targetId: true,
          targetType: true,
        },
      }),
    ).resolves.toEqual({
      action: "USER_LOGOUT",
      actorKind: "USER",
      actorUserId: userId,
      capability: "AUTH_LOGOUT",
      correlationId: LOGOUT_CORRELATION_ID,
      ipHash: expect.stringMatching(/^audit-v1:[a-f0-9]{64}$/u),
      reasonCode: null,
      result: "SUCCEEDED",
      targetId: sessionId,
      targetType: "SESSION",
    });
    expect(logoutRuntime.deletedCookies).toEqual([
      "session",
      "company_context",
    ]);
  });

  it("persists claim and verification audits only through their owning admin transitions", async () => {
    const fixture = await createCompanyAuditFixture();
    const claimEvidenceCorrelation = randomUUID();
    const claimRejectCorrelation = randomUUID();
    const verificationChangesCorrelation = randomUUID();
    const verificationRejectCorrelation = randomUUID();
    const verificationVerifyCorrelation = randomUUID();
    const verificationRevokeCorrelation = randomUUID();

    requireSuccess(
      await requestCompanyClaimEvidence(
        {
          claimId: fixture.claimId,
          expectedStatus: "PENDING",
          reasonCode: "ADDITIONAL_EVIDENCE_REQUIRED",
          evidenceRef: "case://phase16/claim/evidence",
          idempotencyKey: randomUUID(),
        },
        adminDependencies(
          fixture.adminUserId,
          claimEvidenceCorrelation,
          1,
        ),
      ),
    );
    requireSuccess(
      await rejectCompanyClaim(
        {
          claimId: fixture.claimId,
          expectedStatus: "NEEDS_EVIDENCE",
          reasonCode: "CLAIM_EVIDENCE_INSUFFICIENT",
          idempotencyKey: randomUUID(),
        },
        adminDependencies(
          fixture.adminUserId,
          claimRejectCorrelation,
          2,
        ),
      ),
    );
    requireSuccess(
      await requestCompanyVerificationEvidence(
        {
          verificationRequestId: fixture.changesRequestId,
          expectedStatus: "PENDING",
          reasonCode: "VERIFICATION_DOCUMENTS_INCOMPLETE",
          evidenceRef: "case://phase16/verification/changes",
          idempotencyKey: randomUUID(),
        },
        adminDependencies(
          fixture.adminUserId,
          verificationChangesCorrelation,
          3,
        ),
      ),
    );
    requireSuccess(
      await rejectCompanyVerification(
        {
          verificationRequestId: fixture.rejectedRequestId,
          expectedStatus: "PENDING",
          reasonCode: "VERIFICATION_EVIDENCE_REJECTED",
          idempotencyKey: randomUUID(),
        },
        adminDependencies(
          fixture.adminUserId,
          verificationRejectCorrelation,
          4,
        ),
      ),
    );
    requireSuccess(
      await verifyCompany(
        {
          verificationRequestId: fixture.revokedRequestId,
          expectedStatus: "PENDING",
          idempotencyKey: randomUUID(),
        },
        adminDependencies(
          fixture.adminUserId,
          verificationVerifyCorrelation,
          5,
        ),
      ),
    );
    requireSuccess(
      await revokeCompanyVerification(
        {
          verificationRequestId: fixture.revokedRequestId,
          expectedStatus: "VERIFIED",
          reasonCode: "VERIFICATION_TRUST_REVOKED",
          idempotencyKey: randomUUID(),
        },
        adminDependencies(
          fixture.adminUserId,
          verificationRevokeCorrelation,
          6,
        ),
      ),
    );

    const audits = await db().auditLog.findMany({
      where: {
        correlationId: {
          in: [
            claimEvidenceCorrelation,
            claimRejectCorrelation,
            verificationChangesCorrelation,
            verificationRejectCorrelation,
            verificationVerifyCorrelation,
            verificationRevokeCorrelation,
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        action: true,
        actorKind: true,
        actorUserId: true,
        capability: true,
        companyId: true,
        correlationId: true,
        reasonCode: true,
        result: true,
        targetId: true,
        targetType: true,
      },
    });

    expect(audits).toEqual([
      expectedAdminAudit({
        action: "COMPANY_CLAIM_EVIDENCE_REQUESTED",
        capability: "ADMIN_CLAIM_REVIEW",
        companyId: fixture.claimCompanyId,
        correlationId: claimEvidenceCorrelation,
        reasonCode: "ADDITIONAL_EVIDENCE_REQUIRED",
        targetId: fixture.claimId,
        targetType: "CLAIM_REQUEST",
        adminUserId: fixture.adminUserId,
      }),
      expectedAdminAudit({
        action: "COMPANY_CLAIM_REJECTED",
        capability: "ADMIN_CLAIM_REVIEW",
        companyId: fixture.claimCompanyId,
        correlationId: claimRejectCorrelation,
        reasonCode: "CLAIM_EVIDENCE_INSUFFICIENT",
        targetId: fixture.claimId,
        targetType: "CLAIM_REQUEST",
        adminUserId: fixture.adminUserId,
      }),
      expectedAdminAudit({
        action: "COMPANY_VERIFICATION_CHANGES_REQUESTED",
        capability: "ADMIN_COMPANY_REVIEW",
        companyId: fixture.changesCompanyId,
        correlationId: verificationChangesCorrelation,
        reasonCode: "VERIFICATION_DOCUMENTS_INCOMPLETE",
        targetId: fixture.changesRequestId,
        targetType: "VERIFICATION_REQUEST",
        adminUserId: fixture.adminUserId,
      }),
      expectedAdminAudit({
        action: "COMPANY_VERIFICATION_REJECTED",
        capability: "ADMIN_COMPANY_REVIEW",
        companyId: fixture.rejectedCompanyId,
        correlationId: verificationRejectCorrelation,
        reasonCode: "VERIFICATION_EVIDENCE_REJECTED",
        targetId: fixture.rejectedRequestId,
        targetType: "VERIFICATION_REQUEST",
        adminUserId: fixture.adminUserId,
      }),
      expectedAdminAudit({
        action: "COMPANY_VERIFIED",
        capability: "ADMIN_COMPANY_REVIEW",
        companyId: fixture.revokedCompanyId,
        correlationId: verificationVerifyCorrelation,
        reasonCode: "VERIFIED",
        targetId: fixture.revokedRequestId,
        targetType: "VERIFICATION_REQUEST",
        adminUserId: fixture.adminUserId,
      }),
      expectedAdminAudit({
        action: "COMPANY_VERIFICATION_REVOKED",
        capability: "ADMIN_COMPANY_REVIEW",
        companyId: fixture.revokedCompanyId,
        correlationId: verificationRevokeCorrelation,
        reasonCode: "VERIFICATION_TRUST_REVOKED",
        targetId: fixture.revokedRequestId,
        targetType: "VERIFICATION_REQUEST",
        adminUserId: fixture.adminUserId,
      }),
    ]);
  });
});

async function createCompanyAuditFixture() {
  const adminUserId = randomUUID();
  const employerUserId = randomUUID();
  const claimCompanyId = randomUUID();
  const changesCompanyId = randomUUID();
  const rejectedCompanyId = randomUUID();
  const revokedCompanyId = randomUUID();
  const claimId = randomUUID();
  const changesRequestId = randomUUID();
  const rejectedRequestId = randomUUID();
  const revokedRequestId = randomUUID();
  await db().user.createMany({
    data: [
      {
        id: adminUserId,
        email: "phase16-company-audit-admin@fixture.example.test",
        emailNormalized: "phase16-company-audit-admin@fixture.example.test",
        name: "Phase 16 Company Audit Admin",
        role: "ADMIN",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
      {
        id: employerUserId,
        email: "phase16-company-audit-employer@fixture.example.test",
        emailNormalized: "phase16-company-audit-employer@fixture.example.test",
        name: "Phase 16 Company Audit Employer",
        role: "EMPLOYER",
        status: "ACTIVE",
        dataProvenance: "TEST",
      },
    ],
  });
  await db().company.createMany({
    data: [
      companyData(claimCompanyId, "claim"),
      companyData(changesCompanyId, "changes"),
      companyData(rejectedCompanyId, "rejected"),
      companyData(revokedCompanyId, "revoked"),
    ],
  });
  await db().companyClaimRequest.create({
    data: {
      id: claimId,
      requesterEmployerUserId: employerUserId,
      candidateCompanyId: claimCompanyId,
      requestedRole: "OWNER",
      matchSignals: ["EMAIL_DOMAIN"],
      status: "PENDING",
      idempotencyKey: `phase16-company-audit-claim-${claimId}`,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  await db().companyVerificationRequest.createMany({
    data: [
      verificationData(changesRequestId, changesCompanyId, employerUserId),
      verificationData(rejectedRequestId, rejectedCompanyId, employerUserId),
      verificationData(revokedRequestId, revokedCompanyId, employerUserId),
    ],
  });
  return Object.freeze({
    adminUserId,
    changesCompanyId,
    changesRequestId,
    claimCompanyId,
    claimId,
    rejectedCompanyId,
    rejectedRequestId,
    revokedCompanyId,
    revokedRequestId,
  });
}

function companyData(id: string, suffix: string) {
  return {
    id,
    name: `Phase 16 Audit ${suffix}`,
    slug: `phase-16-audit-${suffix}-${id.slice(0, 8)}`,
    status: "DRAFT" as const,
    dataProvenance: "TEST" as const,
    values: [] as string[],
    benefits: [] as string[],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function verificationData(
  id: string,
  companyId: string,
  requestedByUserId: string,
) {
  return {
    id,
    companyId,
    requestedByUserId,
    status: "PENDING" as const,
    evidenceMetadata: { fixture: "phase16-audit-workflow" },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function adminDependencies(
  adminUserId: string,
  correlationId: string,
  milliseconds: number,
): AdminDependencies {
  return Object.freeze({
    actor: {
      userId: adminUserId,
      email: "phase16-company-audit-admin@fixture.example.test",
      role: "ADMIN",
      status: "ACTIVE",
    },
    correlationId,
    database: db(),
    now: new Date(NOW.getTime() + milliseconds),
  });
}

function requireSuccess<T>(
  result:
    | Readonly<{ ok: true; value: T }>
    | Readonly<{ ok: false; code: string }>,
) {
  if (!result.ok) {
    throw new Error(`Expected workflow success, received ${result.code}.`);
  }
  return result.value;
}

function expectedAdminAudit(input: Readonly<{
  action:
    | "COMPANY_CLAIM_EVIDENCE_REQUESTED"
    | "COMPANY_CLAIM_REJECTED"
    | "COMPANY_VERIFICATION_CHANGES_REQUESTED"
    | "COMPANY_VERIFIED"
    | "COMPANY_VERIFICATION_REJECTED"
    | "COMPANY_VERIFICATION_REVOKED";
  adminUserId: string;
  capability: "ADMIN_CLAIM_REVIEW" | "ADMIN_COMPANY_REVIEW";
  companyId: string;
  correlationId: string;
  reasonCode: string;
  targetId: string;
  targetType: "CLAIM_REQUEST" | "VERIFICATION_REQUEST";
}>) {
  return {
    action: input.action,
    actorKind: "USER" as const,
    actorUserId: input.adminUserId,
    capability: input.capability,
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: input.reasonCode,
    result: "SUCCEEDED" as const,
    targetId: input.targetId,
    targetType: input.targetType,
  };
}
