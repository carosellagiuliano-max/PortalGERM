export type AdminSecurityActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  code?: string;
}>;

export const INITIAL_ADMIN_SECURITY_ACTION_STATE: AdminSecurityActionState =
  Object.freeze({ status: "idle", message: "" });
