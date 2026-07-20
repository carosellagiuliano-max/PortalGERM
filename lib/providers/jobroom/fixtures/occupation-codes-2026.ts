import type { JobroomReportingResult } from "../jobroom-provider";

export const JOBROOM_LEGAL_DISCLAIMER =
  "Dieser Check ist eine Orientierung und keine Rechtsberatung. Bitte prüfen Sie meldepflichtige Stellen offiziell.";

export const JOBROOM_OFFICIAL_SOURCE_URL =
  "https://www.arbeit.swiss/de/arbeitgebende/stellenmeldepflicht-2026";

export interface OccupationCodeFixtureEntry {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly result: JobroomReportingResult;
  readonly classificationStatus: "RESOLVED" | "AMBIGUOUS";
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
}

export interface OccupationCodeDatasetFixture {
  readonly datasetKey: string;
  readonly datasetVersion: string;
  readonly dataYear: number;
  readonly sourceUrl: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly occupationCodes: readonly OccupationCodeFixtureEntry[];
}

export const JOBROOM_FIXTURE_IDS = Object.freeze({
  requiresReporting: "b7b7d035-6fd5-4f9c-8f31-000000000001",
  notRequired: "b7b7d035-6fd5-4f9c-8f31-000000000002",
  sourceUnknown: "b7b7d035-6fd5-4f9c-8f31-000000000003",
  ambiguous: "b7b7d035-6fd5-4f9c-8f31-000000000004",
  stale: "b7b7d035-6fd5-4f9c-8f31-000000000005",
});

/**
 * Deliberately small, versioned Mock dataset. The synthetic codes exercise the
 * tri-state contract and fail-closed paths; they are not a legal or complete
 * copy of the official occupation list.
 */
export const OCCUPATION_CODES_2026_FIXTURE: OccupationCodeDatasetFixture =
  Object.freeze({
    datasetKey: "JOBROOM_REPORTING_MOCK",
    datasetVersion: "mock-ch-isco-19-2026-v1",
    dataYear: 2026,
    sourceUrl: JOBROOM_OFFICIAL_SOURCE_URL,
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: "2027-01-01T00:00:00.000Z",
    occupationCodes: Object.freeze([
      Object.freeze({
        id: JOBROOM_FIXTURE_IDS.requiresReporting,
        code: "MOCK-REQ-001",
        label: "Demo-Berufsart mit Meldepflicht",
        result: "REQUIRES_REPORTING",
        classificationStatus: "RESOLVED",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2027-01-01T00:00:00.000Z",
      }),
      Object.freeze({
        id: JOBROOM_FIXTURE_IDS.notRequired,
        code: "MOCK-NOT-001",
        label: "Demo-Berufsart ohne Meldepflicht",
        result: "NOT_REQUIRED",
        classificationStatus: "RESOLVED",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2027-01-01T00:00:00.000Z",
      }),
      Object.freeze({
        id: JOBROOM_FIXTURE_IDS.sourceUnknown,
        code: "MOCK-UNK-001",
        label: "Demo-Berufsart mit ungeklärtem Ergebnis",
        result: "UNKNOWN",
        classificationStatus: "RESOLVED",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2027-01-01T00:00:00.000Z",
      }),
      Object.freeze({
        id: JOBROOM_FIXTURE_IDS.ambiguous,
        code: "MOCK-AMB-001-A",
        label: "Mehrdeutige Demo-Berufsart A",
        result: "UNKNOWN",
        classificationStatus: "AMBIGUOUS",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2027-01-01T00:00:00.000Z",
      }),
      Object.freeze({
        id: JOBROOM_FIXTURE_IDS.stale,
        code: "MOCK-OLD-001",
        label: "Abgelaufene Demo-Berufsart",
        result: "NOT_REQUIRED",
        classificationStatus: "RESOLVED",
        effectiveFrom: "2025-01-01T00:00:00.000Z",
        effectiveTo: "2026-01-01T00:00:00.000Z",
      }),
    ]),
  });
