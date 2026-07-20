export type SavedJobActionState = Readonly<{
  status: "idle" | "error";
  message?: string;
}>;

export const INITIAL_SAVED_JOB_ACTION_STATE: SavedJobActionState = Object.freeze({
  status: "idle",
});
