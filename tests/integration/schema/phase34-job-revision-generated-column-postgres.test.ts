import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase34_job_revision_generated_immutability",
    { useTemplate: false },
  );
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase 34 generated JobRevision search document", () => {
  it("allows the monotone moderation transition but keeps every authored source field immutable", async () => {
    const now = new Date("2026-08-06T18:00:00.000Z");
    const suffix = Math.random().toString(36).slice(2, 10);
    const user = await db().user.create({
      data: {
        email: `phase34-revision-${suffix}@example.test`,
        emailNormalized: `phase34-revision-${suffix}@example.test`,
        role: "EMPLOYER",
        status: "ACTIVE",
        dataProvenance: "TEST",
        emailVerifiedAt: now,
      },
      select: { id: true },
    });
    const [category, canton, company] = await Promise.all([
      db().category.create({
        data: { name: `Phase34 Category ${suffix}`, slug: `p34-cat-${suffix}` },
        select: { id: true },
      }),
      db().canton.create({
        data: {
          code: `X${suffix.slice(0, 1).toUpperCase()}`,
          name: `Phase34 Canton ${suffix}`,
          slug: `p34-canton-${suffix}`,
          language: "DE",
        },
        select: { id: true },
      }),
      db().company.create({
        data: {
          name: `Phase34 Revision ${suffix} AG`,
          slug: `p34-revision-${suffix}`,
          status: "DRAFT",
          dataProvenance: "TEST",
        },
        select: { id: true },
      }),
    ]);
    const job = await db().job.create({
      data: {
        companyId: company.id,
        slug: `p34-revision-job-${suffix}`,
        status: "SUBMITTED",
        dataProvenance: "TEST",
        createdByUserId: user.id,
      },
      select: { id: true },
    });
    const city = await db().city.create({
      data: {
        cantonId: canton.id,
        name: `Phase34 City ${suffix}`,
        slug: `p34-city-${suffix}`,
      },
      select: { id: true },
    });
    const title = "Phase 34 unveränderliche Originalstelle";
    const revision = await db().jobRevision.create({
      data: {
        jobId: job.id,
        revisionNumber: 1,
        title,
        description:
          "Dieser Datensatz prüft die echte PostgreSQL-Triggergrenze für freigegebene Inhalte.",
        tasks: ["Moderation sicher abschliessen"],
        requirements: ["Originalinhalte unverändert halten"],
        applicationProcessSteps: ["Bewerbung", "Gespräch"],
        requiredDocumentKinds: ["CV"],
        jobType: "PERMANENT",
        remoteType: "HYBRID",
        categoryId: category.id,
        cantonId: canton.id,
        cityId: city.id,
        locationLabel: "Schweiz",
        workloadMin: 80,
        workloadMax: 100,
        salaryPeriod: "YEARLY",
        salaryMin: 100_000,
        salaryMax: 120_000,
        validThrough: new Date("2026-09-06T18:00:00.000Z"),
        responseTargetDays: 7,
        applicationEffort: "SIMPLE",
        applicationContactKind: "EMAIL",
        applicationContactValue: "jobs@example.test",
        authoredByUserId: user.id,
        contentChecksum: createHash("sha256")
          .update(`phase34-revision:${job.id}`, "utf8")
          .digest("hex"),
        submittedAt: now,
      },
      select: { id: true, searchDocument: true, version: true },
    });
    expect(revision.searchDocument).toContain("phase 34");

    await expect(
      db().jobRevision.update({
        where: { id: revision.id },
        data: { approvedAt: new Date(now.getTime() + 1_000), version: { increment: 1 } },
        select: { approvedAt: true, searchDocument: true, version: true },
      }),
    ).resolves.toEqual({
      approvedAt: new Date(now.getTime() + 1_000),
      searchDocument: revision.searchDocument,
      version: revision.version + 1,
    });

    await expect(
      db().jobRevision.update({
        where: { id: revision.id },
        data: { title: "Manipulierter Titel", version: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(
      db().jobRevision.findUniqueOrThrow({
        where: { id: revision.id },
        select: { title: true, approvedAt: true, version: true },
      }),
    ).resolves.toEqual({
      title,
      approvedAt: new Date(now.getTime() + 1_000),
      version: revision.version + 1,
    });
  });
});

function db(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Phase 34 generated-column test database is unavailable.");
  }
  return database;
}
