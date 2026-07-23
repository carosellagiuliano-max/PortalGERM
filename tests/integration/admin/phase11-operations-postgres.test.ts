import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  approveAdminJob,
  publishAdminJob,
  startAdminJobReview,
} from "@/lib/admin/jobs";
import {
  applyModerationRestriction,
  expireModerationRestriction,
  isConversationMessageBlocked,
  liftModerationRestriction,
  resolveAbuseReport,
  triageAbuseReport,
} from "@/lib/admin/moderation";
import {
  approveImportSetup,
  commitImportRun,
  decideImportItem,
  parseLicensedImport,
  revokeImportSetup,
  rollbackImportRun,
} from "@/lib/admin/imports";
import {
  createSupportCase,
  getAdminSupportCase,
  getRequesterSupportCase,
  listAdminSupportCases,
  manageSupportCase,
  replyToSupportCase,
} from "@/lib/admin/support";
import {
  saveContentDraft,
  transitionClusterLaunch,
  transitionContentRevision,
} from "@/lib/admin/content";
import {
  approveCompanyClaim,
  reactivateCompany,
  suspendCompany,
} from "@/lib/admin/companies";
import {
  forceLogoutUser,
  reactivateUser,
  suspendUser,
} from "@/lib/admin/users";
import { getBusinessCockpit } from "@/lib/admin/cockpit";
import { manageSalesLead } from "@/lib/admin/leads";
import { projectAdminSlaAlerts } from "@/lib/admin/sla";
import { mutateAdminTaxonomy } from "@/lib/admin/taxonomy";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { MockEmailProvider, type EmailProvider } from "@/lib/providers/email";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { salesLeadAnalyticsKeyV1 } from "@/lib/sales/lead-policy";
import { ADMIN_IMPORT_DEMO_FIXTURES } from "@/prisma/seed/fixtures";
import { orchestrateDemoSeed } from "@/prisma/seed/orchestrator";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-21T12:00:00.000Z");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let adminUserId = "";

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase11_admin_operations");
  database = createDatabaseClient(migrated.connectionString);
  await orchestrateDemoSeed(database);
  adminUserId = (
    await database.user.findFirstOrThrow({
      where: { role: "ADMIN", status: "ACTIVE" },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase 11 PostgreSQL operations boundary", () => {
  it("reviews a submitted Job in canonical order with one event and audit per transition", async () => {
    const client = db();
    const job = await client.job.findFirstOrThrow({
      where: { status: "SUBMITTED", currentRevision: { isNot: null } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        companyId: true,
        version: true,
        currentRevision: { select: { id: true, version: true } },
      },
    });
    if (job.currentRevision === null) throw new Error("Submitted fixture has no revision.");
    const started = requireSuccess(
      await startAdminJobReview(
        {
          jobId: job.id,
          expectedJobVersion: job.version,
          expectedRevisionVersion: job.currentRevision.version,
          idempotencyKey: randomUUID(),
        },
        deps("job-start-review", afterMilliseconds(1)),
      ),
    );
    const persistedEmail = new MockEmailProvider(
      new PrismaEmailLogRepository(client),
    );
    const email: EmailProvider = {
      async send(input) {
        await persistedEmail.send(input);
        throw new Error("Simulated post-persistence delivery failure.");
      },
    };
    const approvedInput = {
      jobId: job.id,
      expectedJobVersion: started.value.jobVersion,
      expectedRevisionVersion: started.value.revisionVersion,
      reasonCode: "QUALITY_REVIEW_PASSED",
      idempotencyKey: randomUUID(),
    };
    const approved = requireSuccess(
      await approveAdminJob(approvedInput, deps("job-approve", afterMilliseconds(2)), email),
    );
    expect(approved.value.status).toBe("APPROVED");
    await expect(
      client.emailLog.findFirstOrThrow({
        where: { templateKey: "job_approved" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { payload: true, status: true },
      }),
    ).resolves.toMatchObject({
      payload: { subject: "Dein Stelleninserat wurde freigegeben" },
      status: "MOCK_RECORDED",
    });
    const publishInput = {
      jobId: job.id,
      expectedJobVersion: approved.value.jobVersion,
      expectedRevisionVersion: approved.value.revisionVersion,
      reasonCode: "ADMIN_APPROVED_PUBLICATION",
      idempotencyKey: randomUUID(),
    };
    expect(await publishAdminJob(publishInput, deps("job-publish-at-limit", afterMilliseconds(3)))).toEqual({ ok: false, code: "QUOTA_EXCEEDED" });
    expect(await client.job.findUnique({ where: { id: job.id }, select: { status: true } })).toEqual({ status: "APPROVED" });
    requireSuccess(await suspendCompany({ companyId: job.companyId, expectedStatus: "ACTIVE", reasonCode: "PUBLICATION_CAPACITY_REVIEW", idempotencyKey: randomUUID() }, deps("job-company-suspend", afterMilliseconds(4))));
    requireSuccess(await reactivateCompany({ companyId: job.companyId, expectedStatus: "SUSPENDED", reasonCode: "PUBLICATION_CAPACITY_REVIEWED", idempotencyKey: randomUUID() }, deps("job-company-reactivate", afterMilliseconds(5))));
    const published = requireSuccess(await publishAdminJob({ ...publishInput, idempotencyKey: randomUUID() }, deps("job-publish", afterMilliseconds(6))));
    expect(published.value.status).toBe("PUBLISHED");
    await expect(
      client.jobStatusEvent.findMany({
        where: { jobId: job.id, kind: { in: ["REVIEW_STARTED", "APPROVED", "PUBLISHED"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { kind: true, fromStatus: true, toStatus: true },
      }),
    ).resolves.toEqual([
      { kind: "REVIEW_STARTED", fromStatus: "SUBMITTED", toStatus: "IN_REVIEW" },
      { kind: "APPROVED", fromStatus: "IN_REVIEW", toStatus: "APPROVED" },
      { kind: "PUBLISHED", fromStatus: "APPROVED", toStatus: "PUBLISHED" },
    ]);
    await expect(
      client.analyticsEvent.findUnique({
        where: {
          producer_dedupeKey: {
            producer: "admin-job-publish",
            dedupeKey: `JOB_PUBLISHED:${job.id}`,
          },
        },
        select: {
          kind: true,
          companyId: true,
          jobId: true,
          properties: true,
        },
      }),
    ).resolves.toEqual({
      kind: "JOB_PUBLISHED",
      companyId: job.companyId,
      jobId: job.id,
      properties: { fromStatus: "APPROVED", toStatus: "PUBLISHED" },
    });
    expect(
      await client.auditLog.count({
        where: { targetId: job.id, action: { in: ["JOB_REVIEW_STARTED", "JOB_APPROVED", "JOB_PUBLISHED"] } },
      }),
    ).toBe(3);
  });

  it("suspends a Company atomically and never republishes Jobs on reactivation", async () => {
    const client = db();
    const company = await client.company.findFirstOrThrow({
      where: { status: "ACTIVE", jobs: { some: { status: "PUBLISHED" } } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const publishedBefore = await client.job.count({
      where: { companyId: company.id, status: "PUBLISHED" },
    });
    const suspended = requireSuccess(
      await suspendCompany(
        {
          companyId: company.id,
          expectedStatus: "ACTIVE",
          reasonCode: "PLATFORM_RISK_REVIEW",
          idempotencyKey: randomUUID(),
        },
        deps("company-suspend"),
      ),
    );
    expect(suspended.value.pausedJobs).toBe(publishedBefore);
    expect(await client.job.count({ where: { companyId: company.id, status: "PUBLISHED" } })).toBe(0);
    requireSuccess(
      await reactivateCompany(
        {
          companyId: company.id,
          expectedStatus: "SUSPENDED",
          reasonCode: "REVIEW_COMPLETED",
          idempotencyKey: randomUUID(),
        },
        deps("company-reactivate"),
      ),
    );
    expect(await client.company.findUnique({ where: { id: company.id }, select: { status: true } })).toEqual({ status: "ACTIVE" });
    expect(await client.job.count({ where: { companyId: company.id, status: "PUBLISHED" } })).toBe(0);
    expect(await client.job.count({ where: { companyId: company.id, status: "PAUSED" } })).toBeGreaterThanOrEqual(publishedBefore);
    const companyAuditActions = await client.auditLog.findMany({
        where: {
          targetId: company.id,
          action: { in: ["COMPANY_SUSPENDED", "COMPANY_REACTIVATED"] },
        },
        select: { action: true, targetType: true },
      });
    expect(companyAuditActions).toHaveLength(2);
    expect(companyAuditActions).toEqual(
      expect.arrayContaining([
        { action: "COMPANY_SUSPENDED", targetType: "COMPANY" },
        { action: "COMPANY_REACTIVATED", targetType: "COMPANY" },
      ]),
    );
  });

  it("revokes sessions on User suspension and requires explicit reactivation", async () => {
    const client = db();
    const user = await client.user.findFirstOrThrow({
      where: { role: "CANDIDATE", status: "ACTIVE" },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const session = await client.session.create({ data: {
      userId: user.id,
      tokenHash: "a".repeat(64),
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      absoluteExpiresAt: new Date(NOW.getTime() + 7_200_000),
    }, select: { id: true } });
    const suspensionIdempotencyKey = randomUUID();
    const suspended = requireSuccess(
      await suspendUser(
        {
          userId: user.id,
          expectedStatus: "ACTIVE",
          reasonCode: "ABUSE_REVIEW_CONFIRMED",
          idempotencyKey: suspensionIdempotencyKey,
        },
        deps("user-suspend"),
      ),
    );
    expect(suspended.value.sessionsRevoked).toBeGreaterThan(0);
    expect(await client.session.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { id: "asc" },
      select: { id: true, createdAt: true },
    })).toEqual([]);
    await expect(client.session.findUniqueOrThrow({
      where: { id: session.id },
      select: { revokedAt: true },
    })).resolves.toEqual({ revokedAt: NOW });
    await expect(client.auditLog.findFirstOrThrow({
      where: {
        action: "SESSION_REVOKED",
        targetId: session.id,
        correlationId: suspensionIdempotencyKey,
      },
      select: { targetType: true, reasonCode: true },
    })).resolves.toEqual({
      targetType: "SESSION",
      reasonCode: "USER_SUSPENDED",
    });
    requireSuccess(
      await reactivateUser(
        {
          userId: user.id,
          expectedStatus: "SUSPENDED",
          reasonCode: "MANUAL_REVIEW_COMPLETED",
          idempotencyKey: randomUUID(),
        },
        deps("user-reactivate"),
      ),
    );
    expect(await client.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    await expect(
      client.auditLog.findFirstOrThrow({
        where: { action: "USER_REACTIVATED", targetId: user.id },
        select: { targetType: true, result: true },
      }),
    ).resolves.toEqual({ targetType: "USER", result: "SUCCEEDED" });
  });

  it("force-logout preserves and audits every revoked Session by its real id", async () => {
    const client = db();
    const user = await client.user.findFirstOrThrow({
      where: { role: "EMPLOYER", status: "ACTIVE" },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const sessions = await Promise.all(
      ["c", "d"].map((prefix) =>
        client.session.create({
          data: {
            userId: user.id,
            tokenHash: `${prefix}${randomUUID().replaceAll("-", "")}`.padEnd(64, prefix).slice(0, 64),
            createdAt: NOW,
            expiresAt: new Date(NOW.getTime() + 3_600_000),
            absoluteExpiresAt: new Date(NOW.getTime() + 7_200_000),
          },
          select: { id: true },
        }),
      ),
    );
    const idempotencyKey = randomUUID();
    const activeSessions = await client.session.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const input = {
      userId: user.id,
      reasonCode: "ADMIN_FORCE_LOGOUT",
      idempotencyKey,
    };

    await expect(forceLogoutUser(input, deps("force-logout"))).resolves.toEqual({
      ok: true,
      value: { userId: user.id, sessionsRevoked: activeSessions.length },
    });
    await expect(forceLogoutUser(input, deps("force-logout-replay"))).resolves.toMatchObject({
      ok: true,
      replay: true,
      value: { userId: user.id, sessionsRevoked: activeSessions.length },
    });
    await expect(client.session.count({
      where: { id: { in: sessions.map(({ id }) => id) } },
    })).resolves.toBe(sessions.length);
    await expect(client.session.count({
      where: { id: { in: sessions.map(({ id }) => id) }, revokedAt: NOW },
    })).resolves.toBe(sessions.length);
    const audits = await client.auditLog.findMany({
      where: { action: "SESSION_REVOKED", correlationId: idempotencyKey },
      orderBy: { targetId: "asc" },
      select: { targetId: true, targetType: true, reasonCode: true },
    });
    expect(audits).toEqual(
      activeSessions
        .map(({ id }) => ({
          targetId: id,
          targetType: "SESSION" as const,
          reasonCode: "ADMIN_FORCE_LOGOUT",
        }))
        .sort((left, right) => left.targetId.localeCompare(right.targetId)),
    );
  });

  it("keeps Support requester scope and completes request-information, reply, resolve and reopen", async () => {
    const client = db();
    const requesters = await client.user.findMany({
      where: { status: "ACTIVE", role: { in: ["CANDIDATE", "EMPLOYER"] } },
      orderBy: { id: "asc" },
      take: 2,
      select: { id: true, status: true },
    });
    const requesterRow = requesters[0];
    const outsiderRow = requesters[1];
    if (requesterRow === undefined || outsiderRow === undefined) throw new Error("Support fixtures missing.");
    const requester = { userId: requesterRow.id, status: requesterRow.status };
    const outsider = { userId: outsiderRow.id, status: outsiderRow.status };
    const created = requireSuccess(
      await createSupportCase(
        {
          category: "ACCOUNT",
          subject: "Anmeldung funktioniert nicht",
          description: "Die Anmeldung schlägt nach der sicheren Bestätigung weiterhin fehl.",
          contactPreference: "EMAIL",
          idempotencyKey: randomUUID(),
        },
        requester,
        client,
        NOW,
      ),
    );
    expect(await getRequesterSupportCase(client, outsider, created.value.caseId)).toBeNull();
    let version = 1;
    requireSuccess(await manageSupportCase({ caseId: created.value.caseId, expectedVersion: version++, action: "TRIAGE", priority: "HIGH", reasonCode: "ACCOUNT_ACCESS", idempotencyKey: randomUUID() }, deps("support-triage", afterMilliseconds(1))));
    requireSuccess(await manageSupportCase({ caseId: created.value.caseId, expectedVersion: version++, action: "ASSIGN", assigneeUserId: adminUserId, reasonCode: "OWNER_ASSIGNED", idempotencyKey: randomUUID() }, deps("support-assign", afterMilliseconds(2))));
    requireSuccess(await manageSupportCase({ caseId: created.value.caseId, expectedVersion: version++, action: "REQUEST_INFORMATION", safeBody: "Bitte den ungefähren Zeitpunkt des Fehlers nennen.", reasonCode: "MORE_INFORMATION_REQUIRED", idempotencyKey: randomUUID() }, deps("support-request-info", afterMilliseconds(3))));
    requireSuccess(await replyToSupportCase({ caseId: created.value.caseId, body: "Der Fehler trat heute gegen 10 Uhr auf. <script>bad()</script>", idempotencyKey: randomUUID() }, requester, client, afterMilliseconds(4)));
    version += 1;
    requireSuccess(await manageSupportCase({ caseId: created.value.caseId, expectedVersion: version++, action: "RESOLVE", reasonCode: "ACCESS_RESTORED", idempotencyKey: randomUUID() }, deps("support-resolve", afterMilliseconds(5))));
    requireSuccess(await manageSupportCase({ caseId: created.value.caseId, expectedVersion: version, action: "REOPEN", reasonCode: "ISSUE_RECURRED", idempotencyKey: randomUUID() }, deps("support-reopen", afterMilliseconds(6))));
    const detail = await getRequesterSupportCase(client, requester, created.value.caseId);
    expect(detail?.status).toBe("IN_PROGRESS");
    expect(detail?.events.map(({ kind }) => kind)).toEqual([
      "CREATED", "TRIAGED", "ASSIGNED", "INFORMATION_REQUESTED", "REPLIED", "RESOLVED", "REOPENED",
    ]);
    expect(detail?.events.find(({ kind }) => kind === "REPLIED")?.safeBody).not.toContain("<script>");
    const supportAuditActions = await client.auditLog.findMany({
      where: {
        targetId: created.value.caseId,
        action: {
          in: [
            "SUPPORT_CASE_CREATED",
            "SUPPORT_CASE_TRIAGED",
            "SUPPORT_CASE_ASSIGNED",
            "SUPPORT_CASE_REPLIED",
            "SUPPORT_CASE_RESOLVED",
            "SUPPORT_CASE_REOPENED",
          ],
        },
      },
      select: { action: true },
    });
    expect(
      supportAuditActions.map(({ action }) => action).sort(),
    ).toEqual([
      "SUPPORT_CASE_ASSIGNED",
      "SUPPORT_CASE_CREATED",
      "SUPPORT_CASE_REOPENED",
      "SUPPORT_CASE_REPLIED",
      "SUPPORT_CASE_RESOLVED",
      "SUPPORT_CASE_TRIAGED",
      "SUPPORT_CASE_TRIAGED",
    ]);
  });

  it("denies every Support admin read and mutation without the capability", async () => {
    const supportCase = await db().supportCase.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true, version: true } });
    const unauthorized = Object.freeze({ ...deps("support-denied"), actor: { userId: adminUserId, email: "employer@demo.ch", role: "EMPLOYER", status: "ACTIVE" } as const });
    await expect(listAdminSupportCases(unauthorized)).resolves.toBeNull();
    await expect(getAdminSupportCase(unauthorized, supportCase.id)).resolves.toBeNull();
    await expect(manageSupportCase({ caseId: supportCase.id, expectedVersion: supportCase.version, action: "TRIAGE", priority: "HIGH", reasonCode: "FORGED_ADMIN_READ", idempotencyKey: randomUUID() }, unauthorized)).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("runs Content through draft, review, publish and unpublish with stale and XSS guards", async () => {
    const client = db();
    const rejected = await saveContentDraft({
      locale: "de-CH",
      type: "GUIDE",
      slug: "unsicherer-guide",
      canonicalPath: "/guide/unsicherer-guide",
      title: "Unsicherer Guide",
      excerpt: "Dieser Inhalt soll wegen aktivem Script nicht gespeichert werden.",
      body: "<script>alert(1)</script>",
      idempotencyKey: randomUUID(),
    }, deps("content-xss"));
    expect(rejected).toEqual({ ok: false, code: "INVALID_INPUT" });
    const draft = requireSuccess(await saveContentDraft({
      locale: "de-CH",
      type: "GUIDE",
      slug: "phase-11-sicher",
      canonicalPath: "/guide/phase-11-sicher",
      title: "Sicherer Operations Guide",
      excerpt: "Ein dokumentierter Guide für sichere operative Abläufe im Portal.",
      body: "# Sicher arbeiten\n\nAlle Entscheidungen werden geprüft und nachvollziehbar protokolliert.",
      idempotencyKey: randomUUID(),
    }, deps("content-draft")));
    const stale = await transitionContentRevision({ revisionId: draft.value.revisionId, expectedVersion: 99, action: "SUBMIT", reasonCode: "READY_FOR_REVIEW", idempotencyKey: randomUUID() }, deps("content-stale"));
    expect(stale).toEqual({ ok: false, code: "CONFLICT" });
    const submitted = requireSuccess(await transitionContentRevision({ revisionId: draft.value.revisionId, expectedVersion: 1, action: "SUBMIT", reasonCode: "READY_FOR_REVIEW", idempotencyKey: randomUUID() }, deps("content-submit")));
    const approved = requireSuccess(await transitionContentRevision({ revisionId: draft.value.revisionId, expectedVersion: submitted.value.version, action: "APPROVE", reasonCode: "EDITORIAL_APPROVAL", idempotencyKey: randomUUID() }, deps("content-approve")));
    const published = requireSuccess(await transitionContentRevision({ revisionId: draft.value.revisionId, expectedVersion: approved.value.version, action: "PUBLISH", reasonCode: "PUBLISH_APPROVED", idempotencyKey: randomUUID() }, deps("content-publish")));
    requireSuccess(await transitionContentRevision({ revisionId: draft.value.revisionId, expectedVersion: published.value.version, action: "UNPUBLISH", reasonCode: "CONTENT_REVIEW_REQUIRED", idempotencyKey: randomUUID() }, deps("content-unpublish")));
    expect(await client.contentPage.findUnique({ where: { id: draft.value.pageId }, select: { currentPublishedRevisionId: true } })).toEqual({ currentPublishedRevisionId: null });
    const contentAuditActions = await client.auditLog.findMany({
      where: {
        targetId: draft.value.revisionId,
        action: {
          in: [
            "CONTENT_DRAFTED",
            "CONTENT_REVIEWED",
            "CONTENT_PUBLISHED",
            "CONTENT_UNPUBLISHED",
          ],
        },
      },
      select: { action: true },
    });
    expect(
      contentAuditActions.map(({ action }) => action).sort(),
    ).toEqual([
      "CONTENT_DRAFTED",
      "CONTENT_PUBLISHED",
      "CONTENT_REVIEWED",
      "CONTENT_REVIEWED",
      "CONTENT_UNPUBLISHED",
    ]);
  });

  it("parses only a preview, commits explicit mappings to Draft and tombstones a pristine rollback", async () => {
    const client = db();
    const source = await client.importSource.findFirstOrThrow({
      where: { sourceReference: "local-demo-feed-v1", isActive: true },
      select: {
        id: true,
        companyRights: {
          where: { revokedAt: null },
          orderBy: { id: "asc" },
          take: 1,
          select: { companyId: true },
        },
      },
    });
    const companyId = source.companyRights[0]?.companyId;
    if (companyId === undefined) throw new Error("Licensed import right missing.");
    const parseInput = {
      importSourceId: source.id,
      inputSource: "PASTE",
      format: "JSON",
      payload: ADMIN_IMPORT_DEMO_FIXTURES.duplicateJson,
      idempotencyKey: randomUUID(),
    };
    const parsed = requireSuccess(await parseLicensedImport(parseInput, deps("import-parse")));
    expect(parsed.value).toMatchObject({ status: "PREVIEW_READY", okItems: 1, errorItems: 1 });
    expect(await client.job.count({ where: { importSourceId: source.id } })).toBe(0);
    const items = await client.importItem.findMany({
      where: { runId: parsed.value.runId },
      orderBy: { sourceItemKey: "asc" },
      select: { id: true, status: true },
    });
    const okItem = items.find(({ status }) => status === "OK");
    const errorItem = items.find(({ status }) => status === "ERROR");
    if (okItem === undefined || errorItem === undefined) throw new Error("Mixed import preview missing.");
    requireSuccess(await decideImportItem({ itemId: okItem.id, decision: "APPROVE", companyId, reasonCode: "SOURCE_RIGHTS_VERIFIED", idempotencyKey: randomUUID() }, deps("import-approve")));
    requireSuccess(await decideImportItem({ itemId: errorItem.id, decision: "REJECT", reasonCode: "DUPLICATE_SOURCE_ID", idempotencyKey: randomUUID() }, deps("import-reject")));
    const committed = requireSuccess(await commitImportRun({ runId: parsed.value.runId, idempotencyKey: randomUUID() }, deps("import-commit")));
    expect(committed.value).toMatchObject({ status: "PARTIALLY_COMMITTED", committed: 1, rejected: 1 });
    const draft = await client.job.findFirstOrThrow({
      where: { importDecision: { importItem: { runId: parsed.value.runId } } },
      select: { id: true, status: true, origin: true },
    });
    expect(draft).toMatchObject({ status: "DRAFT", origin: "IMPORT" });
    const rollbackInput = { runId: parsed.value.runId, idempotencyKey: randomUUID() };
    const rolledBack = requireSuccess(await rollbackImportRun(rollbackInput, deps("import-rollback")));
    expect(rolledBack.value).toMatchObject({ status: "ROLLED_BACK", rolledBack: 1, conflicts: 0 });
    expect(await client.job.findUnique({ where: { id: draft.id }, select: { status: true } })).toEqual({ status: "REMOVED" });
    expect(await rollbackImportRun(rollbackInput, deps("import-rollback"))).toMatchObject({ ok: true, replay: true });
    expect(await client.jobStatusEvent.count({ where: { jobId: draft.id, kind: "IMPORT_ROLLED_BACK" } })).toBe(1);
    const importAuditActions = await client.auditLog.findMany({
      where: {
        targetId: { in: [parsed.value.runId, okItem.id, errorItem.id] },
        action: {
          in: [
            "IMPORT_PARSED",
            "IMPORT_DECISION_RECORDED",
            "IMPORT_COMMITTED",
            "IMPORT_ROLLED_BACK",
          ],
        },
      },
      select: { action: true },
    });
    expect(
      importAuditActions.map(({ action }) => action).sort(),
    ).toEqual([
      "IMPORT_COMMITTED",
      "IMPORT_DECISION_RECORDED",
      "IMPORT_DECISION_RECORDED",
      "IMPORT_PARSED",
      "IMPORT_ROLLED_BACK",
    ]);
    expect(await client.auditLog.count({ where: { targetId: parsed.value.runId, action: "IMPORT_ROLLED_BACK" } })).toBe(1);
  });

  it("rejects a multibyte import payload whose UTF-8 byte size exceeds the bound", async () => {
    const source = await db().importSource.findFirstOrThrow({ where: { sourceReference: "local-demo-feed-v1", isActive: true }, select: { id: true } });
    const payload = JSON.stringify([{ id: "oversize-001", title: "ü".repeat(400_000) }]);
    expect(payload.length).toBeLessThan(750_000);
    expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(750_000);
    await expect(parseLicensedImport({ importSourceId: source.id, inputSource: "PASTE", format: "JSON", payload, idempotencyKey: randomUUID() }, deps("oversize-import"))).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("denies commit without partial effects when source rights disappear after approval", async () => {
    const client = db();
    const source = await client.importSource.findFirstOrThrow({
      where: { sourceReference: "local-demo-feed-v1", isActive: true },
      select: {
        id: true,
        companyRights: {
          where: { revokedAt: null },
          orderBy: { id: "asc" },
          take: 1,
          select: { id: true, companyId: true },
        },
      },
    });
    const right = source.companyRights[0];
    if (right === undefined) throw new Error("Licensed import right missing.");
    const base = JSON.parse(
      ADMIN_IMPORT_DEMO_FIXTURES.validJson,
    ) as Array<Record<string, unknown>>;
    const first = base[0];
    if (first === undefined) throw new Error("Import fixture missing.");
    const parsed = requireSuccess(
      await parseLicensedImport(
        {
          importSourceId: source.id,
          inputSource: "PASTE",
          format: "JSON",
          payload: JSON.stringify([
            {
              ...first,
              id: "rights-lost-before-commit-001",
              title: "Import ohne fortbestehendes Quellenrecht",
            },
          ]),
          idempotencyKey: randomUUID(),
        },
        deps("rights-lost-import-parse"),
      ),
    );
    const item = await client.importItem.findFirstOrThrow({
      where: { runId: parsed.value.runId },
      select: { id: true },
    });
    requireSuccess(
      await decideImportItem(
        {
          itemId: item.id,
          decision: "APPROVE",
          companyId: right.companyId,
          reasonCode: "SOURCE_RIGHTS_VERIFIED",
          idempotencyKey: randomUUID(),
        },
        deps("rights-lost-import-approve", afterMilliseconds(1)),
      ),
    );
    const stateBeforeCommit = await client.importRun.findUniqueOrThrow({
      where: { id: parsed.value.runId },
      select: {
        status: true,
        completedAt: true,
        items: {
          select: {
            id: true,
            status: true,
            redactedErrorSummary: true,
            decision: {
              select: {
                id: true,
                kind: true,
                selectedCompanyId: true,
                committedJobId: true,
              },
            },
          },
        },
      },
    });

    await client.importSourceCompanyRight.update({
      where: { id: right.id },
      data: { revokedAt: afterMilliseconds(2) },
    });
    try {
      await expect(
        commitImportRun(
          {
            runId: parsed.value.runId,
            idempotencyKey: randomUUID(),
          },
          deps("rights-lost-import-commit", afterMilliseconds(3)),
        ),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
      await expect(
        client.job.count({
          where: {
            importDecision: {
              importItem: { runId: parsed.value.runId },
            },
          },
        }),
      ).resolves.toBe(0);
      await expect(
        client.importRun.findUniqueOrThrow({
          where: { id: parsed.value.runId },
          select: {
            status: true,
            completedAt: true,
            items: {
              select: {
                id: true,
                status: true,
                redactedErrorSummary: true,
                decision: {
                  select: {
                    id: true,
                    kind: true,
                    selectedCompanyId: true,
                    committedJobId: true,
                  },
                },
              },
            },
          },
        }),
      ).resolves.toEqual(stateBeforeCommit);
      await expect(
        client.auditLog.count({
          where: {
            targetId: parsed.value.runId,
            action: "IMPORT_COMMITTED",
          },
        }),
      ).resolves.toBe(0);
    } finally {
      await client.importSourceCompanyRight.update({
        where: { id: right.id },
        data: { revokedAt: null },
      });
    }
  });

  it("approves and revokes an Import Setup with persisted audit evidence", async () => {
    const client = db();
    const source = await client.importSource.findFirstOrThrow({
      where: {
        isActive: true,
        companyRights: { some: { revokedAt: null } },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        companyRights: {
          where: { revokedAt: null },
          orderBy: { id: "asc" },
          take: 1,
          select: { companyId: true },
        },
      },
    });
    const companyId = source.companyRights[0]?.companyId;
    if (companyId === undefined) throw new Error("Import setup Company missing.");
    const approved = requireSuccess(
      await approveImportSetup(
        {
          companyId,
          importSourceId: source.id,
          rightsEvidence: "Lizenzrecht und Quelle wurden manuell geprüft.",
          mappingEvidence: "Das Feldmapping wurde gegen die Vorschau geprüft.",
          validUntil: new Date(NOW.getTime() + 10 * 86_400_000),
          reasonCode: "SOURCE_RIGHTS_VERIFIED",
          idempotencyKey: randomUUID(),
        },
        deps("import-setup-approve"),
      ),
    );
    requireSuccess(
      await revokeImportSetup(
        {
          approvalId: approved.value.approvalId,
          reasonCode: "SOURCE_RIGHTS_REVOKED",
          idempotencyKey: randomUUID(),
        },
        deps("import-setup-revoke", afterMilliseconds(1)),
      ),
    );
    await expect(
      client.auditLog.findMany({
        where: {
          targetId: source.id,
          companyId,
          action: { in: ["IMPORT_SETUP_APPROVED", "IMPORT_SETUP_REVOKED"] },
        },
        orderBy: { createdAt: "asc" },
        select: { action: true, targetType: true },
      }),
    ).resolves.toEqual([
      { action: "IMPORT_SETUP_APPROVED", targetType: "IMPORT_SOURCE" },
      { action: "IMPORT_SETUP_REVOKED", targetType: "IMPORT_SOURCE" },
    ]);
  });

  it("keeps a manually edited imported Draft intact during a mixed, idempotent rollback", async () => {
    const client = db();
    const source = await client.importSource.findFirstOrThrow({
      where: { sourceReference: "local-demo-feed-v1", isActive: true },
      select: { id: true, companyRights: { where: { revokedAt: null }, take: 1, select: { companyId: true } } },
    });
    const companyId = source.companyRights[0]?.companyId;
    if (companyId === undefined) throw new Error("Licensed import right missing.");
    const base = JSON.parse(ADMIN_IMPORT_DEMO_FIXTURES.validJson) as Array<Record<string, unknown>>;
    const first = base[0];
    if (first === undefined) throw new Error("Import fixture missing.");
    const payload = JSON.stringify([
      { ...first, id: "mixed-pristine-001", title: "Pristiner Importentwurf" },
      { ...first, id: "mixed-edited-002", title: "Manuell bearbeiteter Importentwurf" },
    ]);
    const parsed = requireSuccess(await parseLicensedImport({ importSourceId: source.id, inputSource: "PASTE", format: "JSON", payload, idempotencyKey: randomUUID() }, deps("mixed-import-parse")));
    const items = await client.importItem.findMany({ where: { runId: parsed.value.runId }, orderBy: { sourceItemKey: "asc" }, select: { id: true } });
    expect(items).toHaveLength(2);
    for (const item of items) {
      requireSuccess(await decideImportItem({ itemId: item.id, decision: "APPROVE", companyId, reasonCode: "SOURCE_RIGHTS_VERIFIED", idempotencyKey: randomUUID() }, deps(`mixed-decision-${item.id}`)));
    }
    requireSuccess(await commitImportRun({ runId: parsed.value.runId, idempotencyKey: randomUUID() }, deps("mixed-import-commit")));
    const jobs = await client.job.findMany({
      where: { importDecision: { importItem: { runId: parsed.value.runId } } },
      orderBy: { sourceReference: "asc" },
      select: { id: true, sourceReference: true, currentRevisionId: true },
    });
    const pristine = jobs.find(({ sourceReference }) => sourceReference === "mixed-pristine-001");
    const edited = jobs.find(({ sourceReference }) => sourceReference === "mixed-edited-002");
    if (pristine === undefined) throw new Error("Pristine import Job missing.");
    if (edited?.currentRevisionId === null || edited?.currentRevisionId === undefined) throw new Error("Edited import Job missing.");
    await client.jobRevision.update({ where: { id: edited.currentRevisionId }, data: { description: "Manuell geprüfter und geänderter Inhalt.", contentChecksum: "f".repeat(64), version: { increment: 1 } } });
    const jobBeforeRollback = await client.job.findUniqueOrThrow({
      where: { id: edited.id },
      select: {
        id: true,
        status: true,
        version: true,
        currentRevisionId: true,
        publishedRevisionId: true,
        currentRevision: {
          select: {
            id: true,
            title: true,
            description: true,
            contentChecksum: true,
            version: true,
          },
        },
        statusEvents: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            kind: true,
            fromStatus: true,
            toStatus: true,
            reasonCode: true,
            idempotencyKey: true,
          },
        },
      },
    });
    const evidenceBeforeRollback = await client.importDecision.findFirstOrThrow({
      where: { committedJobId: edited.id },
      select: {
        id: true,
        kind: true,
        selectedCompanyId: true,
        reasonCode: true,
        committedJobId: true,
        idempotencyKey: true,
        importItem: {
          select: {
            id: true,
            sourceItemKey: true,
            normalizedPreview: true,
            normalizedChecksum: true,
            dedupeKey: true,
            validationSummary: true,
          },
        },
      },
    });
    const rollbackInput = { runId: parsed.value.runId, idempotencyKey: randomUUID() };
    const result = requireSuccess(await rollbackImportRun(rollbackInput, deps("mixed-import-rollback")));
    expect(result.value).toMatchObject({ status: "PARTIALLY_ROLLED_BACK", rolledBack: 1, conflicts: 1 });
    await expect(
      client.job.findUniqueOrThrow({
        where: { id: edited.id },
        select: {
          id: true,
          status: true,
          version: true,
          currentRevisionId: true,
          publishedRevisionId: true,
          currentRevision: {
            select: {
              id: true,
              title: true,
              description: true,
              contentChecksum: true,
              version: true,
            },
          },
          statusEvents: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              kind: true,
              fromStatus: true,
              toStatus: true,
              reasonCode: true,
              idempotencyKey: true,
            },
          },
        },
      }),
    ).resolves.toEqual(jobBeforeRollback);
    await expect(
      client.importDecision.findFirstOrThrow({
        where: { committedJobId: edited.id },
        select: {
          id: true,
          kind: true,
          selectedCompanyId: true,
          reasonCode: true,
          committedJobId: true,
          idempotencyKey: true,
          importItem: {
            select: {
              id: true,
              sourceItemKey: true,
              normalizedPreview: true,
              normalizedChecksum: true,
              dedupeKey: true,
              validationSummary: true,
            },
          },
        },
      }),
    ).resolves.toEqual(evidenceBeforeRollback);
    await expect(
      client.importItem.findFirstOrThrow({
        where: { decision: { committedJobId: edited.id } },
        select: { status: true, redactedErrorSummary: true },
      }),
    ).resolves.toEqual({
      status: "CONFLICT_MANUAL_REMEDIATION",
      redactedErrorSummary:
        "Import-Entwurf wurde verändert oder bereits verwendet.",
    });
    await expect(
      client.job.findUniqueOrThrow({
        where: { id: pristine.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "REMOVED" });
    expect(await rollbackImportRun(rollbackInput, deps("mixed-import-rollback"))).toMatchObject({ ok: true, replay: true });
  });

  it("always records TRIAGED evidence and records ASSIGNED only for a real assignee", async () => {
    const client = db();
    const job = await client.job.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true },
    });

    const unassignedReportId = await createReport("JOB", job.id);
    const unassignedInput = {
      reportId: unassignedReportId,
      expectedVersion: 1,
      severity: "MEDIUM" as const,
      assigneeUserId: null,
      reasonCode: "INITIAL_TRIAGE",
      safeNote: "Sachverhalt geprüft und noch nicht zugewiesen.",
      idempotencyKey: randomUUID(),
    };
    requireSuccess(
      await triageAbuseReport(
        unassignedInput,
        deps("moderation-triage-unassigned"),
      ),
    );
    expect(
      await triageAbuseReport(
        unassignedInput,
        deps("moderation-triage-unassigned-replay"),
      ),
    ).toMatchObject({ ok: true, replay: true });
    await expect(
      client.abuseReportEvent.findMany({
        where: { abuseReportId: unassignedReportId },
        select: { kind: true },
      }),
    ).resolves.toEqual([{ kind: "TRIAGED" }]);
    await expect(
      client.abuseReport.findUniqueOrThrow({
        where: { id: unassignedReportId },
        select: { assigneeUserId: true, status: true },
      }),
    ).resolves.toEqual({ assigneeUserId: null, status: "IN_REVIEW" });

    const assignedReportId = await createReport("JOB", job.id);
    requireSuccess(
      await triageAbuseReport(
        {
          reportId: assignedReportId,
          expectedVersion: 1,
          severity: "HIGH",
          assigneeUserId: adminUserId,
          reasonCode: "INITIAL_TRIAGE",
          idempotencyKey: randomUUID(),
        },
        deps("moderation-triage-assigned"),
      ),
    );
    const assignedEvents = await client.abuseReportEvent.findMany({
      where: { abuseReportId: assignedReportId },
      select: { kind: true },
    });
    expect(assignedEvents).toHaveLength(2);
    expect(assignedEvents).toEqual(
      expect.arrayContaining([{ kind: "TRIAGED" }, { kind: "ASSIGNED" }]),
    );
    await expect(
      client.auditLog.count({
        where: {
          action: "ABUSE_REPORT_TRIAGED",
          targetId: { in: [unassignedReportId, assignedReportId] },
        },
      }),
    ).resolves.toBe(2);
    requireSuccess(
      await resolveAbuseReport(
        {
          reportId: assignedReportId,
          expectedVersion: 2,
          resolutionCode: "REVIEW_COMPLETED",
          idempotencyKey: randomUUID(),
        },
        deps("moderation-resolve-assigned"),
      ),
    );
    await expect(
      client.auditLog.findFirstOrThrow({
        where: {
          action: "ABUSE_REPORT_RESOLVED",
          targetId: assignedReportId,
        },
        select: { targetType: true, result: true },
      }),
    ).resolves.toEqual({
      targetType: "ABUSE_REPORT",
      result: "SUCCEEDED",
    });
  });

  it("applies, lifts and expires every typed restriction without automatic restoration", async () => {
    const client = db();

    const hiddenJob = await client.job.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true, status: true } });
    const hideReportId = await createReport("JOB", hiddenJob.id);
    const hideInput = { reportId: hideReportId, expectedReportVersion: 1, restrictionType: "HIDE_JOB", affectedResourceId: hiddenJob.id, impactConfirmed: true, reason: "Job wird bis zur Prüfung aus öffentlichen Ergebnissen verborgen.", idempotencyKey: randomUUID() } as const;
    const hidden = requireSuccess(await applyModerationRestriction(hideInput, deps("moderation-hide")));
    expect(await applyModerationRestriction(hideInput, deps("moderation-hide"))).toMatchObject({ ok: true, replay: true });
    expect(await client.auditLog.count({ where: { action: "JOB_FLAGGED", targetId: hiddenJob.id } })).toBe(1);
    const liftHideInput = { restrictionId: hidden.value.restrictionId, reasonCode: "CONTENT_REVIEW_COMPLETED", idempotencyKey: randomUUID() };
    requireSuccess(await liftModerationRestriction(liftHideInput, deps("moderation-hide-lift")));
    expect(await liftModerationRestriction(liftHideInput, deps("moderation-hide-lift"))).toMatchObject({ ok: true, replay: true });
    expect(await client.job.findUnique({ where: { id: hiddenJob.id }, select: { status: true } })).toEqual({ status: hiddenJob.status });

    const mismatchReportId = await createReport("JOB", hiddenJob.id);
    const mismatch = await applyModerationRestriction({ ...hideInput, reportId: mismatchReportId, affectedResourceId: randomUUID(), idempotencyKey: randomUUID() }, deps("moderation-mismatch"));
    expect(mismatch).toEqual({ ok: false, code: "CONFLICT" });

    const company = await client.company.findFirstOrThrow({ where: { status: "ACTIVE", jobs: { some: { status: "PUBLISHED" } } }, orderBy: { id: "desc" }, select: { id: true } });
    const companyReportId = await createReport("COMPANY", company.id);
    const paused = requireSuccess(await applyModerationRestriction({ reportId: companyReportId, expectedReportVersion: 1, restrictionType: "PAUSE_COMPANY", affectedResourceId: company.id, impactConfirmed: true, reason: "Firma wird wegen bestätigtem Risiko pausiert.", idempotencyKey: randomUUID() }, deps("moderation-company")));
    requireSuccess(await liftModerationRestriction({ restrictionId: paused.value.restrictionId, reasonCode: "RESTRICTION_REVIEW_COMPLETED", idempotencyKey: randomUUID() }, deps("moderation-company-lift")));
    expect(await client.company.findUnique({ where: { id: company.id }, select: { status: true } })).toEqual({ status: "SUSPENDED" });
    expect(await client.job.count({ where: { companyId: company.id, status: "PUBLISHED" } })).toBe(0);

    const user = await client.user.findFirstOrThrow({ where: { role: "CANDIDATE", status: "ACTIVE" }, orderBy: { id: "desc" }, select: { id: true } });
    const moderatedSession = await client.session.create({ data: { userId: user.id, tokenHash: "b".repeat(64), createdAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000), absoluteExpiresAt: new Date(NOW.getTime() + 7_200_000) }, select: { id: true } });
    const userReportId = await createReport("USER", user.id);
    const suspended = requireSuccess(await applyModerationRestriction({ reportId: userReportId, expectedReportVersion: 1, restrictionType: "SUSPEND_USER", affectedResourceId: user.id, impactConfirmed: true, reason: "Benutzer wird nach bestätigter Moderationsprüfung gesperrt.", idempotencyKey: randomUUID() }, deps("moderation-user")));
    requireSuccess(await liftModerationRestriction({ restrictionId: suspended.value.restrictionId, reasonCode: "RESTRICTION_REVIEW_COMPLETED", idempotencyKey: randomUUID() }, deps("moderation-user-lift")));
    expect(await client.user.findUnique({ where: { id: user.id }, select: { status: true } })).toEqual({ status: "SUSPENDED" });
    expect(await client.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    await expect(client.session.findUniqueOrThrow({ where: { id: moderatedSession.id }, select: { revokedAt: true } })).resolves.toEqual({ revokedAt: NOW });
    await expect(client.auditLog.findFirstOrThrow({ where: { action: "SESSION_REVOKED", targetId: moderatedSession.id }, select: { targetType: true, capability: true, reasonCode: true } })).resolves.toEqual({ targetType: "SESSION", capability: "ADMIN_RESTRICTION_MANAGE", reasonCode: "MODERATION_SUSPEND_USER" });

    const message = await client.message.findFirstOrThrow({ orderBy: { id: "asc" }, select: { id: true, conversationId: true } });
    const messageReportId = await createReport("MESSAGE", message.id);
    const endsAt = new Date(NOW.getTime() + 3_600_000);
    const blocked = requireSuccess(await applyModerationRestriction({ reportId: messageReportId, expectedReportVersion: 1, restrictionType: "BLOCK_MESSAGE_THREAD", affectedResourceId: message.conversationId, impactConfirmed: true, reason: "Thread wird bis zum Ablauf für neue Nachrichten gesperrt.", endsAt, idempotencyKey: randomUUID() }, deps("moderation-thread")));
    expect(await isConversationMessageBlocked(client, message.conversationId, NOW)).toBe(true);
    requireSuccess(await expireModerationRestriction({ restrictionId: blocked.value.restrictionId, reasonCode: "RESTRICTION_WINDOW_ENDED", idempotencyKey: randomUUID() }, deps("moderation-thread-expire", endsAt)));
    expect(await isConversationMessageBlocked(client, message.conversationId, endsAt)).toBe(false);
    expect(await client.auditLog.count({ where: { action: { in: ["MODERATION_RESTRICTION_APPLIED", "MODERATION_RESTRICTION_LIFTED", "MODERATION_RESTRICTION_EXPIRED"] } } })).toBeGreaterThanOrEqual(8);
  });

  it("approves an explicit Company claim role without mutating verification state", async () => {
    const client = db();
    const claim = await client.companyClaimRequest.findFirstOrThrow({
      where: {
        status: "PENDING",
        requester: { status: "ACTIVE", role: "EMPLOYER" },
        candidateCompany: { status: { in: ["ACTIVE", "DRAFT"] } },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        candidateCompanyId: true,
        requesterEmployerUserId: true,
        candidateCompany: {
          select: {
            verificationRequests: {
              where: { supersededBy: null },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { id: true, status: true },
            },
          },
        },
      },
    });
    const verificationBefore = claim.candidateCompany.verificationRequests[0] ?? null;
    const input = {
      claimId: claim.id,
      expectedStatus: "PENDING" as const,
      approvedRole: "OWNER" as const,
      reasonCode: "MANUAL_EVIDENCE_CONFIRMED",
      evidenceRef: "evidence://phase-11/manual-review",
      idempotencyKey: randomUUID(),
    };
    await client.entitlementGrant.create({
      data: {
        id: randomUUID(),
        companyId: claim.candidateCompanyId,
        key: "SEAT_LIMIT",
        valueType: "INTEGER",
        integerValue: 1,
        integerMode: "ADD",
        reasonCode: "PHASE_11_CLAIM_TEST",
        grantedByUserId: adminUserId,
        validFrom: new Date(NOW.getTime() - 3_600_000),
        validTo: new Date(NOW.getTime() + 3_600_000),
        idempotencyKey: `phase11-claim-seat:${claim.id}`,
        createdAt: NOW,
      },
    });
    expect(requireSuccess(await approveCompanyClaim(input, deps("claim-approve"))).value.status).toBe("APPROVED");
    expect(await approveCompanyClaim(input, deps("claim-approve-replay"))).toMatchObject({ ok: true, replay: true });
    expect(await client.companyMembership.findUnique({
      where: { companyId_userId: { companyId: claim.candidateCompanyId, userId: claim.requesterEmployerUserId } },
      select: { role: true, status: true },
    })).toEqual({ role: "OWNER", status: "ACTIVE" });
    expect(await client.companyVerificationRequest.findFirst({
      where: { companyId: claim.candidateCompanyId, supersededBy: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true },
    })).toEqual(verificationBefore);
    expect(await client.companyClaimEvent.count({ where: { claimRequestId: claim.id, kind: "APPROVED" } })).toBe(1);
  });

  it("versions taxonomy mutations and records lead actions with safe, idempotent audit", async () => {
    const client = db();
    const taxonomyInput = {
      entityType: "SKILL" as const,
      action: "CREATE" as const,
      name: "Phase 11 Incident Response",
      sortOrder: 911,
      reasonCode: "SKILL_CREATED",
      idempotencyKey: randomUUID(),
    };
    const skill = requireSuccess(await mutateAdminTaxonomy(taxonomyInput, deps("taxonomy-create")));
    expect(await mutateAdminTaxonomy(taxonomyInput, deps("taxonomy-create-replay"))).toMatchObject({ ok: true, replay: true });
    requireSuccess(await mutateAdminTaxonomy({ entityType: "SKILL", entityId: skill.value.entityId, action: "DEACTIVATE", reasonCode: "SKILL_DEACTIVATED", idempotencyKey: randomUUID() }, deps("taxonomy-deactivate")));
    expect(await client.skill.findUnique({ where: { id: skill.value.entityId }, select: { isActive: true, sortOrder: true } })).toEqual({ isActive: false, sortOrder: 911 });

    const lead = await client.salesLead.findFirstOrThrow({ where: { status: "NEW" }, orderBy: { id: "asc" }, select: { id: true, purpose: true } });
    await client.analyticsEvent.create({
      data: {
        producer: "employer-demo",
        dedupeKey: `LEAD_SUBMITTED:${randomUUID()}`,
        kind: "LEAD_SUBMITTED",
        schemaVersion: "1",
        purpose: "ESSENTIAL_OPERATIONAL",
        occurredAt: afterMilliseconds(-3_600_000),
        receivedAt: afterMilliseconds(-3_599_000),
        pseudonymousSessionId: salesLeadAnalyticsKeyV1(lead.id),
        actorProvenanceSnapshot: "DEMO",
        properties: { leadPurpose: lead.purpose },
        retainUntil: afterMilliseconds(400 * 86_400_000),
      },
    });
    requireSuccess(await manageSalesLead({ leadId: lead.id, action: "ASSIGN", ownerUserId: adminUserId, reasonCode: "OWNER_ASSIGNED", idempotencyKey: randomUUID() }, deps("lead-assign")));
    requireSuccess(await manageSalesLead({ leadId: lead.id, action: "SET_NEXT", nextAt: new Date(NOW.getTime() + 86_400_000), reasonCode: "FOLLOW_UP_SCHEDULED", idempotencyKey: randomUUID() }, deps("lead-next")));
    const statusKey = randomUUID();
    const statusInput = { leadId: lead.id, action: "STATUS" as const, status: "CONTACTED" as const, reasonCode: "FIRST_CONTACT_COMPLETED", idempotencyKey: statusKey };
    requireSuccess(await manageSalesLead(statusInput, deps("lead-contacted")));
    expect(await manageSalesLead(statusInput, deps("lead-contacted-replay"))).toMatchObject({ ok: true, replay: true });
    requireSuccess(await manageSalesLead({ leadId: lead.id, action: "STATUS", status: "QUALIFIED", reasonCode: "LEAD_QUALIFIED", idempotencyKey: randomUUID() }, deps("lead-qualified", afterMilliseconds(21))));
    requireSuccess(await manageSalesLead({ leadId: lead.id, action: "STATUS", status: "WON", reasonCode: "LEAD_WON", idempotencyKey: randomUUID() }, deps("lead-won", afterMilliseconds(22))));
    requireSuccess(await manageSalesLead({ leadId: lead.id, action: "NOTE", safeNote: "Sicherer Vermerk <script>ohne Ausführung</script>", reasonCode: "FOLLOW_UP_NOTE", idempotencyKey: randomUUID() }, deps("lead-note")));
    expect(await client.salesActivity.count({ where: { salesLeadId: lead.id } })).toBeGreaterThanOrEqual(4);
    expect((await client.salesActivity.findFirstOrThrow({ where: { salesLeadId: lead.id, kind: "NOTE" }, orderBy: { createdAt: "desc" }, select: { safeNote: true } })).safeNote).not.toContain("<script>");
    await expect(client.salesLead.findUniqueOrThrow({
      where: { id: lead.id },
      select: { status: true, nextAt: true },
    })).resolves.toEqual({ status: "WON", nextAt: null });
    await expect(client.analyticsEvent.findMany({
      where: {
        producer: "admin-sales-lead",
        pseudonymousSessionId: salesLeadAnalyticsKeyV1(lead.id),
      },
      orderBy: [{ occurredAt: "asc" }, { kind: "asc" }],
      select: {
        kind: true,
        actorProvenanceSnapshot: true,
        companyProvenanceSnapshot: true,
        jobProvenanceSnapshot: true,
        properties: true,
      },
    })).resolves.toEqual([
      {
        kind: "LEAD_QUALIFIED",
        actorProvenanceSnapshot: "DEMO",
        companyProvenanceSnapshot: "DEMO",
        jobProvenanceSnapshot: null,
        properties: { leadPurpose: lead.purpose },
      },
      {
        kind: "LEAD_WON",
        actorProvenanceSnapshot: "DEMO",
        companyProvenanceSnapshot: "DEMO",
        jobProvenanceSnapshot: null,
        properties: { leadPurpose: lead.purpose },
      },
    ]);
    await expect(
      client.auditLog.findMany({
        where: {
          OR: [
            { action: "TAXONOMY_CHANGED", targetId: skill.value.entityId },
            { action: "LEAD_STATUS_CHANGED", targetId: lead.id },
          ],
        },
        select: { action: true, targetId: true },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        { action: "TAXONOMY_CHANGED", targetId: skill.value.entityId },
        { action: "LEAD_STATUS_CHANGED", targetId: lead.id },
      ]),
    );
  });

  it("projects each SLA threshold once and exposes a privacy-safe evidence cockpit", async () => {
    const client = db();
    const before = await client.systemTask.count({ where: { policyVersion: "OPS_CASE_SLA_POLICY_V1" } });
    const input = { idempotencyKey: randomUUID() };
    const first = requireSuccess(await projectAdminSlaAlerts(input, deps("sla-project", new Date(NOW.getTime() + 10 * 86_400_000))));
    expect(first.value.projected).toBeGreaterThan(0);
    const afterFirst = await client.systemTask.count({ where: { policyVersion: "OPS_CASE_SLA_POLICY_V1" } });
    const second = requireSuccess(await projectAdminSlaAlerts(input, deps("sla-project-retry", new Date(NOW.getTime() + 10 * 86_400_000))));
    expect(second.value.projected).toBe(0);
    expect(await client.systemTask.count({ where: { policyVersion: "OPS_CASE_SLA_POLICY_V1" } })).toBe(afterFirst);
    expect(afterFirst).toBeGreaterThan(before);
    const cockpit = await getBusinessCockpit(deps("cockpit-read"));
    expect(cockpit?.policyVersion).toBe("COCKPIT_SIGNAL_POLICY_V1");
    expect(cockpit?.privacySafeRadarAggregates).toBeNull();
    expect(cockpit?.signals.length).toBeGreaterThan(0);
    expect(cockpit?.signals.every((signal) => signal.evidence.length > 0 && signal.suggestedAction.length > 0)).toBe(true);
    expect(cockpit?.demandOverview).toBeDefined();
  });

  it("seeds a reachable Cluster assessment and proves dual approval, LIVE activation and revoke", async () => {
    const client = db();
    const seeded = await client.clusterLaunchAssessment.findFirstOrThrow({ where: { dataProvenance: "DEMO", policyVersion: "CLUSTER_LAUNCH_POLICY_V1" }, orderBy: { id: "asc" }, select: { cantonId: true, categoryId: true, status: true } });
    expect(seeded.status).toBe("DRAFT");
    const assessment = await client.clusterLaunchAssessment.create({ data: {
      id: randomUUID(), cantonId: seeded.cantonId, categoryId: seeded.categoryId, policyVersion: "CLUSTER_LAUNCH_POLICY_V1", evaluatedAt: new Date(NOW.getTime() - 3_600_000), evidenceWindowStart: new Date(NOW.getTime() - 30 * 86_400_000), evidenceWindowEnd: NOW, liveJobCount: 50, activeCandidateCount: 200, activeEmployerCount: 15, responseRateBasisPoints: 7000, contentCoverageBasisPoints: 8000, medianApplicationsTimes2: 6, dataProvenance: "LIVE", evidenceHash: "a".repeat(64), validUntil: new Date(NOW.getTime() + 7 * 86_400_000), status: "READY", createdAt: NOW,
    } });
    const product = requireSuccess(await transitionClusterLaunch({ assessmentId: assessment.id, action: "PRODUCT_APPROVE", reasonCode: "PRODUCT_EVIDENCE_APPROVED", idempotencyKey: randomUUID() }, deps("cluster-product")));
    expect(product.value.status).toBe("READY");
    const ops = requireSuccess(await transitionClusterLaunch({ assessmentId: assessment.id, action: "OPS_APPROVE", reasonCode: "OPS_EVIDENCE_APPROVED", idempotencyKey: randomUUID() }, deps("cluster-ops", afterMilliseconds(1))));
    expect(ops.value.status).toBe("READY");
    const activated = requireSuccess(await transitionClusterLaunch({ assessmentId: assessment.id, action: "ACTIVATE", reasonCode: "DUAL_APPROVAL_COMPLETE", idempotencyKey: randomUUID() }, deps("cluster-activate", afterMilliseconds(2))));
    expect(activated.value.status).toBe("ACTIVATED");
    const revoked = requireSuccess(await transitionClusterLaunch({ assessmentId: assessment.id, action: "REVOKE", reasonCode: "CLUSTER_REVIEW_REQUIRED", idempotencyKey: randomUUID() }, deps("cluster-revoke", afterMilliseconds(3))));
    expect(revoked.value.status).toBe("REVOKED");
    await expect(client.clusterLaunchEvent.findMany({ where: { clusterLaunchAssessmentId: assessment.id }, orderBy: { createdAt: "asc" }, select: { kind: true } })).resolves.toEqual([{ kind: "PRODUCT_APPROVED" }, { kind: "OPS_APPROVED" }, { kind: "ACTIVATED" }, { kind: "REVOKED" }]);
    expect(await client.auditLog.count({ where: { targetId: assessment.id, action: { in: ["CLUSTER_ASSESSMENT_APPROVED", "CLUSTER_ACTIVATED", "CLUSTER_REVOKED"] } } })).toBe(4);
  });
});

function db(): DatabaseClient {
  if (database === undefined) throw new Error("Phase 11 database unavailable.");
  return database;
}

function deps(_operation: string, now = NOW) {
  return Object.freeze({
    actor: { userId: adminUserId, email: "admin@demo.ch", role: "ADMIN", status: "ACTIVE" },
    correlationId: randomUUID(),
    database: db(),
    now,
  });
}

function afterMilliseconds(milliseconds: number): Date {
  return new Date(NOW.getTime() + milliseconds);
}

async function createReport(targetType: "JOB" | "COMPANY" | "USER" | "MESSAGE", targetId: string): Promise<string> {
  const report = await db().abuseReport.create({ data: {
    id: randomUUID(),
    targetType,
    targetId,
    reporterUserId: adminUserId,
    reasonCode: "PHASE_11_TEST_REPORT",
    description: "Begrenzte Integrationstestbeschreibung ohne private Inhaltsdaten.",
    severity: "HIGH",
    status: "OPEN",
    createdAt: NOW,
    updatedAt: NOW,
    dueAt: new Date(NOW.getTime() + 4 * 3_600_000),
  } });
  return report.id;
}

function requireSuccess<T>(result: Readonly<{ ok: true; value: T } | { ok: false; code: string }>): Readonly<{ ok: true; value: T }> {
  if (!result.ok) throw new Error(`Expected success, received ${result.code}.`);
  return result;
}
