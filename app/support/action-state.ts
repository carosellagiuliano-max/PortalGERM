export type SupportActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
}>;

export const INITIAL_SUPPORT_ACTION_STATE: SupportActionState = Object.freeze({
  status: "idle",
  message: "",
});
