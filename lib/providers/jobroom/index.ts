import type { JobroomProvider } from "./jobroom-provider";
import { MockJobroomProvider } from "./mock-jobroom-provider";
import type { ApplicationEnvironment } from "@/lib/config/application-environment";
import { isIsolatedSandboxEnvironment } from "@/lib/config/application-environment";

export type {
  JobroomProvider,
  JobroomReasonCode,
  JobroomReportingResult,
  ReportingObligationCheckResult,
} from "./jobroom-provider";
export { JOBROOM_REASON_CODES } from "./jobroom-provider";
export { MockJobroomProvider } from "./mock-jobroom-provider";

const localMockJobroomProvider: JobroomProvider = new MockJobroomProvider();

/**
 * The versioned fixture remains available for Local/CI evidence only. It is
 * never a silent substitute for an official production reporting check.
 */
export function resolveJobroomProvider(
  environment: ApplicationEnvironment,
): JobroomProvider | undefined {
  return isIsolatedSandboxEnvironment(environment)
    ? localMockJobroomProvider
    : undefined;
}
