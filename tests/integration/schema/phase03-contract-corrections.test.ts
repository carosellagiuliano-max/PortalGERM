import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let database: MigratedDatabase | undefined;

function pool(): Pool {
  if (!database) throw new Error("Phase 03 contract database is unavailable.");
  return database.pool;
}

const IDS = {
  userA: "10000000-0000-4000-8000-000000000001",
  userB: "10000000-0000-4000-8000-000000000002",
  company: "10000000-0000-4000-8000-000000000003",
  category: "10000000-0000-4000-8000-000000000004",
  canton: "10000000-0000-4000-8000-000000000005",
  city: "10000000-0000-4000-8000-000000000006",
  job: "10000000-0000-4000-8000-000000000007",
};

type LocationScope = Readonly<{
  cantonId: string | null;
  cityId: string | null;
  remoteCountryCode: "CH" | null;
  remoteType: "HYBRID" | "ONSITE" | "REMOTE";
}>;

beforeAll(async () => {
  database = await createMigratedTestDatabase("phase03_contract_corrections");
  await pool().query(
    `INSERT INTO "User" ("id","email","emailNormalized","role","updatedAt") VALUES
      ($1,'a@example.ch','a@example.ch','EMPLOYER',now()),
      ($2,'b@example.ch','b@example.ch','EMPLOYER',now())`,
    [IDS.userA, IDS.userB],
  );
  await pool().query(
    `INSERT INTO "Company" ("id","name","slug","values","benefits","updatedAt")
       VALUES ($1,'Company A','company-a','{}','{}',now())`,
    [IDS.company],
  );
  await pool().query(
    `INSERT INTO "Category" ("id","name","slug","updatedAt") VALUES ($1,'Engineering','engineering',now())`,
    [IDS.category],
  );
  await pool().query(
    `INSERT INTO "Canton" ("id","code","name","slug","language","updatedAt")
       VALUES ($1,'ZH','Zürich','zuerich','DE',now())`,
    [IDS.canton],
  );
  await pool().query(
    `INSERT INTO "City" ("id","cantonId","name","slug","updatedAt") VALUES ($1,$2,'Zürich','zuerich',now())`,
    [IDS.city, IDS.canton],
  );
  await pool().query(
    `INSERT INTO "Job" ("id","companyId","slug","createdByUserId","updatedAt") VALUES ($1,$2,'job-a',$3,now())`,
    [IDS.job, IDS.company, IDS.userA],
  );
});

afterAll(async () => {
  await database?.dispose();
});

async function insertAndPublishLocationJob(
  input: LocationScope &
    Readonly<{
      jobId: string;
      revisionId: string;
      slug: string;
    }>,
) {
  await pool().query(
    `INSERT INTO "Job"
      ("id","companyId","slug","createdByUserId","updatedAt")
     VALUES ($1,$2,$3,$4,now())`,
    [input.jobId, IDS.company, input.slug, IDS.userA],
  );
  await pool().query(
    `INSERT INTO "JobRevision" (
      "id","jobId","revisionNumber","title","description","tasks","requirements",
      "applicationProcessSteps","requiredDocumentKinds","jobType","remoteType","remoteCountryCode",
      "categoryId","cantonId","cityId","workloadMin","workloadMax","startByArrangement",
      "validThrough","responseTargetDays","applicationEffort","applicationContactKind",
      "applicationContactValue","authoredByUserId","contentChecksum","submittedAt","approvedAt"
    ) VALUES (
      $1,$2,1,'Projection Engineer','A complete publication projection contract fixture',
      ARRAY['Build reliable systems'],ARRAY['PostgreSQL experience'],ARRAY['Apply'],
      ARRAY['NONE']::"RequiredDocumentKind"[],'PERMANENT',$3,$4,$5,$6,$7,80,100,false,
      now() + interval '30 days',14,'SIMPLE','EMAIL','jobs@example.ch',$8,$9,
      now() - interval '2 hours',now() - interval '1 hour'
    )`,
    [
      input.revisionId,
      input.jobId,
      input.remoteType,
      input.remoteCountryCode,
      IDS.category,
      input.cantonId,
      input.cityId,
      IDS.userA,
      input.revisionId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    ],
  );
  await pool().query(
    `UPDATE "Job" SET
      "status" = 'PUBLISHED',
      "currentRevisionId" = $2,
      "publishedRevisionId" = $2,
      "publishedAt" = now() - interval '1 hour',
      "expiresAt" = (SELECT "validThrough" FROM "JobRevision" WHERE "id" = $2),
      "publishedCategoryId" = $3,
      "publishedCantonId" = $4,
      "publishedCityId" = $5,
      "updatedAt" = now()
     WHERE "id" = $1`,
    [
      input.jobId,
      input.revisionId,
      IDS.category,
      input.cantonId,
      input.cityId,
    ],
  );
}

describe("Phase 03 corrective schema contracts", () => {
  it("requires a JSONB input snapshot for every persisted score", async () => {
    const columns = await pool().query<{
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'JobScoreSnapshot'
         AND column_name = 'inputSnapshot'`,
    );

    expect(columns.rows).toEqual([{ data_type: "jsonb", is_nullable: "NO" }]);
  });

  it("atomically scopes privacy idempotency and one open request per user/type", async () => {
    const insertRequest = (
      id: string,
      requesterUserId: string,
      type: "EXPORT" | "DELETE",
      status: "PENDING" | "CANCELLED",
      idempotencyKey: string,
    ) =>
      pool().query(
        `INSERT INTO "PrivacyRequest"
          ("id","requesterUserId","type","status","dueAt","idempotencyKey","updatedAt")
         VALUES ($1,$2,$3,$4,now() + interval '30 days',$5,now())`,
        [id, requesterUserId, type, status, idempotencyKey],
      );

    await insertRequest(
      "21000000-0000-4000-8000-000000000001",
      IDS.userA,
      "EXPORT",
      "PENDING",
      "shared-client-key",
    );
    await insertRequest(
      "21000000-0000-4000-8000-000000000002",
      IDS.userB,
      "EXPORT",
      "PENDING",
      "shared-client-key",
    );

    let duplicateOpen: unknown;
    try {
      await insertRequest(
        "21000000-0000-4000-8000-000000000003",
        IDS.userA,
        "EXPORT",
        "PENDING",
        "another-key",
      );
    } catch (error) {
      duplicateOpen = error;
    }
    expect(duplicateOpen).toMatchObject({
      code: "23505",
      constraint: "PrivacyRequest_one_open_type_key",
    });

    await insertRequest(
      "21000000-0000-4000-8000-000000000004",
      IDS.userA,
      "DELETE",
      "CANCELLED",
      "completed-one",
    );
    await insertRequest(
      "21000000-0000-4000-8000-000000000005",
      IDS.userA,
      "DELETE",
      "CANCELLED",
      "completed-two",
    );
  });

  it("stores one notification dedupe key independently per recipient and kind", async () => {
    const insert = (id: string, recipient: string) =>
      pool().query(
        `INSERT INTO "Notification" ("id","recipientUserId","kind","schemaVersion","payload","dedupeKey")
       VALUES ($1,$2,'ORDER_PAID','v1','{}'::jsonb,'order-1')`,
        [id, recipient],
      );
    await insert("20000000-0000-4000-8000-000000000001", IDS.userA);
    await insert("20000000-0000-4000-8000-000000000002", IDS.userB);

    let duplicate: unknown;
    try {
      await insert("20000000-0000-4000-8000-000000000003", IDS.userA);
    } catch (error) {
      duplicate = error;
    }
    expect(duplicate).toMatchObject({
      code: "23505",
      constraint: "Notification_recipientUserId_kind_dedupeKey_key",
    });
  });

  it("enforces mutually exclusive onsite/city and remote/CH scopes", async () => {
    const insertRevision = (
      id: string,
      revisionNumber: number,
      remoteType: "HYBRID" | "ONSITE" | "REMOTE",
      remoteCountryCode: string | null,
      cantonId: string | null,
      cityId: string | null,
    ) =>
      pool().query(
        `INSERT INTO "JobRevision" (
        "id","jobId","revisionNumber","title","description","tasks","requirements",
        "applicationProcessSteps","requiredDocumentKinds","jobType","remoteType","remoteCountryCode",
        "categoryId","cantonId","cityId","workloadMin","workloadMax","responseTargetDays",
        "applicationEffort","applicationContactKind","applicationContactValue","authoredByUserId","contentChecksum"
      ) VALUES (
        $1,$2,$3,'Engineer','A sufficiently bounded job description','{}','{}',
        ARRAY['Apply']::text[],ARRAY['NONE']::"RequiredDocumentKind"[],'PERMANENT',$4,$5,
        $6,$7,$8,80,100,14,'SIMPLE','EMAIL','jobs@example.ch',$9,$10
      )`,
        [
          id,
          IDS.job,
          revisionNumber,
          remoteType,
          remoteCountryCode,
          IDS.category,
          cantonId,
          cityId,
          IDS.userA,
          id.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        ],
      );

    await insertRevision(
      "30000000-0000-4000-8000-000000000001",
      1,
      "HYBRID",
      null,
      IDS.canton,
      IDS.city,
    );
    await insertRevision(
      "30000000-0000-4000-8000-000000000002",
      2,
      "REMOTE",
      "CH",
      null,
      null,
    );

    let invalidCountry: unknown;
    try {
      await insertRevision(
        "30000000-0000-4000-8000-000000000003",
        3,
        "REMOTE",
        "DE",
        null,
        null,
      );
    } catch (error) {
      invalidCountry = error;
    }
    expect(invalidCountry).toMatchObject({
      code: "23514",
      constraint: "JobRevision_location_scope_check",
    });

    await expect(
      insertRevision(
        "30000000-0000-4000-8000-000000000004",
        4,
        "REMOTE",
        "CH",
        IDS.canton,
        IDS.city,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "JobRevision_location_scope_check",
    });
    await expect(
      insertRevision(
        "30000000-0000-4000-8000-000000000005",
        5,
        "ONSITE",
        null,
        IDS.canton,
        null,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "JobRevision_location_scope_check",
    });
  });

  it.each([
    {
      jobId: "31000000-0000-4000-8000-000000000001",
      revisionId: "32000000-0000-4000-8000-000000000001",
      slug: "projection-remote",
      remoteType: "REMOTE",
      remoteCountryCode: "CH",
      cantonId: null,
      cityId: null,
    },
    {
      jobId: "31000000-0000-4000-8000-000000000002",
      revisionId: "32000000-0000-4000-8000-000000000002",
      slug: "projection-onsite",
      remoteType: "ONSITE",
      remoteCountryCode: null,
      cantonId: IDS.canton,
      cityId: IDS.city,
    },
    {
      jobId: "31000000-0000-4000-8000-000000000003",
      revisionId: "32000000-0000-4000-8000-000000000003",
      slug: "projection-hybrid",
      remoteType: "HYBRID",
      remoteCountryCode: null,
      cantonId: IDS.canton,
      cityId: IDS.city,
    },
  ] satisfies readonly (LocationScope &
    Readonly<{ jobId: string; revisionId: string; slug: string }>)[])(
    "publishes an exact $remoteType location projection and rejects drift",
    async (fixture) => {
      await insertAndPublishLocationJob(fixture);

      const projection = await pool().query<{
        publishedCantonId: string | null;
        publishedCityId: string | null;
        status: string;
      }>(
        `SELECT "publishedCantonId", "publishedCityId", "status"
         FROM "Job" WHERE "id" = $1`,
        [fixture.jobId],
      );
      expect(projection.rows).toEqual([
        {
          publishedCantonId: fixture.cantonId,
          publishedCityId: fixture.cityId,
          status: "PUBLISHED",
        },
      ]);

      const drift =
        fixture.remoteType === "REMOTE"
          ? pool().query(
              `UPDATE "Job" SET "publishedCantonId" = $2, "publishedCityId" = $3
               WHERE "id" = $1`,
              [fixture.jobId, IDS.canton, IDS.city],
            )
          : pool().query(
              `UPDATE "Job" SET "publishedCityId" = NULL WHERE "id" = $1`,
              [fixture.jobId],
            );
      await expect(drift).rejects.toMatchObject({
        code: "23514",
        constraint: "job_published_projection_match_check",
      });
    },
  );
});
