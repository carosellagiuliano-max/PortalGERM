export type AdminPrivacyCaseActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  code?: string;
}>;

export const INITIAL_ADMIN_PRIVACY_CASE_ACTION_STATE: AdminPrivacyCaseActionState =
  Object.freeze({ status: "idle", message: "" });
