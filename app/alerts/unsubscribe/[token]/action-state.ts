export type UnsubscribeActionState = Readonly<{
  status: "idle" | "complete";
  message: string;
}>;

export const INITIAL_UNSUBSCRIBE_ACTION_STATE: UnsubscribeActionState =
  Object.freeze({
    status: "idle",
    message: "",
  });
