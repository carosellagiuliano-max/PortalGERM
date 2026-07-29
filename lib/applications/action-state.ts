export type ApplicationActionState = Readonly<{
  status: "idle" | "success" | "error";
  message?: string;
  nextIdempotencyKey?: string;
  values?: Readonly<Record<string, string | boolean>>;
}>;

export const INITIAL_APPLICATION_ACTION_STATE: ApplicationActionState =
  Object.freeze({ status: "idle" });
