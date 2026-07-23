export type AdminActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  code?: string;
}>;

export const INITIAL_ADMIN_ACTION_STATE: AdminActionState = Object.freeze({
  status: "idle",
  message: "",
});
