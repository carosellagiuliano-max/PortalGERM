import type { PublicJobCardModel } from "@/lib/public/types";
import type { PublicSalaryRadarResult } from "@/lib/salary/public-radar";

export type PublicSalaryRadarActionState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "result";
      result: PublicSalaryRadarResult;
      jobs: readonly PublicJobCardModel[];
    }>;

export const INITIAL_PUBLIC_SALARY_RADAR_STATE: PublicSalaryRadarActionState = Object.freeze({
  status: "idle",
});
