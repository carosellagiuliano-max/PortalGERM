export type EmployerActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message?: string;
  nextIdempotencyKey?: string;
}>;

export const INITIAL_EMPLOYER_ACTION_STATE: EmployerActionState = Object.freeze({
  status: "idle",
});
