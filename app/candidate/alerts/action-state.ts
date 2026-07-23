export type JobAlertActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;

export const INITIAL_JOB_ALERT_ACTION_STATE: JobAlertActionState =
  Object.freeze({
    status: "idle",
    message: "",
  });
