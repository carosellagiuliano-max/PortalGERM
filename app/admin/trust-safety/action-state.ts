export type TrustSafetyActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message: string;
}>;

export const INITIAL_TRUST_SAFETY_ACTION_STATE: TrustSafetyActionState =
  Object.freeze({ status: "idle", message: "" });
