import { createHash } from "node:crypto";

import {
  FAIR_JOB_FACTOR_ORDER_V2,
  FAIR_JOB_FACTOR_POINTS_V2,
  FAIR_JOB_SCORE_VERSION,
  buildFairJobInputV2,
  calculateFairJobScoreV2,
  type BuildFairJobInputV2Args,
  type FairJobEvidenceState,
  type FairJobFactorV2,
  type FairJobInput,
  type FairJobReasonCodeV2,
  type FairJobResult,
  type FairJobRevisionInputV2,
} from "@/lib/scoring/fair-job-score";

export const FAIR_JOB_INPUT_SNAPSHOT_SCHEMA_V2 = "fair-job-input/v2" as const;

type SerializedFairJobInputV2 = Readonly<{
  salaryRange: FairJobInput["salaryRange"];
  tasksAndRequirementsClarity: FairJobInput["tasksAndRequirementsClarity"];
  workloadContractAndStartDefined: boolean;
  locationAndRemoteDefined: boolean;
  applicationProcessDefined: boolean;
  responseTargetDays: number | null;
  concreteBenefitsCount: number;
  inclusionAndContactDefined: boolean;
  validThrough: string | null;
}>;

type SerializedFairJobRevisionV2 = Readonly<{
  id: string;
  jobId: string;
  salaryPeriod: FairJobRevisionInputV2["salaryPeriod"];
  salaryMin: number | null;
  salaryMax: number | null;
  tasks: readonly string[];
  requirements: readonly string[];
  workloadMin: number;
  workloadMax: number;
  jobType: FairJobRevisionInputV2["jobType"];
  startDate: string | null;
  startByArrangement: boolean;
  remoteType: FairJobRevisionInputV2["remoteType"];
  cantonId: string | null;
  cityId: string | null;
  remoteCountryCode: string | null;
  applicationEffort: FairJobRevisionInputV2["applicationEffort"];
  applicationProcessSteps: readonly string[];
  requiredDocumentKinds: FairJobRevisionInputV2["requiredDocumentKinds"];
  responseTargetDays: number | null;
  benefits: FairJobRevisionInputV2["benefits"];
  inclusionStatement: string | null;
  applicationContactKind: FairJobRevisionInputV2["applicationContactKind"];
  applicationContactValue: string;
  validThrough: string | null;
}>;

export type FairJobInputSnapshotV2 = Readonly<{
  schemaVersion: typeof FAIR_JOB_INPUT_SNAPSHOT_SCHEMA_V2;
  scoreVersion: typeof FAIR_JOB_SCORE_VERSION;
  job: Readonly<{ id: string }>;
  revision: SerializedFairJobRevisionV2;
  derivedInput: SerializedFairJobInputV2;
  clock: Readonly<{ now: string }>;
}>;

export type FairJobFactorBreakdownV2 = Readonly<
  Record<
    FairJobFactorV2,
    Readonly<{
      state: FairJobEvidenceState;
      pointsAwarded: number;
      maxPoints: number;
      reasonCode: FairJobReasonCodeV2;
    }>
  >
>;

export type FairJobScoreSnapshotRecordV2 = Readonly<{
  jobRevisionId: string;
  scoreVersion: typeof FAIR_JOB_SCORE_VERSION;
  scorePoints: number;
  maxPoints: 100;
  inputSnapshot: FairJobInputSnapshotV2;
  evidence: FairJobResult["evidence"];
  factorBreakdown: FairJobFactorBreakdownV2;
  evidenceHash: string;
  calculatedAt: Date;
}>;

export type FairJobScoreSnapshotWritePort<TRow> = Readonly<{
  jobScoreSnapshot: Readonly<{
    create(
      input: Readonly<{
        data: FairJobScoreSnapshotRecordV2;
      }>,
    ): Promise<TRow>;
  }>;
}>;

type SnapshotHashFields = Pick<
  FairJobScoreSnapshotRecordV2,
  | "jobRevisionId"
  | "scoreVersion"
  | "scorePoints"
  | "maxPoints"
  | "inputSnapshot"
  | "evidence"
  | "factorBreakdown"
>;

export function buildFairJobScoreSnapshotV2(
  args: BuildFairJobInputV2Args & Readonly<{ clock: Readonly<{ now: Date }> }>,
): FairJobScoreSnapshotRecordV2 {
  const input = buildFairJobInputV2(args);
  const result = calculateFairJobScoreV2(input, args.clock);
  const inputSnapshot = deepFreezeJson({
    schemaVersion: FAIR_JOB_INPUT_SNAPSHOT_SCHEMA_V2,
    scoreVersion: FAIR_JOB_SCORE_VERSION,
    job: { id: args.job.id },
    revision: serializeRevision(args.revision),
    derivedInput: serializeInput(input),
    clock: { now: serializeRequiredDate(args.clock.now, "clock.now") },
  } satisfies FairJobInputSnapshotV2);
  const evidence = deepFreezeJson({ ...result.evidence });
  const factorBreakdown = buildFactorBreakdown(result);
  const hashFields: SnapshotHashFields = {
    jobRevisionId: args.revision.id,
    scoreVersion: FAIR_JOB_SCORE_VERSION,
    scorePoints: result.score,
    maxPoints: 100,
    inputSnapshot,
    evidence,
    factorBreakdown,
  };

  return {
    ...hashFields,
    evidenceHash: hashSnapshotFields(hashFields),
    calculatedAt: new Date(args.clock.now.getTime()),
  };
}

/**
 * Persists the immutable builder input and its result in one insert. Pass the
 * surrounding publication transaction here so Revision approval/publication
 * and its score evidence commit or roll back together.
 */
export async function writeFairJobScoreSnapshotV2<TRow>(
  port: FairJobScoreSnapshotWritePort<TRow>,
  args: BuildFairJobInputV2Args & Readonly<{ clock: Readonly<{ now: Date }> }>,
): Promise<TRow> {
  const data = buildFairJobScoreSnapshotV2(args);
  return port.jobScoreSnapshot.create({ data });
}

export function calculateFairJobScoreFromSnapshotV2(
  snapshot: FairJobInputSnapshotV2,
): FairJobResult {
  if (
    snapshot.schemaVersion !== FAIR_JOB_INPUT_SNAPSHOT_SCHEMA_V2 ||
    snapshot.scoreVersion !== FAIR_JOB_SCORE_VERSION
  ) {
    throw new TypeError("Unsupported Fair Job Score input snapshot version.");
  }

  return calculateFairJobScoreV2(deserializeInput(snapshot.derivedInput), {
    now: parseRequiredIsoDate(snapshot.clock.now, "snapshot.clock.now"),
  });
}

export function verifyFairJobScoreSnapshotHashV2(
  snapshot: FairJobScoreSnapshotRecordV2,
): boolean {
  const hashFields: SnapshotHashFields = {
    jobRevisionId: snapshot.jobRevisionId,
    scoreVersion: snapshot.scoreVersion,
    scorePoints: snapshot.scorePoints,
    maxPoints: snapshot.maxPoints,
    inputSnapshot: snapshot.inputSnapshot,
    evidence: snapshot.evidence,
    factorBreakdown: snapshot.factorBreakdown,
  };
  return hashSnapshotFields(hashFields) === snapshot.evidenceHash;
}

function serializeRevision(
  revision: FairJobRevisionInputV2,
): SerializedFairJobRevisionV2 {
  return {
    id: revision.id,
    jobId: revision.jobId,
    salaryPeriod: revision.salaryPeriod,
    salaryMin: revision.salaryMin,
    salaryMax: revision.salaryMax,
    tasks: [...revision.tasks],
    requirements: [...revision.requirements],
    workloadMin: revision.workloadMin,
    workloadMax: revision.workloadMax,
    jobType: revision.jobType,
    startDate: serializeOptionalDate(revision.startDate),
    startByArrangement: revision.startByArrangement,
    remoteType: revision.remoteType,
    cantonId: revision.cantonId,
    cityId: revision.cityId,
    remoteCountryCode: revision.remoteCountryCode,
    applicationEffort: revision.applicationEffort,
    applicationProcessSteps: [...revision.applicationProcessSteps],
    requiredDocumentKinds: [...revision.requiredDocumentKinds],
    responseTargetDays: revision.responseTargetDays,
    benefits: revision.benefits.map((benefit) => ({ ...benefit })),
    inclusionStatement: revision.inclusionStatement,
    applicationContactKind: revision.applicationContactKind,
    applicationContactValue: revision.applicationContactValue,
    validThrough: serializeOptionalDate(revision.validThrough),
  };
}

function serializeInput(input: FairJobInput): SerializedFairJobInputV2 {
  return {
    salaryRange: input.salaryRange === null ? null : { ...input.salaryRange },
    tasksAndRequirementsClarity: input.tasksAndRequirementsClarity,
    workloadContractAndStartDefined: input.workloadContractAndStartDefined,
    locationAndRemoteDefined: input.locationAndRemoteDefined,
    applicationProcessDefined: input.applicationProcessDefined,
    responseTargetDays: input.responseTargetDays,
    concreteBenefitsCount: input.concreteBenefitsCount,
    inclusionAndContactDefined: input.inclusionAndContactDefined,
    validThrough: serializeOptionalDate(input.validThrough),
  };
}

function deserializeInput(input: SerializedFairJobInputV2): FairJobInput {
  return {
    salaryRange: input.salaryRange === null ? null : { ...input.salaryRange },
    tasksAndRequirementsClarity: input.tasksAndRequirementsClarity,
    workloadContractAndStartDefined: input.workloadContractAndStartDefined,
    locationAndRemoteDefined: input.locationAndRemoteDefined,
    applicationProcessDefined: input.applicationProcessDefined,
    responseTargetDays: input.responseTargetDays,
    concreteBenefitsCount: input.concreteBenefitsCount,
    inclusionAndContactDefined: input.inclusionAndContactDefined,
    validThrough:
      input.validThrough === null
        ? null
        : parseRequiredIsoDate(input.validThrough, "snapshot.validThrough"),
  };
}

function buildFactorBreakdown(result: FairJobResult): FairJobFactorBreakdownV2 {
  return Object.fromEntries(
    FAIR_JOB_FACTOR_ORDER_V2.map((factor) => {
      const state = result.evidence[factor];
      const pointsAwarded =
        state === "MET"
          ? FAIR_JOB_FACTOR_POINTS_V2[factor]
          : factor === "TASKS_REQUIREMENTS" && state === "PARTIAL"
            ? 8
            : 0;
      return [
        factor,
        {
          state,
          pointsAwarded,
          maxPoints: FAIR_JOB_FACTOR_POINTS_V2[factor],
          reasonCode: `${factor}_${state}` as FairJobReasonCodeV2,
        },
      ];
    }),
  ) as FairJobFactorBreakdownV2;
}

function hashSnapshotFields(fields: SnapshotHashFields): string {
  return createHash("sha256")
    .update(canonicalJson(fields), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Snapshot contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new TypeError("Snapshot contains a non-JSON value.");
}

function serializeOptionalDate(value: Date | null): string | null {
  return value === null ? null : serializeRequiredDate(value, "date");
}

function serializeRequiredDate(value: Date, label: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
  return value.toISOString();
}

function parseRequiredIsoDate(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  return parsed;
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}
