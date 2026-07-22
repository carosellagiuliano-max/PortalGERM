import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";

export type TalentRadarActionState = Readonly<{
  status: "idle" | "success" | "error";
  message?: string;
  requestId?: string;
  nextIdempotencyKey?: string;
  upgradePrompt?: UpgradePrompt;
}>;

export const INITIAL_TALENT_RADAR_ACTION_STATE: TalentRadarActionState =
  Object.freeze({ status: "idle" });
