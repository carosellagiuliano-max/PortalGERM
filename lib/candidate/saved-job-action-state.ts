export type SavedJobActionState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "success";
      message: string;
      jobSlug: string;
    }>;

export const INITIAL_SAVED_JOB_ACTION_STATE: SavedJobActionState =
  Object.freeze({
    status: "idle",
  });
