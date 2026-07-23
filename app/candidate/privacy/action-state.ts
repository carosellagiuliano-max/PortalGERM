export type CandidatePrivacyActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  supportPath?: string;
}>;

export const INITIAL_CANDIDATE_PRIVACY_ACTION_STATE: CandidatePrivacyActionState =
  Object.freeze({ status: "idle", message: "" });
