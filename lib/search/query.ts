import { createHash } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";
import { JobType, RemoteType, SalaryPeriod } from "@/lib/generated/prisma/enums";
import { z } from "zod";

import type { JobSearchFilters, JobSearchSort } from "@/lib/search/types";

export const jobSearchFiltersSchema = z
  .object({
    query: z.string().trim().min(1).max(120).optional(),
    categoryIds: z.array(z.uuid()).max(20).optional(),
    cantonIds: z.array(z.uuid()).max(26).optional(),
    jobTypes: z.array(z.enum(JobType)).max(6).optional(),
    remoteTypes: z.array(z.enum(RemoteType)).max(3).optional(),
    workloadMin: z.number().int().min(0).max(100).optional(),
    workloadMax: z.number().int().min(0).max(100).optional(),
    salaryMin: z.number().int().positive().optional(),
    salaryPeriod: z.enum(SalaryPeriod).optional(),
    sort: z.enum(["relevance", "newest", "fair-score", "salary", "response"]).default("relevance"),
    pageSize: z.number().int().min(1).max(50).default(20),
    after: z.string().min(1).max(4_096).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.workloadMin !== undefined && value.workloadMax !== undefined && value.workloadMin > value.workloadMax) {
      context.addIssue({ code: "custom", path: ["workloadMax"], message: "Invalid workload range." });
    }
    if ((value.salaryMin === undefined) !== (value.salaryPeriod === undefined)) {
      context.addIssue({ code: "custom", path: ["salaryPeriod"], message: "Salary amount and period belong together." });
    }
    if (value.sort === "salary" && value.salaryPeriod === undefined) {
      context.addIssue({ code: "custom", path: ["salaryPeriod"], message: "Salary sorting requires an explicit period." });
    }
  });

export function buildJobSearchWhere(filters: JobSearchFilters): Prisma.JobWhereInput {
  const revision: Prisma.JobRevisionWhereInput = {};
  if (filters.query) {
    revision.OR = [
      { title: { contains: filters.query, mode: "insensitive" } },
      { description: { contains: filters.query, mode: "insensitive" } },
      { job: { company: { name: { contains: filters.query, mode: "insensitive" } } } },
    ];
  }
  if (filters.categoryIds?.length) revision.categoryId = { in: [...new Set(filters.categoryIds)] };
  if (filters.cantonIds?.length) revision.cantonId = { in: [...new Set(filters.cantonIds)] };
  if (filters.jobTypes?.length) revision.jobType = { in: [...new Set(filters.jobTypes)] };
  if (filters.remoteTypes?.length) revision.remoteType = { in: [...new Set(filters.remoteTypes)] };
  if (filters.workloadMin !== undefined) revision.workloadMax = { gte: filters.workloadMin };
  if (filters.workloadMax !== undefined) revision.workloadMin = { lte: filters.workloadMax };
  if (filters.salaryMin !== undefined && filters.salaryPeriod !== undefined) {
    revision.salaryPeriod = filters.salaryPeriod;
    revision.salaryMax = { gte: filters.salaryMin };
  }
  return { publishedRevision: { is: revision } };
}

export function organicSortOrder(sort: JobSearchSort): readonly string[] {
  switch (sort) {
    case "relevance": return [
      "relevanceTier:desc",
      "relevanceScore:desc",
      "fairScore:desc:nulls-last",
      "publishedAt:desc",
      "id:asc",
    ];
    case "newest": return ["publishedAt:desc", "id:asc"];
    case "fair-score": return ["fairScore:desc:nulls-last", "publishedAt:desc", "id:asc"];
    case "salary": return [
      "salaryMinChf:desc:nulls-last",
      "salaryMaxChf:desc:nulls-last",
      "publishedAt:desc",
      "id:asc",
    ];
    case "response": return [
      "responseEvidenceKnown:desc",
      "onTimeRateBps:desc",
      "medianFirstResponseMinutes:asc:nulls-last",
      "publishedAt:desc",
      "id:asc",
    ];
  }
}

function canonicalSet(values: readonly string[] | undefined): readonly string[] {
  return values === undefined ? [] : [...new Set(values)].sort();
}

/**
 * Binds a cursor to every value that can change membership or ordering.
 * Page size is deliberately excluded so a client may request a smaller next page
 * without changing the result-set identity.
 */
export function createSearchQueryHashV1(filters: JobSearchFilters): string {
  const canonical = {
    version: "v1",
    query: filters.query?.trim().normalize("NFKC").toLowerCase() ?? null,
    categoryIds: canonicalSet(filters.categoryIds),
    cantonIds: canonicalSet(filters.cantonIds),
    jobTypes: canonicalSet(filters.jobTypes),
    remoteTypes: canonicalSet(filters.remoteTypes),
    workloadMin: filters.workloadMin ?? null,
    workloadMax: filters.workloadMax ?? null,
    salaryMin: filters.salaryMin ?? null,
    salaryPeriod: filters.salaryPeriod ?? null,
    sort: filters.sort,
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}
