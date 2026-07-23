import type { JobroomProvider } from "./jobroom-provider";
import { MockJobroomProvider } from "./mock-jobroom-provider";

export type {
  JobroomProvider,
  JobroomReasonCode,
  JobroomReportingResult,
  ReportingObligationCheckResult,
} from "./jobroom-provider";
export { JOBROOM_REASON_CODES } from "./jobroom-provider";
export { MockJobroomProvider } from "./mock-jobroom-provider";

/** Explicit Phase-04 composition root: no environment key can select a real API. */
export const jobroomProvider: JobroomProvider = new MockJobroomProvider();
