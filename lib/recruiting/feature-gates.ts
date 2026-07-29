import type { ServerEnvironment } from "@/lib/config/env-schema";

export const RECRUITING_FEATURE_MODES_V1 = [
  "disabled",
  "test",
  "allowlist",
  "live",
] as const;

export type RecruitingFeatureModeV1 =
  (typeof RECRUITING_FEATURE_MODES_V1)[number];

export type RecruitingFeatureKeyV1 =
  | "external_application_tracker"
  | "interview_scheduler";

export function recruitingFeatureModeV1(
  environment: Pick<
    ServerEnvironment,
    "EXTERNAL_APPLICATION_TRACKER" | "INTERVIEW_SCHEDULER"
  >,
  feature: RecruitingFeatureKeyV1,
): RecruitingFeatureModeV1 {
  return feature === "external_application_tracker"
    ? environment.EXTERNAL_APPLICATION_TRACKER
    : environment.INTERVIEW_SCHEDULER;
}

export function isRecruitingFeatureAvailableV1(
  environment: Pick<
    ServerEnvironment,
    "EXTERNAL_APPLICATION_TRACKER" | "INTERVIEW_SCHEDULER"
  >,
  feature: RecruitingFeatureKeyV1,
): boolean {
  return recruitingFeatureModeV1(environment, feature) !== "disabled";
}

export const RECRUITING_FEATURE_UNAVAILABLE = "FEATURE_UNAVAILABLE" as const;
