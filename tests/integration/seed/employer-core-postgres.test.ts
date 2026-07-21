import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { seedAuthRbacFixtures } from "@/prisma/seed/blocks/auth-rbac";
import { seedDemoAccountsCompaniesAndJobs } from "@/prisma/seed/blocks/companies-jobs";
import { seedEmployerCoreFixtures } from "@/prisma/seed/blocks/employer-core";
import { seedReferenceCatalog } from "@/prisma/seed/blocks/reference-catalog";
import {
  EMPLOYER_CORE_SEED_IDENTITIES,
  buildEmployerCoreSeedFixtures,
} from "@/prisma/seed/fixtures/employer-core";
import { stableSeedId } from "@/prisma/seed/ids";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const ANCHOR = new Date("2026-07-20T10:00:00.000Z");
const TRACKED_TABLES = Object.freeze([
  "CompanyInvitation",
  "CompanyInvitationEvent",
  "CompanyMembership",
  "CompanyMembershipEvent",
  "EmployerProfile",
  "JobAssignment",
  "JobAssignmentEvent",
  "User",
] as const);

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Employer-core integration client is missing.");
  }
  return database;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase_10_employer_core_seed");
  database = createDatabaseClient(isolated.connectionString);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-10 employer-core PostgreSQL seed", () => {
  it("persists the role, invitation and assignment fixtures without replay updates", async () => {
    await seedReferenceCatalog(client());
    await seedDemoAccountsCompaniesAndJobs(client(), ANCHOR);
    await seedAuthRbacFixtures(client(), ANCHOR);

    const first = await seedEmployerCoreFixtures(client(), ANCHOR);
    const before = await loadTrackedVersions(client());
    const second = await seedEmployerCoreFixtures(client(), ANCHOR);
    const after = await loadTrackedVersions(client());
    const fixtures = buildEmployerCoreSeedFixtures(ANCHOR);

    expect(second).toEqual(first);
    expect(after).toEqual(before);
    expect(first.identities).toEqual(EMPLOYER_CORE_SEED_IDENTITIES);

    const companyRoles = await client().companyMembership.findMany({
      where: { companyId: fixtures.invitation.companyId, status: "ACTIVE" },
      select: { role: true },
      orderBy: { role: "asc" },
    });
    expect(companyRoles.map(({ role }) => role).sort()).toEqual([
      "ADMIN",
      "OWNER",
      "RECRUITER",
      "VIEWER",
    ]);

    const pendingReservations = await client().companyInvitation.count({
      where: {
        companyId: fixtures.invitation.companyId,
        status: "PENDING",
        expiresAt: { gt: ANCHOR },
      },
    });
    expect(companyRoles.length + pendingReservations).toBe(5);

    const invitation = await client().companyInvitation.findUniqueOrThrow({
      where: { id: fixtures.invitation.id },
      include: { events: true },
    });
    expect(invitation).toMatchObject({
      inviteeEmailNormalized: fixtures.invitation.inviteeEmailNormalized,
      intendedRole: "RECRUITER",
      status: "PENDING",
      tokenHash: fixtures.invitation.tokenHash,
      tokenVersion: 1,
    });
    expect(invitation.events).toEqual([
      expect.objectContaining({ kind: "CREATED" }),
    ]);

    const assignments = await client().jobAssignment.findMany({
      where: { id: { in: fixtures.assignments.map(({ id }) => id) } },
      include: { events: true, job: { select: { slug: true } } },
      orderBy: { role: "asc" },
    });
    expect(
      assignments
        .map(({ job, role, status }) => ({
          jobSlug: job.slug,
          role,
          status,
        }))
        .sort((left, right) => left.role.localeCompare(right.role)),
    ).toEqual([
      {
        jobSlug: "kv-administration-demo-054",
        role: "EDITOR",
        status: "ACTIVE",
      },
      {
        jobSlug: "zh-engineering-demo-024",
        role: "PIPELINE",
        status: "ACTIVE",
      },
      {
        jobSlug: "zh-engineering-demo-025",
        role: "REVIEWER",
        status: "ACTIVE",
      },
    ]);
    expect(
      assignments.every((assignment) => assignment.events.length === 1),
    ).toBe(true);
    expect(
      await client().jobAssignment.count({
        where: {
          jobId: stableSeedId("job", "zh-engineering-demo-026"),
          userId: stableSeedId("user", "recruiter@demo.ch"),
          status: "ACTIVE",
        },
      }),
    ).toBe(0);
  }, 240_000);
});

async function loadTrackedVersions(db: DatabaseClient) {
  const snapshots: Array<{
    entity: string;
    id: string;
    version: string;
  }> = [];
  for (const table of TRACKED_TABLES) {
    const rows = await db.$queryRawUnsafe<
      Array<{ id: string; version: string }>
    >(
      `SELECT "id"::text AS id, xmin::text AS version FROM "${table}" ORDER BY "id"`,
    );
    snapshots.push(
      ...rows.map((row) => ({
        entity: table,
        id: row.id,
        version: row.version,
      })),
    );
  }
  return snapshots;
}
