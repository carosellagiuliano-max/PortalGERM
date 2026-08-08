import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicReport } from "@/lib/abuse/public-report";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  closeCandidateFreshnessReport,
  establishPublicationFreshness,
  markEmployerJobFilled,
  projectJobFreshness,
  reconfirmEmployerJobFreshness,
  type FreshnessEmployerActor,
} from "@/lib/jobs/freshness";
import { isJobFreshnessEligibleV1 } from "@/lib/jobs/freshness-policy";
import { filterPubliclyEligibleJobsInTransaction } from "@/lib/jobs/public-eligibility";
import { buildNotificationStorageDedupeKey } from "@/lib/notifications/writer";
import { listEligibleJobSitemapRows } from "@/lib/seo/public-sitemap";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import { localPublicIntakePrivacyBinding } from "@/tests/fixtures/public-intake-privacy";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const id = (sequence: number) =>
  `30000000-0000-4000-8001-${String(sequence).padStart(12, "0")}`;
const IDS = {
  owner: id(1),
  membership: id(2),
  company: id(3),
  category: id(4),
  canton: id(5),
  city: id(6),
  exactA: id(10),
  exactARevision: id(11),
  exactB: id(12),
  exactBRevision: id(13),
  near: id(14),
  nearRevision: id(15),
  concurrentA: id(16),
  concurrentARevision: id(17),
  concurrentB: id(18),
  concurrentBRevision: id(19),
  filled: id(20),
  filledRevision: id(21),
  candidate: id(22),
  reported: id(23),
  reportedRevision: id(24),
  candidate2: id(25),
} as const;
const NOW = new Date("2026-07-29T12:00:00.000Z");
const DAY_MS = 86_400_000;
const owner: FreshnessEmployerActor = {
  userId: IDS.owner,
  membershipId: IDS.membership,
  membershipRole: "OWNER",
  companyId: IDS.company,
};
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase30_job_freshness");
  database = createDatabaseClient(migrated.connectionString);
  await seed(db());
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase 30 PostgreSQL job freshness", () => {
  it("blocks exact duplicates, queues near duplicates and serializes concurrent publication", async () => {
    const client = db();
    const first = await establish(IDS.exactA, IDS.exactARevision, {
      title: "Pflegefachperson Akutstation",
      workloadMin: 80,
    });
    expect(first).toMatchObject({ ok: true, nearDuplicateJobIds: [] });

    const exact = await establish(IDS.exactB, IDS.exactBRevision, {
      title: "Pflegefachperson Akutstation",
      workloadMin: 80,
    });
    expect(exact).toEqual({
      ok: false,
      code: "EXACT_DUPLICATE",
      duplicateJobId: IDS.exactA,
    });
    await expect(
      client.jobFreshnessProjection.findUnique({
        where: { jobId: IDS.exactB },
      }),
    ).resolves.toBeNull();

    const near = await establish(IDS.near, IDS.nearRevision, {
      title: "Pflegefachperson Akutstation",
      workloadMin: 90,
    });
    expect(near).toMatchObject({
      ok: true,
      nearDuplicateJobIds: [IDS.exactA],
    });
    await expect(
      client.systemTask.count({
        where: {
          companyId: IDS.company,
          kind: "MODERATION",
          reasonCode: "JOB_NEAR_DUPLICATE",
        },
      }),
    ).resolves.toBe(1);

    const concurrent = await Promise.all([
      establish(IDS.concurrentA, IDS.concurrentARevision, {
        title: "Einmalige Concurrent Platform Rolle",
        workloadMin: 60,
      }),
      establish(IDS.concurrentB, IDS.concurrentBRevision, {
        title: "Einmalige Concurrent Platform Rolle",
        workloadMin: 60,
      }),
    ]);
    expect(concurrent.filter(({ ok }) => ok)).toHaveLength(1);
    expect(concurrent.filter(({ ok }) => !ok)).toHaveLength(1);
    await expect(
      client.jobPublicationFingerprint.count({
        where: {
          jobId: { in: [IDS.concurrentA, IDS.concurrentB] },
          active: true,
        },
      }),
    ).resolves.toBe(1);
  });

  it("reconfirms only an owning manager and replays audit/notification/event once", async () => {
    const client = db();
    const reconfirmAt = new Date(NOW.getTime() + 10 * DAY_MS);
    const input = {
      jobId: IDS.exactA,
      expectedJobVersion: 1,
      expectedRevisionVersion: 1,
      idempotencyKey: "phase30-reconfirm-once",
    };
    const dependencies = {
      actor: owner,
      correlationId: id(100),
      database: client,
      now: reconfirmAt,
    };
    const first = await reconfirmEmployerJobFreshness(input, dependencies);
    const replay = await reconfirmEmployerJobFreshness(input, dependencies);
    expect(first).toMatchObject({
      ok: true,
      jobId: IDS.exactA,
      state: "ACTIVE",
      dueAt: new Date(reconfirmAt.getTime() + 30 * DAY_MS),
    });
    expect(replay).toMatchObject({ ok: true, replay: true });
    await expect(
      reconfirmEmployerJobFreshness(
        {
          ...input,
          jobId: IDS.near,
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      reconfirmEmployerJobFreshness(input, {
        ...dependencies,
        actor: {
          ...owner,
          membershipId: id(901),
          companyId: id(902),
        },
      }),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      client.jobFreshnessEvent.count({
        where: { jobId: IDS.exactA, kind: "RECONFIRMED" },
      }),
    ).resolves.toBe(1);
    await expect(
      client.auditLog.count({
        where: { targetId: IDS.exactA, action: "JOB_FRESHNESS_CONFIRMED" },
      }),
    ).resolves.toBe(1);
    await expect(
      client.notification.count({
        where: { recipientUserId: IDS.owner, kind: "JOB_FRESHNESS_CHANGED" },
      }),
    ).resolves.toBe(1);

    await expect(
      reconfirmEmployerJobFreshness(
        {
          ...input,
          idempotencyKey: "phase30-recruiter-denied",
        },
        {
          ...dependencies,
          actor: { ...owner, membershipRole: "RECRUITER" },
        },
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("sends boundary reminders once and removes the job at the due instant", async () => {
    const client = db();
    const dueAt = new Date(NOW.getTime() + 30 * DAY_MS);
    const reminder7At = new Date(dueAt.getTime() - 7 * DAY_MS);
    const reminder24At = new Date(dueAt.getTime() - DAY_MS);

    await projectJobFreshness({
      database: client,
      correlationId: id(101),
      now: new Date(reminder7At.getTime() - 1),
    });
    await expect(
      client.jobFreshnessEvent.count({
        where: { jobId: IDS.near, kind: "REMINDER_7D" },
      }),
    ).resolves.toBe(0);

    await projectJobFreshness({
      database: client,
      correlationId: id(102),
      now: reminder7At,
    });
    await projectJobFreshness({
      database: client,
      correlationId: id(103),
      now: reminder7At,
    });
    await expect(
      client.jobFreshnessEvent.count({
        where: { jobId: IDS.near, kind: "REMINDER_7D" },
      }),
    ).resolves.toBe(1);

    await projectJobFreshness({
      database: client,
      correlationId: id(104),
      now: reminder24At,
    });
    await expect(
      client.jobFreshnessEvent.count({
        where: { jobId: IDS.near, kind: "REMINDER_24H" },
      }),
    ).resolves.toBe(1);

    const beforeDue = await client.jobFreshnessProjection.findUniqueOrThrow({
      where: { jobId: IDS.near },
    });
    expect(
      isJobFreshnessEligibleV1(beforeDue, new Date(dueAt.getTime() - 1)),
    ).toBe(true);
    await expect(
      client.$transaction((transaction) =>
        filterPubliclyEligibleJobsInTransaction(
          [IDS.near],
          new Date(dueAt.getTime() - 1),
          "production",
          transaction,
        ),
      ),
    ).resolves.toEqual([expect.objectContaining({ id: IDS.near })]);
    expect(
      (
        await listEligibleJobSitemapRows(
          new Date(dueAt.getTime() - 1),
          client,
          100,
        )
      ).map(({ path }) => path),
    ).toContain("/jobs/phase-30-freshness-job-3");
    await projectJobFreshness({
      database: client,
      correlationId: id(105),
      now: dueAt,
    });
    const atDue = await client.jobFreshnessProjection.findUniqueOrThrow({
      where: { jobId: IDS.near },
    });
    expect(atDue.state).toBe("STALE");
    expect(isJobFreshnessEligibleV1(atDue, dueAt)).toBe(false);
    await expect(
      client.$transaction((transaction) =>
        filterPubliclyEligibleJobsInTransaction(
          [IDS.near],
          dueAt,
          "production",
          transaction,
        ),
      ),
    ).resolves.toEqual([]);
    expect(
      (await listEligibleJobSitemapRows(dueAt, client, 100)).map(
        ({ path }) => path,
      ),
    ).not.toContain("/jobs/phase-30-freshness-job-3");
    await expect(
      client.jobFreshnessEvent.count({
        where: { jobId: IDS.near, kind: "DUE" },
      }),
    ).resolves.toBe(1);
    await expect(
      client.auditLog.count({
        where: {
          targetId: IDS.near,
          action: "JOB_FRESHNESS_HELD",
          reasonCode: "RECONFIRMATION_DUE",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      client.notification.count({
        where: {
          recipientUserId: IDS.owner,
          kind: "JOB_FRESHNESS_CHANGED",
          dedupeKey: buildNotificationStorageDedupeKey({
            recipientUserId: IDS.owner,
            kind: "JOB_FRESHNESS_CHANGED",
            dedupeKey: `freshness:due:${IDS.near}:${dueAt.toISOString()}`,
          }),
        },
      }),
    ).resolves.toBe(1);
  });

  it("marks a filled position closed immediately and deactivates its duplicate fingerprint", async () => {
    const client = db();
    await establish(IDS.filled, IDS.filledRevision, {
      title: "Abgeschlossene Data Engineer Rolle",
      workloadMin: 100,
    });
    const input = {
      jobId: IDS.filled,
      expectedJobVersion: 1,
      expectedRevisionVersion: 1,
      idempotencyKey: "phase30-filled-once",
    };
    const dependencies = {
      actor: owner,
      correlationId: id(106),
      database: client,
      now: new Date(NOW.getTime() + DAY_MS),
    };
    const first = await markEmployerJobFilled(input, dependencies);
    const replay = await markEmployerJobFilled(input, dependencies);
    expect(first).toMatchObject({
      ok: true,
      jobVersion: 2,
      state: "FILLED",
    });
    expect(replay).toMatchObject({ ok: true, replay: true });
    await expect(
      client.job.findUniqueOrThrow({
        where: { id: IDS.filled },
        select: { status: true, version: true },
      }),
    ).resolves.toEqual({ status: "CLOSED", version: 2 });
    await expect(
      client.jobPublicationFingerprint.findUniqueOrThrow({
        where: { jobId: IDS.filled },
        select: { active: true },
      }),
    ).resolves.toEqual({ active: false });
    await expect(
      client.auditLog.count({
        where: { targetId: IDS.filled, action: "JOB_MARKED_FILLED" },
      }),
    ).resolves.toBe(1);
  });

  it("prioritizes an authenticated Candidate report and holds the job at the four-hour SLA", async () => {
    const client = db();
    await establish(IDS.reported, IDS.reportedRevision, {
      title: "Gemeldete offene Stelle",
      workloadMin: 70,
    });
    const reportAt = new Date(NOW.getTime() + 2 * DAY_MS);
    const report = await createPublicReport(
      {
        targetType: "JOB",
        slug: "phase-30-freshness-job-7",
        reasonCode: "OUTDATED",
        description:
          "Die Stelle ist laut bestätigter Arbeitgeberauskunft bereits besetzt.",
      },
      {
        id: IDS.reported,
        targetType: "JOB",
        companyId: IDS.company,
      },
      {
        database: client,
        environment: parseEnvironment(createValidEnvironment()),
        request: requestContext(id(107), "198.51.100.30"),
        currentUser: {
          id: IDS.candidate,
          email: "phase30-candidate@example.ch",
          role: "CANDIDATE",
          name: "Candidate Report",
          status: "ACTIVE",
          emailVerifiedAt: NOW,
          emailAddressEpoch: 1,
          identityAssurance: "VERIFIED_EMAIL",
        },
        now: reportAt,
        privacyBinding: localPublicIntakePrivacyBinding("ABUSE_REPORT"),
      },
    );
    expect(report).toMatchObject({ ok: true });
    if (!report.ok) throw new Error("Expected Candidate report creation.");

    const duplicateReporterSubmission = await createPublicReport(
      {
        targetType: "JOB",
        slug: "phase-30-freshness-job-7",
        reasonCode: "OUTDATED",
        description:
          "Dieselbe Person ergänzt denselben Aktualitätsbefund ohne eine zweite Freshness-Aufgabe.",
      },
      {
        id: IDS.reported,
        targetType: "JOB",
        companyId: IDS.company,
      },
      {
        database: client,
        environment: parseEnvironment(createValidEnvironment()),
        request: requestContext(id(110), "198.51.100.31"),
        currentUser: {
          id: IDS.candidate,
          email: "phase30-candidate@example.ch",
          role: "CANDIDATE",
          name: "Candidate Report",
          status: "ACTIVE",
          emailVerifiedAt: NOW,
          emailAddressEpoch: 1,
          identityAssurance: "VERIFIED_EMAIL",
        },
        now: reportAt,
        privacyBinding: localPublicIntakePrivacyBinding("ABUSE_REPORT"),
      },
    );
    expect(duplicateReporterSubmission).toMatchObject({ ok: true });
    await expect(
      client.jobFreshnessReport.count({
        where: {
          jobId: IDS.reported,
          reporterUserId: IDS.candidate,
          status: { in: ["OPEN", "HELD"] },
        },
      }),
    ).resolves.toBe(1);

    const secondReport = await createPublicReport(
      {
        targetType: "JOB",
        slug: "phase-30-freshness-job-7",
        reasonCode: "OUTDATED",
        description:
          "Eine zweite authentifizierte Person meldet denselben Aktualitätsbefund.",
      },
      {
        id: IDS.reported,
        targetType: "JOB",
        companyId: IDS.company,
      },
      {
        database: client,
        environment: parseEnvironment(createValidEnvironment()),
        request: requestContext(id(111), "198.51.100.32"),
        currentUser: {
          id: IDS.candidate2,
          email: "phase30-candidate2@example.ch",
          role: "CANDIDATE",
          name: "Second Candidate Report",
          status: "ACTIVE",
          emailVerifiedAt: NOW,
          emailAddressEpoch: 1,
          identityAssurance: "VERIFIED_EMAIL",
        },
        now: reportAt,
        privacyBinding: localPublicIntakePrivacyBinding("ABUSE_REPORT"),
      },
    );
    expect(secondReport).toMatchObject({ ok: true });
    if (!secondReport.ok) {
      throw new Error("Expected second Candidate report creation.");
    }
    await expect(
      reconfirmEmployerJobFreshness(
        {
          jobId: IDS.reported,
          expectedJobVersion: 1,
          expectedRevisionVersion: 1,
          idempotencyKey: "phase30-pending-report-reconfirm",
        },
        {
          actor: owner,
          correlationId: id(113),
          database: client,
          now: new Date(reportAt.getTime() + 30_000),
        },
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });

    await client.$transaction((transaction) =>
      closeCandidateFreshnessReport(transaction, {
        abuseReportId: report.reportId,
        status: "DISMISSED",
        actorUserId: IDS.owner,
        correlationId: id(112),
        now: new Date(reportAt.getTime() + 60_000),
      }),
    );
    await expect(
      client.jobFreshnessProjection.findUniqueOrThrow({
        where: { jobId: IDS.reported },
        select: { state: true },
      }),
    ).resolves.toEqual({ state: "REVIEW_PENDING" });

    const persisted = await client.abuseReport.findUniqueOrThrow({
      where: { id: report.reportId },
      select: { severity: true, dueAt: true },
    });
    const reviewDueAt = new Date(reportAt.getTime() + 4 * 60 * 60_000);
    expect(persisted).toEqual({ severity: "HIGH", dueAt: reviewDueAt });
    await expect(
      client.jobFreshnessReport.findUniqueOrThrow({
        where: { abuseReportId: report.reportId },
        select: {
          reporterUserId: true,
          status: true,
          reviewDueAt: true,
        },
      }),
    ).resolves.toEqual({
      reporterUserId: IDS.candidate,
      status: "DISMISSED",
      reviewDueAt,
    });
    const beforeSla = await client.jobFreshnessProjection.findUniqueOrThrow({
      where: { jobId: IDS.reported },
    });
    expect(beforeSla.state).toBe("REVIEW_PENDING");
    expect(
      isJobFreshnessEligibleV1(beforeSla, new Date(reviewDueAt.getTime() - 1)),
    ).toBe(true);

    await projectJobFreshness({
      database: client,
      correlationId: id(108),
      now: reviewDueAt,
    });
    await projectJobFreshness({
      database: client,
      correlationId: id(109),
      now: reviewDueAt,
    });
    const held = await client.jobFreshnessProjection.findUniqueOrThrow({
      where: { jobId: IDS.reported },
    });
    expect(held.state).toBe("HOLD");
    expect(isJobFreshnessEligibleV1(held, reviewDueAt)).toBe(false);
    await expect(
      client.jobFreshnessEvent.count({
        where: { jobId: IDS.reported, kind: "REVIEW_SLA_EXCEEDED" },
      }),
    ).resolves.toBe(1);
    await expect(
      client.jobFreshnessReport.findUniqueOrThrow({
        where: { abuseReportId: secondReport.reportId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "HELD" });
    await expect(
      client.auditLog.count({
        where: {
          targetId: IDS.reported,
          action: "JOB_FRESHNESS_HELD",
          reasonCode: "REVIEW_SLA_EXCEEDED",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      client.notification.count({
        where: {
          recipientUserId: IDS.owner,
          kind: "JOB_FRESHNESS_CHANGED",
          dedupeKey: buildNotificationStorageDedupeKey({
            recipientUserId: IDS.owner,
            kind: "JOB_FRESHNESS_CHANGED",
            dedupeKey: `freshness:review-sla:${IDS.reported}:${reviewDueAt.toISOString()}`,
          }),
        },
      }),
    ).resolves.toBe(1);

    const anonymous = await createPublicReport(
      {
        targetType: "JOB",
        slug: "phase-30-freshness-job-7",
        reasonCode: "OUTDATED",
        description:
          "Anonyme Meldung ohne authentifizierten Candidate-Prioritätsstatus.",
      },
      {
        id: IDS.reported,
        targetType: "JOB",
        companyId: IDS.company,
      },
      {
        database: client,
        environment: parseEnvironment(createValidEnvironment()),
        request: requestContext(id(110), "198.51.100.31"),
        currentUser: null,
        now: reportAt,
        privacyBinding: localPublicIntakePrivacyBinding("ABUSE_REPORT"),
      },
    );
    expect(anonymous).toMatchObject({ ok: true });
    if (!anonymous.ok) throw new Error("Expected anonymous report creation.");
    await expect(
      client.abuseReport.findUniqueOrThrow({
        where: { id: anonymous.reportId },
        select: { severity: true, dueAt: true },
      }),
    ).resolves.toEqual({
      severity: "LOW",
      dueAt: new Date(reportAt.getTime() + 3 * DAY_MS),
    });
    await expect(
      client.jobFreshnessReport.count({
        where: { abuseReportId: anonymous.reportId },
      }),
    ).resolves.toBe(0);
  });
});

async function establish(
  jobId: string,
  revisionId: string,
  content: Readonly<{ title: string; workloadMin: number }>,
) {
  const client = db();
  return client.$transaction((transaction) =>
    establishPublicationFreshness(transaction, {
      jobId,
      revisionId,
      companyId: IDS.company,
      sourceScope: "manual",
      publishedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 90 * DAY_MS),
      fingerprint: fingerprint(content.title, content.workloadMin),
      correlationId: id(200),
      actorUserId: IDS.owner,
    }),
  );
}

function fingerprint(title: string, workloadMin: number) {
  return {
    title,
    description: "Verantwortung für sichere Systeme und verlässliche Abläufe.",
    tasks: ["Planung", "Dokumentation", "Qualitätssicherung"],
    requirements: ["Fachausbildung", "Deutsch B2", "Berufserfahrung"],
    offer: "Weiterbildung und faire Arbeitsbedingungen",
    categoryId: IDS.category,
    cantonId: IDS.canton,
    cityId: IDS.city,
    workloadMin,
    workloadMax: 100,
    jobType: "PERMANENT",
    remoteType: "ONSITE",
  } as const;
}

async function seed(client: DatabaseClient) {
  await client.user.create({
    data: {
      id: IDS.owner,
      email: "phase30-owner@example.ch",
      emailNormalized: "phase30-owner@example.ch",
      role: "EMPLOYER",
      status: "ACTIVE",
    },
  });
  await client.user.create({
    data: {
      id: IDS.candidate,
      email: "phase30-candidate@example.ch",
      emailNormalized: "phase30-candidate@example.ch",
      role: "CANDIDATE",
      status: "ACTIVE",
      emailVerifiedAt: NOW,
      identityAssurance: "VERIFIED_EMAIL",
    },
  });
  await client.user.create({
    data: {
      id: IDS.candidate2,
      email: "phase30-candidate2@example.ch",
      emailNormalized: "phase30-candidate2@example.ch",
      role: "CANDIDATE",
      status: "ACTIVE",
      emailVerifiedAt: NOW,
      identityAssurance: "VERIFIED_EMAIL",
    },
  });
  await client.company.create({
    data: {
      id: IDS.company,
      name: "Phase 30 Freshness AG",
      slug: "phase-30-freshness-ag",
      status: "DRAFT",
      industry: "Technology",
      size: "10-49",
      website: "https://phase30-freshness.example.test",
      about: "A complete isolated company for Phase 30 freshness tests.",
      values: [],
      benefits: [],
      dataProvenance: "LIVE",
    },
  });
  await client.companyMembership.create({
    data: {
      id: IDS.membership,
      companyId: IDS.company,
      userId: IDS.owner,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  await client.category.create({
    data: { id: IDS.category, name: "Phase 30 Jobs", slug: "phase-30-jobs" },
  });
  await client.canton.create({
    data: {
      id: IDS.canton,
      code: "ZH",
      name: "Zürich",
      slug: "phase-30-zuerich",
      language: "DE",
    },
  });
  await client.city.create({
    data: {
      id: IDS.city,
      cantonId: IDS.canton,
      name: "Zürich",
      slug: "phase-30-zuerich",
    },
  });
  await client.companyLocation.create({
    data: {
      companyId: IDS.company,
      cantonId: IDS.canton,
      cityId: IDS.city,
      isPrimary: true,
    },
  });
  await client.company.update({
    where: { id: IDS.company },
    data: { status: "ACTIVE" },
  });
  await client.companyVerificationRequest.create({
    data: {
      id: id(26),
      companyId: IDS.company,
      requestedByUserId: IDS.owner,
      status: "VERIFIED",
      evidenceMetadata: { source: "phase30-freshness-test" },
    },
  });
  for (const [jobId, revisionId, sequence] of [
    [IDS.exactA, IDS.exactARevision, 1],
    [IDS.exactB, IDS.exactBRevision, 2],
    [IDS.near, IDS.nearRevision, 3],
    [IDS.concurrentA, IDS.concurrentARevision, 4],
    [IDS.concurrentB, IDS.concurrentBRevision, 5],
    [IDS.filled, IDS.filledRevision, 6],
    [IDS.reported, IDS.reportedRevision, 7],
  ] as const) {
    await createPublishedJob(client, jobId, revisionId, sequence);
  }
}

function requestContext(
  correlationId: string,
  sourceIp: string,
): AuthRequestContext {
  return Object.freeze({
    correlationId,
    expectedOrigin: "http://127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    production: false,
    sourceIp,
    userAgent: "Phase-30 freshness PostgreSQL test",
  });
}

async function createPublishedJob(
  client: DatabaseClient,
  jobId: string,
  revisionId: string,
  sequence: number,
) {
  const validThrough = new Date(NOW.getTime() + 90 * DAY_MS);
  await client.job.create({
    data: {
      id: jobId,
      companyId: IDS.company,
      slug: `phase-30-freshness-job-${sequence}`,
      status: "DRAFT",
      sourceReference: "platform-manual",
      createdByUserId: IDS.owner,
      dataProvenance: "LIVE",
    },
  });
  await client.jobRevision.create({
    data: {
      id: revisionId,
      jobId,
      revisionNumber: 1,
      title: `Phase 30 Freshness Job ${sequence}`,
      description: "Ein vollständiges Inserat für den Freshness-Test.",
      tasks: ["Planung und Umsetzung"],
      requirements: ["Fachausbildung"],
      applicationProcessSteps: ["Online-Bewerbung"],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      categoryId: IDS.category,
      cantonId: IDS.canton,
      cityId: IDS.city,
      locationLabel: "Zürich",
      workloadMin: 80,
      workloadMax: 100,
      startByArrangement: true,
      validThrough,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@example.ch",
      authoredByUserId: IDS.owner,
      contentChecksum: String(sequence).repeat(64),
    },
  });
  await client.jobRevision.update({
    where: { id: revisionId },
    data: { submittedAt: new Date(NOW.getTime() - 2 * DAY_MS) },
  });
  await client.jobRevision.update({
    where: { id: revisionId },
    data: { approvedAt: new Date(NOW.getTime() - DAY_MS) },
  });
  await client.job.update({
    where: { id: jobId },
    data: {
      status: "PUBLISHED",
      currentRevisionId: revisionId,
      publishedRevisionId: revisionId,
      publishedAt: NOW,
      expiresAt: validThrough,
      publishedCategoryId: IDS.category,
      publishedCantonId: IDS.canton,
      publishedCityId: IDS.city,
    },
  });
}

function db(): DatabaseClient {
  if (database === undefined)
    throw new Error("Freshness database unavailable.");
  return database;
}
