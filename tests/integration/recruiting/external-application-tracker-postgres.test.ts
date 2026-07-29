import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createExternalApplicationTracker,
  getExternalApplicationTracker,
  listExternalApplicationTrackers,
  previewExternalApplicationResume,
  transitionExternalApplicationTracker,
} from "@/lib/recruiting/external-tracker";
import {
  createPhase28RecruitingFixture,
  type Phase28RecruitingFixture,
} from "@/tests/fixtures/phase28-recruiting";

describe.sequential("Phase 28 external application tracker on PostgreSQL", () => {
  let fixture: Phase28RecruitingFixture;
  let trackerId = "";
  let trackerVersion = 0;

  beforeAll(async () => {
    fixture = await createPhase28RecruitingFixture("external_tracker");
  }, 120_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("keeps an external click as resume intent only with zero submitted rows", async () => {
    const preview = await previewExternalApplicationResume(
      { jobId: fixture.jobId, jobRevisionId: fixture.revisionId },
      {
        database: fixture.database,
        environment: fixture.environment,
      },
    );
    expect(preview).toMatchObject({
      jobId: fixture.jobId,
      jobRevisionId: fixture.revisionId,
      applicationUrl: "https://ats.example.test/jobs/phase-28",
    });
    expect(
      await fixture.database.externalApplicationTracker.count(),
    ).toBe(0);
    expect(await fixture.database.application.count()).toBe(1);
  });

  it("creates one immutable candidate-confirmed snapshot and replays safely", async () => {
    const key = randomUUID();
    const created = await createExternalApplicationTracker(
      {
        candidateUserId: fixture.candidateUserId,
        jobId: fixture.jobId,
        jobRevisionId: fixture.revisionId,
        idempotencyKey: key,
      },
      fixture.dependencies(),
    );
    expect(created).toMatchObject({
      ok: true,
      replay: false,
      status: "BEGUN",
      version: 1,
    });
    if (!created.ok) throw new Error(created.code);
    trackerId = created.trackerId;
    trackerVersion = created.version;

    const replay = await createExternalApplicationTracker(
      {
        candidateUserId: fixture.candidateUserId,
        jobId: fixture.jobId,
        jobRevisionId: fixture.revisionId,
        idempotencyKey: key,
      },
      fixture.dependencies(),
    );
    expect(replay).toMatchObject({
      ok: true,
      replay: true,
      trackerId,
      status: "BEGUN",
    });
    const stored =
      await fixture.database.externalApplicationTracker.findUniqueOrThrow({
        where: { id: trackerId },
        include: { snapshot: true, events: true },
      });
    expect(stored.source).toBe("CANDIDATE_CONFIRMED");
    expect(stored.snapshot).toMatchObject({
      source: "CANDIDATE_CONFIRMED",
      jobTitle: "Phase 28 Software Engineer",
      companyId: fixture.companyId,
    });
    expect(stored.events).toHaveLength(1);
    expect(stored.events[0]).toMatchObject({
      kind: "CREATED",
      toStatus: "BEGUN",
      actorUserId: fixture.candidateUserId,
    });
  });

  it("persists allowed transitions exactly once and denies stale, invalid and foreign writes", async () => {
    const key = randomUUID();
    const submitted = await transitionExternalApplicationTracker(
      {
        candidateUserId: fixture.candidateUserId,
        trackerId,
        nextStatus: "SUBMITTED",
        expectedVersion: trackerVersion,
        idempotencyKey: key,
      },
      fixture.dependencies(),
    );
    expect(submitted).toMatchObject({
      ok: true,
      replay: false,
      status: "SUBMITTED",
      version: 2,
    });
    if (!submitted.ok) throw new Error(submitted.code);
    trackerVersion = submitted.version;

    expect(
      await transitionExternalApplicationTracker(
        {
          candidateUserId: fixture.candidateUserId,
          trackerId,
          nextStatus: "SUBMITTED",
          expectedVersion: 1,
          idempotencyKey: key,
        },
        fixture.dependencies(),
      ),
    ).toMatchObject({ ok: true, replay: true });
    expect(
      await transitionExternalApplicationTracker(
        {
          candidateUserId: fixture.candidateUserId,
          trackerId,
          nextStatus: "HIRED",
          expectedVersion: trackerVersion,
          idempotencyKey: randomUUID(),
        },
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "INVALID_TRANSITION" });
    expect(
      await transitionExternalApplicationTracker(
        {
          candidateUserId: fixture.foreignCandidateUserId,
          trackerId,
          nextStatus: "INTERVIEW",
          expectedVersion: trackerVersion,
          idempotencyKey: randomUUID(),
        },
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await getExternalApplicationTracker(
        fixture.foreignCandidateUserId,
        trackerId,
        { database: fixture.database, environment: fixture.environment },
      ),
    ).toBeNull();
    expect(
      await listExternalApplicationTrackers(
        fixture.foreignCandidateUserId,
        { database: fixture.database, environment: fixture.environment },
      ),
    ).toEqual([]);
    expect(
      await fixture.database.externalApplicationEvent.count({
        where: { trackerId },
      }),
    ).toBe(2);
  });

  it("enforces snapshot and event append-only contracts in PostgreSQL", async () => {
    const snapshot =
      await fixture.database.externalJobSnapshot.findUniqueOrThrow({
        where: { trackerId },
      });
    const event =
      await fixture.database.externalApplicationEvent.findFirstOrThrow({
        where: { trackerId },
      });
    await expect(
      fixture.database.externalJobSnapshot.update({
        where: { id: snapshot.id },
        data: { jobTitle: "Manipulated title" },
      }),
    ).rejects.toThrow(/immutable|append-only/iu);
    await expect(
      fixture.database.externalApplicationEvent.delete({
        where: { id: event.id },
      }),
    ).rejects.toThrow(/append-only/iu);
  });
});
