import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";

export type EmployerActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message?: string;
  nextIdempotencyKey?: string;
  upgradePrompt?: UpgradePrompt;
}>;

export const INITIAL_EMPLOYER_ACTION_STATE: EmployerActionState = Object.freeze({
  status: "idle",
});
