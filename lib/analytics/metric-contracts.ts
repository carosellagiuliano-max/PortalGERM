import type { DataProvenance } from "@/lib/generated/prisma/enums";

export const BASIS_POINTS_SCALE = 10_000;
export const ANALYTICS_MINIMUM_COHORT_SIZE_V1 = 20;

export const ANALYTICS_BREAKDOWN_DIMENSIONS_V1 = Object.freeze([
  "ALL",
  "CANTON",
  "CATEGORY",
  "CANTON_CATEGORY",
  "COMPANY",
  "JOB",
] as const);

export type AnalyticsBreakdownDimensionV1 =
  (typeof ANALYTICS_BREAKDOWN_DIMENSIONS_V1)[number];

/**
 * There is intentionally only one roll-up route for every dimension. A caller
 * cannot choose a more convenient parent after seeing a suppressed result.
 */
export const ANALYTICS_PARENT_DIMENSION_V1 = Object.freeze({
  ALL: null,
  CANTON: "ALL",
  CATEGORY: "ALL",
  CANTON_CATEGORY: "CANTON",
  COMPANY: "ALL",
  JOB: "COMPANY",
} as const satisfies Record<
  AnalyticsBreakdownDimensionV1,
  AnalyticsBreakdownDimensionV1 | null
>);

export type HalfOpenWindow = Readonly<{
  from: Date;
  to: Date;
}>;

export type VisibleMetricCell = Readonly<{
  status: "VALUE";
  numerator: number;
  denominator: number;
  valueBps: number;
}>;

export type SuppressedMetricCell = Readonly<{
  status: "SUPPRESSED";
  numerator: "SUPPRESSED";
  denominator: "SUPPRESSED";
  valueBps: "SUPPRESSED";
}>;

export type MetricCell = VisibleMetricCell | SuppressedMetricCell;

export type AnalyticsCohortObservation = Readonly<{
  subjectId: string;
  qualifies: boolean;
}>;

export type AnalyticsMetricSegmentV1 = Readonly<{
  dimension: AnalyticsBreakdownDimensionV1;
  key: string;
  parentKey: string | null;
  observations: readonly AnalyticsCohortObservation[];
}>;

export type MetricDisclosureV1 = Readonly<{
  dimension: AnalyticsBreakdownDimensionV1;
  key: string;
  rolledUpFrom: Readonly<{
    dimension: AnalyticsBreakdownDimensionV1;
    key: string;
  }> | null;
  cell: MetricCell;
}>;

export function isInHalfOpenWindow(at: Date, window: HalfOpenWindow) {
  return at.getTime() >= window.from.getTime() && at.getTime() < window.to.getTime();
}

export function isLiveProvenance(provenance: DataProvenance | undefined) {
  return provenance === "LIVE";
}

export function roundHalfUp(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("roundHalfUp accepts only finite non-negative values.");
  }

  return Math.floor(value + 0.5);
}

export function ratioToBasisPoints(numerator: number, denominator: number) {
  assertNonNegativeInteger(numerator, "numerator");
  assertNonNegativeInteger(denominator, "denominator");
  if (denominator === 0 || numerator > denominator) {
    throw new RangeError("A metric ratio requires 0 <= numerator <= denominator and denominator > 0.");
  }

  return roundHalfUp((numerator / denominator) * BASIS_POINTS_SCALE);
}

export function medianInteger(values: readonly number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].map((value) => {
    assertNonNegativeInteger(value, "median value");
    return value;
  }).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) {
    throw new Error("Median bounds are unexpectedly missing.");
  }
  return roundHalfUp((left + right) / 2);
}

export function buildSuppressedMetricCellV1(
  observations: readonly AnalyticsCohortObservation[],
): MetricCell {
  const bySubject = observationsBySubject(observations);

  if (bySubject.size < ANALYTICS_MINIMUM_COHORT_SIZE_V1) {
    return suppressedMetricCell();
  }

  const numerator = [...bySubject.values()].filter(Boolean).length;
  return Object.freeze({
    status: "VALUE",
    numerator,
    denominator: bySubject.size,
    valueBps: ratioToBasisPoints(numerator, bySubject.size),
  });
}

export function selectSafeParentRollupV1(
  child: AnalyticsMetricSegmentV1,
  parent: AnalyticsMetricSegmentV1 | undefined,
  releasedSiblings: readonly AnalyticsMetricSegmentV1[] = [],
): MetricDisclosureV1 {
  const childCell = buildSuppressedMetricCellV1(child.observations);
  if (childCell.status === "VALUE") {
    return metricDisclosure(child, childCell, null);
  }

  if (!isDeclaredParent(child, parent)) {
    return metricDisclosure(child, childCell, null);
  }

  const parentCell = buildSuppressedMetricCellV1(parent.observations);
  if (parentCell.status === "SUPPRESSED") {
    return metricDisclosure(child, childCell, null);
  }

  const parentSubjects = subjectIds(parent.observations);
  const childSubjects = subjectIds(child.observations);
  if (!isSubset(childSubjects, parentSubjects)) {
    return metricDisclosure(child, childCell, null);
  }

  const releasedSubjectIds = new Set<string>();
  for (const sibling of releasedSiblings) {
    if (
      sibling.dimension !== child.dimension ||
      sibling.key === child.key ||
      sibling.parentKey !== child.parentKey ||
      buildSuppressedMetricCellV1(sibling.observations).status !== "VALUE"
    ) {
      continue;
    }
    const siblingSubjects = subjectIds(sibling.observations);
    if (!isSubset(siblingSubjects, parentSubjects)) {
      return metricDisclosure(child, childCell, null);
    }
    for (const subjectId of siblingSubjects) {
      releasedSubjectIds.add(subjectId);
    }
  }

  const parentRemainder = new Set(
    [...parentSubjects].filter((subjectId) => !releasedSubjectIds.has(subjectId)),
  );
  if (
    releasedSubjectIds.size > 0 &&
    setsEqual(parentRemainder, childSubjects)
  ) {
    return metricDisclosure(child, childCell, null);
  }

  return metricDisclosure(parent, parentCell, {
    dimension: child.dimension,
    key: child.key,
  });
}

/**
 * A complement is withheld whenever it could be subtracted from a visible
 * parent to recover a suppressed direct child.
 */
export function buildProtectedComplementMetricCellV1(
  parent: AnalyticsMetricSegmentV1,
  excludedChildren: readonly AnalyticsMetricSegmentV1[],
): MetricCell {
  const parentCell = buildSuppressedMetricCellV1(parent.observations);
  if (parentCell.status === "SUPPRESSED" || excludedChildren.length === 0) {
    return suppressedMetricCell();
  }

  const parentSubjects = subjectIds(parent.observations);
  const excludedSubjectIds = new Set<string>();
  for (const child of excludedChildren) {
    if (
      !isDeclaredParent(child, parent) ||
      buildSuppressedMetricCellV1(child.observations).status === "SUPPRESSED"
    ) {
      return suppressedMetricCell();
    }
    const childSubjects = subjectIds(child.observations);
    if (!isSubset(childSubjects, parentSubjects)) {
      return suppressedMetricCell();
    }
    for (const subjectId of childSubjects) {
      excludedSubjectIds.add(subjectId);
    }
  }

  return buildSuppressedMetricCellV1(
    parent.observations.filter(
      (observation) => !excludedSubjectIds.has(observation.subjectId),
    ),
  );
}

function isDeclaredParent(
  child: AnalyticsMetricSegmentV1,
  parent: AnalyticsMetricSegmentV1 | undefined,
): parent is AnalyticsMetricSegmentV1 {
  return parent !== undefined &&
    ANALYTICS_PARENT_DIMENSION_V1[child.dimension] === parent.dimension &&
    child.parentKey !== null &&
    child.parentKey === parent.key;
}

function observationsBySubject(
  observations: readonly AnalyticsCohortObservation[],
) {
  const bySubject = new Map<string, boolean>();
  for (const observation of observations) {
    if (observation.subjectId.length === 0) {
      continue;
    }
    bySubject.set(
      observation.subjectId,
      (bySubject.get(observation.subjectId) ?? false) || observation.qualifies,
    );
  }
  return bySubject;
}

function subjectIds(observations: readonly AnalyticsCohortObservation[]) {
  return new Set(observationsBySubject(observations).keys());
}

function isSubset(values: ReadonlySet<string>, parent: ReadonlySet<string>) {
  return [...values].every((value) => parent.has(value));
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && isSubset(left, right);
}

function suppressedMetricCell(): SuppressedMetricCell {
  return Object.freeze({
    status: "SUPPRESSED",
    numerator: "SUPPRESSED",
    denominator: "SUPPRESSED",
    valueBps: "SUPPRESSED",
  });
}

function metricDisclosure(
  segment: AnalyticsMetricSegmentV1,
  cell: MetricCell,
  rolledUpFrom: MetricDisclosureV1["rolledUpFrom"],
): MetricDisclosureV1 {
  return Object.freeze({
    dimension: segment.dimension,
    key: segment.key,
    rolledUpFrom: rolledUpFrom === null ? null : Object.freeze(rolledUpFrom),
    cell,
  });
}

function assertNonNegativeInteger(value: number, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}
