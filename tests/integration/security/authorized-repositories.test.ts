import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  getAuthorizedApplication,
  getAuthorizedInvoice,
  getAuthorizedJob,
  getAuthorizedRadarRequest,
} from "@/lib/security/authorized-repositories";
import type { CompanyAccess } from "@/lib/security/company-access";
import { SafeNotFoundError } from "@/lib/security/errors";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

const id = (sequence: number) =>
  `40000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
const IDS = {
  userA: id(1),
  userB: id(2),
  candidateUser: id(3),
  companyA: id(4),
  companyB: id(5),
  category: id(6),
  canton: id(7),
  city: id(8),
  jobA: id(9),
  jobB: id(10),
  revisionA: id(11),
  revisionB: id(12),
  candidateProfile: id(13),
  applicationA: id(14),
  applicationB: id(15),
  orderA: id(16),
  orderB: id(17),
  invoiceA: id(18),
  invoiceB: id(19),
  accountA: id(20),
  accountB: id(21),
  ledgerA: id(22),
  ledgerB: id(23),
  requestA: id(24),
  requestB: id(25),
  locationA: id(26),
  locationB: id(27),
  grantA: id(28),
  grantB: id(29),
  adminUser: id(30),
  viewerUser: id(31),
  editorUser: id(32),
  pipelineUser: id(33),
  reviewerUser: id(34),
  membershipOwnerA: id(101),
  membershipOwnerB: id(102),
  membershipAdminA: id(103),
  membershipViewerA: id(104),
  membershipEditorA: id(105),
  membershipPipelineA: id(106),
  membershipReviewerA: id(107),
  assignmentEditorA: id(108),
  assignmentPipelineA: id(109),
  assignmentReviewerA: id(110),
};

const ACCESS_A: CompanyAccess = {
  companyId: IDS.companyA,
  userId: IDS.userA,
  membershipId: IDS.membershipOwnerA,
  membershipRole: "OWNER",
  companyStatus: "ACTIVE",
};
const ACCESS_B: CompanyAccess = {
  companyId: IDS.companyB,
  userId: IDS.userB,
  membershipId: IDS.membershipOwnerB,
  membershipRole: "OWNER",
  companyStatus: "ACTIVE",
};
const ADMIN_ACCESS_A: CompanyAccess = {
  companyId: IDS.companyA,
  userId: IDS.adminUser,
  membershipId: IDS.membershipAdminA,
  membershipRole: "ADMIN",
  companyStatus: "ACTIVE",
};
const VIEWER_ACCESS_A: CompanyAccess = {
  companyId: IDS.companyA,
  userId: IDS.viewerUser,
  membershipId: IDS.membershipViewerA,
  membershipRole: "VIEWER",
  companyStatus: "ACTIVE",
};
const EDITOR_ACCESS_A: CompanyAccess = {
  companyId: IDS.companyA,
  userId: IDS.editorUser,
  membershipId: IDS.membershipEditorA,
  membershipRole: "RECRUITER",
  companyStatus: "ACTIVE",
};
const PIPELINE_ACCESS_A: CompanyAccess = {
  companyId: IDS.companyA,
  userId: IDS.pipelineUser,
  membershipId: IDS.membershipPipelineA,
  membershipRole: "RECRUITER",
  companyStatus: "ACTIVE",
};
const REVIEWER_ACCESS_A: CompanyAccess = {
  companyId: IDS.companyA,
  userId: IDS.reviewerUser,
  membershipId: IDS.membershipReviewerA,
  membershipRole: "RECRUITER",
  companyStatus: "ACTIVE",
};
const NOW = new Date("2026-07-19T12:00:00.000Z");

async function seed() {
  if (!migrated) throw new Error("Migrated database unavailable.");
  const pool = migrated.pool;
  await pool.query(
    `INSERT INTO "User" ("id","email","emailNormalized","role","updatedAt") VALUES
      ($1,'owner-a@example.ch','owner-a@example.ch','EMPLOYER',now()),
      ($2,'owner-b@example.ch','owner-b@example.ch','EMPLOYER',now()),
      ($3,'candidate@example.ch','candidate@example.ch','CANDIDATE',now()),
      ($4,'admin-a@example.ch','admin-a@example.ch','EMPLOYER',now()),
      ($5,'viewer-a@example.ch','viewer-a@example.ch','EMPLOYER',now()),
      ($6,'editor-a@example.ch','editor-a@example.ch','RECRUITER',now()),
      ($7,'pipeline-a@example.ch','pipeline-a@example.ch','RECRUITER',now()),
      ($8,'reviewer-a@example.ch','reviewer-a@example.ch','RECRUITER',now())`,
    [
      IDS.userA,
      IDS.userB,
      IDS.candidateUser,
      IDS.adminUser,
      IDS.viewerUser,
      IDS.editorUser,
      IDS.pipelineUser,
      IDS.reviewerUser,
    ],
  );
  await pool.query(
    `INSERT INTO "Company" (
      "id","name","slug","values","benefits","industry","size","about","website","updatedAt"
    ) VALUES
      ($1,'Company A','company-a','{}','{}','IT','10-49','About Company A','https://a.example.ch',now()),
      ($2,'Company B','company-b','{}','{}','IT','10-49','About Company B','https://b.example.ch',now())`,
    [IDS.companyA, IDS.companyB],
  );
  await pool.query(
    `INSERT INTO "Category" ("id","name","slug","updatedAt") VALUES ($1,'Engineering','engineering',now())`,
    [IDS.category],
  );
  await pool.query(
    `INSERT INTO "Canton" ("id","code","name","slug","language","updatedAt") VALUES ($1,'ZH','Zürich','zuerich','DE',now())`,
    [IDS.canton],
  );
  await pool.query(
    `INSERT INTO "City" ("id","cantonId","name","slug","updatedAt") VALUES ($1,$2,'Zürich','zuerich',now())`,
    [IDS.city, IDS.canton],
  );
  await pool.query(
    `INSERT INTO "CompanyLocation" (
      "id","companyId","cantonId","cityId","isPrimary","updatedAt"
    ) VALUES ($1,$2,$3,$4,true,now()), ($5,$6,$3,$4,true,now())`,
    [
      IDS.locationA,
      IDS.companyA,
      IDS.canton,
      IDS.city,
      IDS.locationB,
      IDS.companyB,
    ],
  );
  await pool.query(
    `UPDATE "Company" SET "status"='ACTIVE', "updatedAt"=now() WHERE "id" IN ($1,$2)`,
    [IDS.companyA, IDS.companyB],
  );
  await pool.query(
    `INSERT INTO "CompanyMembership" ("id","companyId","userId","role","updatedAt") VALUES
      ($1,$2,$3,'OWNER',now()),
      ($4,$5,$6,'OWNER',now()),
      ($7,$2,$8,'ADMIN',now()),
      ($9,$2,$10,'VIEWER',now()),
      ($11,$2,$12,'RECRUITER',now()),
      ($13,$2,$14,'RECRUITER',now()),
      ($15,$2,$16,'RECRUITER',now())`,
    [
      IDS.membershipOwnerA,
      IDS.companyA,
      IDS.userA,
      IDS.membershipOwnerB,
      IDS.companyB,
      IDS.userB,
      IDS.membershipAdminA,
      IDS.adminUser,
      IDS.membershipViewerA,
      IDS.viewerUser,
      IDS.membershipEditorA,
      IDS.editorUser,
      IDS.membershipPipelineA,
      IDS.pipelineUser,
      IDS.membershipReviewerA,
      IDS.reviewerUser,
    ],
  );
  await pool.query(
    `INSERT INTO "Job" ("id","companyId","slug","createdByUserId","updatedAt") VALUES
      ($1,$2,'job-a',$3,now()), ($4,$5,'job-b',$6,now())`,
    [IDS.jobA, IDS.companyA, IDS.userA, IDS.jobB, IDS.companyB, IDS.userB],
  );
  await pool.query(
    `INSERT INTO "JobAssignment" (
      "id","membershipId","companyId","jobId","userId","role","assignedByUserId",
      "validFrom","expiresAt","updatedAt"
    ) VALUES
      ($1,$2,$3,$4,$5,'EDITOR',$6,'2026-07-01T00:00:00Z','2026-08-01T00:00:00Z',now()),
      ($7,$8,$3,$4,$9,'PIPELINE',$6,'2026-07-01T00:00:00Z','2026-08-01T00:00:00Z',now()),
      ($10,$11,$3,$4,$12,'REVIEWER',$6,'2026-07-01T00:00:00Z','2026-08-01T00:00:00Z',now())`,
    [
      IDS.assignmentEditorA,
      IDS.membershipEditorA,
      IDS.companyA,
      IDS.jobA,
      IDS.editorUser,
      IDS.userA,
      IDS.assignmentPipelineA,
      IDS.membershipPipelineA,
      IDS.pipelineUser,
      IDS.assignmentReviewerA,
      IDS.membershipReviewerA,
      IDS.reviewerUser,
    ],
  );
  const revisionSql = `INSERT INTO "JobRevision" (
      "id","jobId","revisionNumber","title","description","tasks","requirements",
      "applicationProcessSteps","requiredDocumentKinds","jobType","remoteType","categoryId",
      "cantonId","cityId","workloadMin","workloadMax","responseTargetDays","applicationEffort",
      "applicationContactKind","applicationContactValue","authoredByUserId","contentChecksum"
    ) VALUES ($1,$2,1,$3,'A sufficiently bounded description','{}','{}',ARRAY['Apply']::text[],
      ARRAY['NONE']::"RequiredDocumentKind"[],'PERMANENT','HYBRID',$4,$5,$6,80,100,14,'SIMPLE',
      'EMAIL','jobs@example.ch',$7,$8)`;
  await pool.query(revisionSql, [
    IDS.revisionA,
    IDS.jobA,
    "Job A",
    IDS.category,
    IDS.canton,
    IDS.city,
    IDS.userA,
    "a".repeat(64),
  ]);
  await pool.query(revisionSql, [
    IDS.revisionB,
    IDS.jobB,
    "Job B",
    IDS.category,
    IDS.canton,
    IDS.city,
    IDS.userB,
    "b".repeat(64),
  ]);
  await pool.query(
    `INSERT INTO "CandidateProfile" ("id","userId","updatedAt") VALUES ($1,$2,now())`,
    [IDS.candidateProfile, IDS.candidateUser],
  );
  await pool.query(
    `INSERT INTO "Application" (
      "id","jobId","submittedJobRevisionId","candidateProfileId","idempotencyKey",
      "submissionPayloadHash","updatedAt"
    ) VALUES
      ($1,$2,$3,$4,'authorized-application-a',$8,now()),
      ($5,$6,$7,$4,'authorized-application-b',$9,now())`,
    [
      IDS.applicationA,
      IDS.jobA,
      IDS.revisionA,
      IDS.candidateProfile,
      IDS.applicationB,
      IDS.jobB,
      IDS.revisionB,
      "a".repeat(64),
      "b".repeat(64),
    ],
  );
  const orderSql = `INSERT INTO "Order" (
      "id","companyId","createdByUserId","clientIdempotencyKey","billingLegalNameSnapshot",
      "billingContactEmailSnapshot","billingStreetSnapshot","billingPostalCodeSnapshot",
      "billingCitySnapshot","billingCountryCodeSnapshot","netTotalRappen","vatTotalRappen",
      "totalRappen","updatedAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,'Street 1','8000','Zürich','CH',100,8,108,now())`;
  await pool.query(orderSql, [
    IDS.orderA,
    IDS.companyA,
    IDS.userA,
    "order-a",
    "Company A",
    "a@example.ch",
  ]);
  await pool.query(orderSql, [
    IDS.orderB,
    IDS.companyB,
    IDS.userB,
    "order-b",
    "Company B",
    "b@example.ch",
  ]);
  const invoiceSql = `INSERT INTO "Invoice" (
      "id","orderId","companyId","number","billingLegalNameSnapshot","billingContactEmailSnapshot",
      "billingStreetSnapshot","billingPostalCodeSnapshot","billingCitySnapshot","billingCountryCodeSnapshot",
      "currency","netTotalRappen","vatTotalRappen","totalRappen","dueAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,'Street 1','8000','Zürich','CH','CHF',100,8,108,'2026-08-01T00:00:00Z')`;
  await pool.query(invoiceSql, [
    IDS.invoiceA,
    IDS.orderA,
    IDS.companyA,
    "STH-2026-00001",
    "Company A",
    "a@example.ch",
  ]);
  await pool.query(invoiceSql, [
    IDS.invoiceB,
    IDS.orderB,
    IDS.companyB,
    "STH-2026-00002",
    "Company B",
    "b@example.ch",
  ]);
  const accountSql = `INSERT INTO "CreditAccount" ("id","companyId","creditType","fundingSource","periodStart","periodEnd")
    VALUES ($1,$2,'TALENT_CONTACT','ADMIN_GRANT','2026-07-01T00:00:00Z','2026-08-01T00:00:00Z')`;
  await pool.query(accountSql, [IDS.accountA, IDS.companyA]);
  await pool.query(accountSql, [IDS.accountB, IDS.companyB]);
  const grantSql = `INSERT INTO "CreditLedgerEntry" (
      "id","accountId","fundingSource","kind","amount","validFrom","validTo","idempotencyKey","reasonCode","actorUserId"
    ) VALUES ($1,$2,'ADMIN_GRANT','GRANT',1,'2026-07-01T00:00:00Z','2026-08-01T00:00:00Z',$3,'TEST',$4)`;
  await pool.query(grantSql, [IDS.grantA, IDS.accountA, "grant-a", IDS.userA]);
  await pool.query(grantSql, [IDS.grantB, IDS.accountB, "grant-b", IDS.userB]);
  const consumeSql = `INSERT INTO "CreditLedgerEntry" (
      "id","accountId","fundingSource","kind","amount","validFrom","validTo","idempotencyKey","reasonCode","actorUserId"
    ) VALUES ($1,$2,'ADMIN_GRANT','CONSUME',-1,'2026-07-01T00:00:00Z','2026-08-01T00:00:00Z',$3,'CONTACT_REQUEST',$4)`;
  await pool.query(consumeSql, [
    IDS.ledgerA,
    IDS.accountA,
    "consume-a",
    IDS.userA,
  ]);
  await pool.query(consumeSql, [
    IDS.ledgerB,
    IDS.accountB,
    "consume-b",
    IDS.userB,
  ]);
  const requestSql = `INSERT INTO "EmployerContactRequest" (
      "id","companyId","candidateProfileId","requestingUserId","creditLedgerEntryId","messagePreview",
      "idempotencyKey","fundingSource","clusterPolicyVersion","cantonBucketSnapshot",
      "categoryBucketSnapshot","expiresAt","createdAt","updatedAt"
    ) VALUES ($1,$2,$3,$4,$5,'Bounded introduction',$6,'ADMIN_GRANT','v1','ZH','engineering',
      '2026-08-02T12:00:00Z','2026-07-19T12:00:00Z','2026-07-19T12:00:00Z')`;
  await pool.query(requestSql, [
    IDS.requestA,
    IDS.companyA,
    IDS.candidateProfile,
    IDS.userA,
    IDS.ledgerA,
    "request-a",
  ]);
  await pool.query(requestSql, [
    IDS.requestB,
    IDS.companyB,
    IDS.candidateProfile,
    IDS.userB,
    IDS.ledgerB,
    "request-b",
  ]);
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase03_authorized_repositories",
  );
  database = createDatabaseClient(migrated.connectionString);
  await seed();
});

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

function db(): DatabaseClient {
  if (!database) throw new Error("Authorized repository database unavailable.");
  return database;
}

describe("tenant-scoped first-query repositories", () => {
  it("loads own Job and hides the same Job from a foreign Company", async () => {
    await expect(
      getAuthorizedJob({ jobId: IDS.jobA, access: ACCESS_A, now: NOW }, db()),
    ).resolves.toMatchObject({ id: IDS.jobA, companyId: IDS.companyA });
    await expect(
      getAuthorizedJob({ jobId: IDS.jobA, access: ACCESS_B, now: NOW }, db()),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
  });

  it("loads own Application and makes foreign and missing IDs indistinguishable", async () => {
    await expect(
      getAuthorizedApplication(
        { applicationId: IDS.applicationA, access: ACCESS_A, now: NOW },
        db(),
      ),
    ).resolves.toMatchObject({ id: IDS.applicationA, jobId: IDS.jobA });
    const foreign = getAuthorizedApplication(
      { applicationId: IDS.applicationA, access: ACCESS_B, now: NOW },
      db(),
    );
    const missing = getAuthorizedApplication(
      { applicationId: id(999), access: ACCESS_B, now: NOW },
      db(),
    );
    await expect(foreign).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Resource not found.",
    });
    await expect(missing).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Resource not found.",
    });
  });

  it("enforces the Application identity matrix for Owner/Admin, EDITOR|PIPELINE, Viewer and REVIEWER", async () => {
    for (const access of [
      ACCESS_A,
      ADMIN_ACCESS_A,
      EDITOR_ACCESS_A,
      PIPELINE_ACCESS_A,
    ]) {
      await expect(
        getAuthorizedApplication(
          { applicationId: IDS.applicationA, access, now: NOW },
          db(),
        ),
      ).resolves.toMatchObject({
        id: IDS.applicationA,
        jobId: IDS.jobA,
        candidateProfileId: IDS.candidateProfile,
      });
    }

    for (const access of [VIEWER_ACCESS_A, REVIEWER_ACCESS_A]) {
      await expect(
        getAuthorizedApplication(
          { applicationId: IDS.applicationA, access, now: NOW },
          db(),
        ),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Resource not found.",
      });
    }
  });

  it("scopes Invoice and Radar ContactRequest in the database query", async () => {
    await expect(
      getAuthorizedInvoice({ invoiceId: IDS.invoiceA, access: ACCESS_A }, db()),
    ).resolves.toMatchObject({ id: IDS.invoiceA, number: "STH-2026-00001" });
    await expect(
      getAuthorizedInvoice({ invoiceId: IDS.invoiceA, access: ACCESS_B }, db()),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    await expect(
      getAuthorizedRadarRequest(
        { requestId: IDS.requestA, access: ACCESS_A },
        db(),
      ),
    ).resolves.toMatchObject({
      id: IDS.requestA,
      candidateProfileId: IDS.candidateProfile,
    });
    await expect(
      getAuthorizedRadarRequest(
        { requestId: IDS.requestA, access: ACCESS_B },
        db(),
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    await expect(
      getAuthorizedInvoice(
        { invoiceId: IDS.invoiceA, access: VIEWER_ACCESS_A },
        db(),
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
    await expect(
      getAuthorizedRadarRequest(
        { requestId: IDS.requestA, access: VIEWER_ACCESS_A },
        db(),
      ),
    ).rejects.toBeInstanceOf(SafeNotFoundError);
  });
});
