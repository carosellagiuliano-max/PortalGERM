import {
  buildFairJobScoreSnapshotV2,
  calculateFairJobScoreFromSnapshotV2,
  verifyFairJobScoreSnapshotHashV2,
  writeFairJobScoreSnapshotV2,
} from "@/lib/scoring/fair-job-snapshot";
import type { FairJobRevisionInputV2 } from "@/lib/scoring/fair-job-score";
import { describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-07-19T12:00:00.000Z");

function revision(): FairJobRevisionInputV2 {
  const detail = (value: string) => `${value} with enough concrete detail.`;
  return {
    id: "revision-1",
    jobId: "job-1",
    salaryPeriod: "YEARLY",
    salaryMin: 90_000,
    salaryMax: 110_000,
    tasks: [detail("Task one"), detail("Task two"), detail("Task three")],
    requirements: [
      detail("Requirement one"),
      detail("Requirement two"),
      detail("Requirement three"),
    ],
    workloadMin: 80,
    workloadMax: 100,
    jobType: "PERMANENT",
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    startByArrangement: false,
    remoteType: "HYBRID",
    cantonId: "canton-zh",
    cityId: "city-zurich",
    remoteCountryCode: null,
    applicationEffort: "SIMPLE",
    applicationProcessSteps: [detail("Submit the requested documents")],
    requiredDocumentKinds: ["CV"],
    responseTargetDays: 7,
    benefits: [
      { benefitCode: "HOME_OFFICE", description: detail("Home office") },
      { benefitCode: "PAID_TRAINING", description: detail("Paid training") },
    ],
    inclusionStatement:
      "We welcome qualified people from every background and provide support.",
    applicationContactKind: "EMAIL",
    applicationContactValue: "jobs@example.ch",
    validThrough: new Date("2026-08-19T12:00:00.000Z"),
  };
}

describe("Fair Job Score v2 persistence snapshot", () => {
  it("builds the complete persistence record and reproduces the exact score", () => {
    const snapshot = buildFairJobScoreSnapshotV2({
      revision: revision(),
      job: { id: "job-1" },
      clock: { now: NOW },
    });

    expect(snapshot).toMatchObject({
      jobRevisionId: "revision-1",
      scoreVersion: "v2",
      scorePoints: 100,
      maxPoints: 100,
      inputSnapshot: {
        schemaVersion: "fair-job-input/v2",
        scoreVersion: "v2",
        job: { id: "job-1" },
        clock: { now: NOW.toISOString() },
      },
      calculatedAt: NOW,
    });
    expect(snapshot.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(calculateFairJobScoreFromSnapshotV2(snapshot.inputSnapshot)).toEqual(
      {
        score: snapshot.scorePoints,
        version: "v2",
        evidence: snapshot.evidence,
        positiveReasons: [
          "SALARY_MET",
          "TASKS_REQUIREMENTS_MET",
          "WORKLOAD_CONTRACT_START_MET",
          "LOCATION_REMOTE_MET",
          "APPLICATION_PROCESS_MET",
          "RESPONSE_TARGET_MET",
          "BENEFITS_MET",
          "INCLUSION_CONTACT_MET",
          "FRESHNESS_MET",
        ],
        missingImprovements: [],
        employerSuggestions: [],
      },
    );
    expect(verifyFairJobScoreSnapshotHashV2(snapshot)).toBe(true);
  });

  it("copies and freezes the Revision input instead of retaining mutable references", () => {
    const source = revision();
    const snapshot = buildFairJobScoreSnapshotV2({
      revision: source,
      job: { id: "job-1" },
      clock: { now: NOW },
    });

    (source.tasks as string[])[0] = "changed after scoring";
    source.startDate?.setUTCFullYear(2035);

    expect(snapshot.inputSnapshot.revision.tasks[0]).toContain("Task one");
    expect(snapshot.inputSnapshot.revision.startDate).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(Object.isFrozen(snapshot.inputSnapshot.revision.tasks)).toBe(true);
    expect(() =>
      (snapshot.inputSnapshot.revision.tasks as string[]).push("late mutation"),
    ).toThrow();
  });

  it("survives a JSON round trip and detects changed persisted evidence", () => {
    const snapshot = buildFairJobScoreSnapshotV2({
      revision: revision(),
      job: { id: "job-1" },
      clock: { now: NOW },
    });
    const restoredInput = JSON.parse(
      JSON.stringify(snapshot.inputSnapshot),
    ) as typeof snapshot.inputSnapshot;

    expect(calculateFairJobScoreFromSnapshotV2(restoredInput).score).toBe(100);
    expect(
      verifyFairJobScoreSnapshotHashV2({ ...snapshot, scorePoints: 99 }),
    ).toBe(false);
  });

  it("writes input and evidence together through the publication transaction port", async () => {
    const row = { id: "snapshot-row" };
    const create = vi.fn(async () => row);

    await expect(
      writeFairJobScoreSnapshotV2(
        { jobScoreSnapshot: { create } },
        {
          revision: revision(),
          job: { id: "job-1" },
          clock: { now: NOW },
        },
      ),
    ).resolves.toBe(row);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputSnapshot: expect.objectContaining({
          schemaVersion: "fair-job-input/v2",
        }),
        scorePoints: 100,
        evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    });
  });
});
