export type JobroomReportingResult =
  | "REQUIRES_REPORTING"
  | "NOT_REQUIRED"
  | "UNKNOWN";

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
    cantonCode?: string;
  }): Promise<ReportingObligationCheckResult>;
  submitJob(input: unknown): Promise<{
    accepted: false;
    reason: "not_implemented_in_mvp";
  }>;
}
