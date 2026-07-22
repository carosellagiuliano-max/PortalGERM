import type { JobType, RemoteType, SalaryPeriod } from "@/lib/generated/prisma/enums";

export type JobSearchSort = "relevance" | "newest" | "fair-score" | "salary" | "response";

export type PublicJobProjection = Readonly<{
  id: string;
  slug: string;
  companyId: string;
  companyName: string;
  title: string;
  description: string;
  publishedAt: Date;
  expiresAt: Date;
  fairScore: number | null;
  responseTargetDays: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod | null;
  categoryId: string;
  cantonId: string | null;
  cityId: string | null;
  remoteType: RemoteType;
  jobType: JobType;
  workloadMin: number;
  workloadMax: number;
}>;

export type RankingCandidate = PublicJobProjection & Readonly<{
  relevanceScore: number;
  relevanceTier: number;
  activeBoost: boolean;
  responseEvidenceKnown: boolean;
  onTimeRateBps: number | null;
  medianFirstResponseMinutes: number | null;
}>;

export type RankedJob = Readonly<{
  job: RankingCandidate;
  sponsored: boolean;
  label: "Gesponsert" | null;
}>;

type StableCursorTail = Readonly<{
  publishedAt: string;
  id: string;
}>;

export type OrganicCursorTuple =
  | (StableCursorTail & Readonly<{
      sort: "relevance";
      relevanceTier: number;
      relevanceScore: number;
      fairScore: number | null;
    }>)
  | (StableCursorTail & Readonly<{
      sort: "newest";
    }>)
  | (StableCursorTail & Readonly<{
      sort: "fair-score";
      fairScore: number | null;
    }>)
  | (StableCursorTail & Readonly<{
      sort: "salary";
      salaryMinChf: number | null;
      salaryMaxChf: number | null;
    }>)
  | (StableCursorTail & Readonly<{
      sort: "response";
      responseEvidenceKnown: boolean;
      onTimeRateBps: number | null;
      medianFirstResponseMinutes: number | null;
    }>);
