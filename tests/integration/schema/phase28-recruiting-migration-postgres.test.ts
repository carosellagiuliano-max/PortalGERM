import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

describe.sequential("Phase 28 additive recruiting migration", () => {
  let migrated: Migrated;
  let database: DatabaseClient;

  beforeAll(async () => {
    migrated = await createMigratedTestDatabase("phase28_recruiting_migration");
    database = createDatabaseClient(migrated.connectionString);
    await database.$connect();
  }, 120_000);

  afterAll(async () => {
    await database?.$disconnect().catch(() => undefined);
    await migrated?.dispose();
  });

  it("installs all additive tables, closed enums and the legacy INTERVIEW status", async () => {
    const tables = await database.$queryRaw<{ tableName: string }[]>`
      SELECT table_name AS "tableName"
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'ExternalApplicationTracker',
           'ExternalJobSnapshot',
           'ExternalApplicationEvent',
           'Interview',
           'InterviewProposal',
           'InterviewParticipant',
           'InterviewResponse',
           'InterviewEvent',
           'CalendarArtifact',
           'InterviewReminder'
         )
       ORDER BY table_name
    `;
    expect(tables).toHaveLength(10);
    const values = await database.$queryRaw<
      { enumName: string; value: string }[]
    >`
      SELECT type.typname AS "enumName", enum.enumlabel AS "value"
        FROM pg_type type
        JOIN pg_enum enum ON enum.enumtypid = type.oid
       WHERE type.typname IN (
         'ExternalApplicationStatus',
         'InterviewStatus',
         'ApplicationStatus'
       )
       ORDER BY type.typname, enum.enumsortorder
    `;
    expect(values).toEqual(
      expect.arrayContaining([
        { enumName: "ExternalApplicationStatus", value: "BEGUN" },
        { enumName: "ExternalApplicationStatus", value: "ARCHIVED" },
        { enumName: "InterviewStatus", value: "PROPOSED" },
        { enumName: "InterviewStatus", value: "RESCHEDULE_PENDING" },
        { enumName: "InterviewStatus", value: "CANCELLED" },
        { enumName: "ApplicationStatus", value: "INTERVIEW" },
      ]),
    );
  });

  it("installs tenant guards, append-only triggers, named checks and bounded indexes", async () => {
    const triggers = await database.$queryRaw<{ name: string }[]>`
      SELECT tgname AS "name"
        FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN (
           'external_job_snapshot_append_only',
           'external_application_event_append_only',
           'interview_response_append_only',
           'interview_event_append_only',
           'interview_scope_guard',
           'interview_participant_scope_guard',
           'external_application_event_actor_guard'
         )
       ORDER BY tgname
    `;
    expect(triggers).toHaveLength(7);
    const constraints = await database.$queryRaw<{ name: string }[]>`
      SELECT constraint_name AS "name"
        FROM information_schema.table_constraints
       WHERE table_schema = 'public'
         AND constraint_name IN (
           'external_tracker_version_check',
           'external_snapshot_hash_check',
           'interview_version_check',
           'interview_schedule_check',
           'interview_response_shape_check',
           'calendar_artifact_hash_check',
           'interview_reminder_state_check'
         )
       ORDER BY constraint_name
    `;
    expect(constraints).toHaveLength(7);
    const activeCalendarIndex = await database.$queryRaw<
      { definition: string }[]
    >`
      SELECT indexdef AS definition
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'calendar_artifact_one_active_per_interview'
    `;
    expect(activeCalendarIndex[0]?.definition).toMatch(
      /UNIQUE.*WHERE.*status.*ACTIVE/iu,
    );
  });

  it("creates no synthetic tracker/interview rows and records a completed migration", async () => {
    expect(
      await Promise.all([
        database.externalApplicationTracker.count(),
        database.interview.count(),
        database.interviewEvent.count(),
        database.interviewReminder.count(),
      ]),
    ).toEqual([0, 0, 0, 0]);
    const migration = await database.$queryRaw<
      { finishedAt: Date | null; rolledBackAt: Date | null }[]
    >`
      SELECT finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
        FROM "_prisma_migrations"
       WHERE migration_name =
         '20260729073537_phase_28_recruiting_workflows'
    `;
    expect(migration).toHaveLength(1);
    expect(migration[0]?.finishedAt).toBeInstanceOf(Date);
    expect(migration[0]?.rolledBackAt).toBeNull();
  });

  it("replays migrate deploy with unchanged catalog and domain counts", async () => {
    const before = await counts(database);
    await migrated.migrate();
    expect(await counts(database)).toEqual(before);
  }, 120_000);
});

async function counts(database: DatabaseClient) {
  const [migrations, trackers, interviews, applications, jobs] =
    await Promise.all([
      database.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
      `.then((rows) => Number(rows[0]?.count ?? 0)),
      database.externalApplicationTracker.count(),
      database.interview.count(),
      database.application.count(),
      database.job.count(),
    ]);
  return { migrations, trackers, interviews, applications, jobs };
}
