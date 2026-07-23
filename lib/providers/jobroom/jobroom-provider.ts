export type JobroomReportingResult =
  | "REQUIRES_REPORTING"
  | "NOT_REQUIRED"
  | "UNKNOWN";

export const JOBROOM_REASON_CODES = [
  "REPORTING_REQUIRED",
  "REPORTING_NOT_REQUIRED",
  "SOURCE_RESULT_UNKNOWN",
  "MISSING_OCCUPATION_CODE",
  "OCCUPATION_CODE_NOT_FOUND",
  "AMBIGUOUS_OCCUPATION_CODE",
  "STALE_DATASET",
  "STALE_OCCUPATION_CODE",
  "UNSUPPORTED_CANTON",
  "INVALID_INPUT",
  "INVALID_FIXTURE_DATA",
  "UNSUPPORTED_SOURCE_RESULT",
] as const;
export type JobroomReasonCode = (typeof JOBROOM_REASON_CODES)[number];

export interface ReportingObligationCheckResult {
  result: JobroomReportingResult;
  reasonCode: string;
  disclaimer: string;
  datasetVersion: string;
  dataYear: number;
  sourceUrl: string;
}

export interface JobroomProvider {
  checkReportingObligation(input: {
    occupationCodeId?: string;
    occupationCode?: string;
    cantonCode?: string;
  }): Promise<ReportingObligationCheckResult>;
  submitJob(input: unknown): Promise<{
    accepted: false;
    reason: "not_implemented_in_mvp";
  }>;
}
