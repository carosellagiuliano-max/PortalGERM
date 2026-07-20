export type CandidateMessageActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  nextIdempotencyKey?: string;
}>;

export const INITIAL_CANDIDATE_MESSAGE_ACTION_STATE = Object.freeze({
  status: "idle",
  message: "",
}) satisfies CandidateMessageActionState;
