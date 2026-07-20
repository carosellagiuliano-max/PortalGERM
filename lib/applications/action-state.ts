export type ApplicationActionState = Readonly<{
  status: "idle" | "success" | "error";
  message?: string;
  nextIdempotencyKey?: string;
}>;

export const INITIAL_APPLICATION_ACTION_STATE: ApplicationActionState =
  Object.freeze({ status: "idle" });
