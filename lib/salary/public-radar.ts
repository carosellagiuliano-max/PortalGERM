import "server-only";

import { Seniority } from "@/lib/generated/prisma/enums";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import type { SalaryRadarQuery } from "@/lib/public/types";
import {
  getPublicDataContext,
  type PublicDataContext,
} from "@/lib/public/environment";
import {
  SALARY_RADAR_POLICY_V1,
  selectSalaryRadarBandV1,
  type SalaryRadarResultV1,
} from "@/lib/salary/policy-v1";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { z } from "zod";

export const PUBLIC_SALARY_DATASET_KEY = "SWISSTALENTHUB_SALARY_MOCK";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const workloadSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return /^\d{1,3}$/u.test(normalized) ? Number(normalized) : value;
}, z.number().int().min(20).max(100));

const optionalJobTitleSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().normalize("NFKC");
  return normalized.length === 0 ? undefined : normalized;
}, z.string().max(120).optional());

const publicSalaryRadarInputSchema = z.object({
  jobTitle: optionalJobTitleSchema,
  categorySlug: z.string().trim().max(160).regex(SLUG_PATTERN),
  cantonSlug: z.string().trim().max(120).regex(SLUG_PATTERN),
  seniority: z.enum(Seniority),
  workload: workloadSchema,
}).strict();

export type PublicSalaryRadarInput = Readonly<{
  jobTitle?: string;
  categorySlug: string;
  cantonSlug: string;
  seniority: Seniority;
  workload: number | string;
}>;

export type PublicSalaryRadarResult =
  | Readonly<{
      status: "FOUND";
      p25Chf: number;
      medianChf: number;
      p75Chf: number;
      adjustedP25Chf: number;
      adjustedMedianChf: number;
      adjustedP75Chf: number;
      period: "YEARLY_FTE";
      source: string;
      datasetVersion: string;
      asOf: Date;
      method: string;
      fallbackScope: (typeof SALARY_RADAR_POLICY_V1.fallbackOrder)[number];
      sampleBucket: "30–49" | "50–99" | "100+";
    }>
  | Readonly<{
      status: "NO_RESULT";
      reason: Extract<SalaryRadarResultV1, { status: "NO_RESULT" }>["reason"];
      adjacentCategoryGuidance: boolean;
    }>;

/**
 * Parses the allowlisted public form payload. The dataset is deliberately not a
 * client-controlled field and the decorative job title is never mapped to a
 * category.
 */
export function parsePublicSalaryRadarQuery(
  input: unknown,
): SalaryRadarQuery | null {
  const raw = formDataToStrictObject(input);
  if (raw === null) return null;
  const parsed = publicSalaryRadarInputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const title = parsed.data.jobTitle === undefined
    ? undefined
    : stripUnsafeHtml(parsed.data.jobTitle);
  return Object.freeze({
    datasetKey: PUBLIC_SALARY_DATASET_KEY,
    categorySlug: parsed.data.categorySlug,
    cantonSlug: parsed.data.cantonSlug,
    seniority: parsed.data.seniority,
    workloadMin: parsed.data.workload,
    workloadMax: parsed.data.workload,
    ...(title === undefined || title.length === 0 ? {} : { jobTitle: title }),
  });
}

export function buildSalaryPolicyQuery(
  query: SalaryRadarQuery,
  resolved: Readonly<{ categoryId: string; cantonId: string; at: Date }>,
) {
  return Object.freeze({
    datasetKey: query.datasetKey,
    categoryId: resolved.categoryId,
    cantonId: resolved.cantonId,
    seniority: query.seniority,
    workloadMin: query.workloadMin,
    workloadMax: query.workloadMax,
    at: new Date(resolved.at),
  });
}

/** Maps the internal salary policy result onto the phase-07 public allowlist. */
export function toPublicSalaryRadarResult(
  result: SalaryRadarResultV1,
): PublicSalaryRadarResult {
  if (result.status === "NO_RESULT") {
    return Object.freeze({
      status: "NO_RESULT",
      reason: result.reason,
      adjacentCategoryGuidance: result.adjacentCategoryGuidance,
    });
  }
  if (
    result.workloadAdjustedBand.workloadMin !==
    result.workloadAdjustedBand.workloadMax
  ) {
    throw new RangeError("The public salary radar requires one workload value.");
  }

  return Object.freeze({
    status: "FOUND",
    p25Chf: result.fteBand.p25Chf,
    medianChf: result.fteBand.medianChf,
    p75Chf: result.fteBand.p75Chf,
    adjustedP25Chf: result.workloadAdjustedBand.atMinimum.p25Chf,
    adjustedMedianChf: result.workloadAdjustedBand.atMinimum.medianChf,
    adjustedP75Chf: result.workloadAdjustedBand.atMinimum.p75Chf,
    period: "YEARLY_FTE",
    source: stripUnsafeHtml(result.source),
    datasetVersion: stripUnsafeHtml(result.datasetVersion),
    asOf: new Date(result.dataAsOf),
    method: stripUnsafeHtml(result.methodology),
    fallbackScope: result.scope,
    sampleBucket: result.sampleSizeBucket,
  });
}

export async function loadPublicSalaryRadar(
  query: SalaryRadarQuery,
  options: Readonly<{
    now?: Date;
    database?: DatabaseClient;
    dataContext?: Pick<PublicDataContext, "liveOnly">;
  }> = {},
): Promise<PublicSalaryRadarResult> {
  const now = validNow(options.now);
  if (!isValidQuery(query) || query.datasetKey !== PUBLIC_SALARY_DATASET_KEY) {
    return noResult("INVALID_QUERY", false);
  }
  const dataContext = options.dataContext ?? getPublicDataContext();
  if (dataContext.liveOnly) {
    // Phase 05 intentionally provides only a fictional product-test dataset.
    // Production/staging must stay empty until a separately approved real
    // dataset key and review contract are introduced.
    return noResult("NO_EFFECTIVE_DATASET", false);
  }
  const database = options.database ?? getDatabase();
  const [category, canton] = await Promise.all([
    database.category.findUnique({
      where: { slug: query.categorySlug },
      select: { id: true, isActive: true },
    }),
    database.canton.findUnique({
      where: { slug: query.cantonSlug },
      select: { id: true },
    }),
  ]);
  if (category === null || !category.isActive || canton === null) {
    return noResult("INVALID_QUERY", false);
  }

  const datasets = await database.salaryDatasetVersion.findMany({
    where: {
      datasetKey: query.datasetKey,
      locale: "de-CH",
      reviewStatus: "APPROVED",
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    select: {
      id: true,
      datasetKey: true,
      version: true,
      source: true,
      methodology: true,
      dataAsOf: true,
      validFrom: true,
      validTo: true,
      reviewStatus: true,
      bands: {
        where: {
          categoryId: category.id,
          workloadMin: SALARY_RADAR_POLICY_V1.workloadBasis,
          workloadMax: SALARY_RADAR_POLICY_V1.workloadBasis,
          period: SALARY_RADAR_POLICY_V1.period,
          OR: [
            { cantonId: canton.id, seniority: query.seniority },
            { cantonId: canton.id, seniority: null },
            { cantonId: null, seniority: query.seniority },
            { cantonId: null, seniority: null },
          ],
        },
        select: {
          id: true,
          categoryId: true,
          cantonId: true,
          seniority: true,
          workloadMin: true,
          workloadMax: true,
          period: true,
          p25Chf: true,
          medianChf: true,
          p75Chf: true,
          sampleSize: true,
        },
      },
    },
  });
  const policyResult = selectSalaryRadarBandV1(
    datasets,
    buildSalaryPolicyQuery(query, {
      categoryId: category.id,
      cantonId: canton.id,
      at: now,
    }),
  );
  return toPublicSalaryRadarResult(policyResult);
}

function formDataToStrictObject(input: unknown): unknown {
  if (typeof FormData === "undefined" || !(input instanceof FormData)) {
    return input;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of input.entries()) {
    if (Object.hasOwn(result, key) || typeof value !== "string") return null;
    result[key] = value;
  }
  return result;
}

function isValidQuery(query: SalaryRadarQuery): boolean {
  return SLUG_PATTERN.test(query.categorySlug) &&
    query.categorySlug.length <= 160 &&
    SLUG_PATTERN.test(query.cantonSlug) &&
    query.cantonSlug.length <= 120 &&
    Object.values(Seniority).includes(query.seniority) &&
    Number.isSafeInteger(query.workloadMin) &&
    Number.isSafeInteger(query.workloadMax) &&
    query.workloadMin >= 20 &&
    query.workloadMin === query.workloadMax &&
    query.workloadMax <= 100;
}

function validNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("A valid salary radar clock is required.");
  }
  return new Date(now);
}

function noResult(
  reason: Extract<SalaryRadarResultV1, { status: "NO_RESULT" }>["reason"],
  adjacentCategoryGuidance: boolean,
): PublicSalaryRadarResult {
  return Object.freeze({ status: "NO_RESULT", reason, adjacentCategoryGuidance });
}
