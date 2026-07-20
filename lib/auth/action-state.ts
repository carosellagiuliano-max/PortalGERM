export type AuthActionStatus =
  | "idle"
  | "error"
  | "success"
  | "rate_limited";

export type AuthActionValue = string | boolean;

export type AuthActionState = Readonly<{
  status: AuthActionStatus;
  message?: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  values?: Readonly<Record<string, AuthActionValue>>;
}>;

export const INITIAL_AUTH_ACTION_STATE: AuthActionState = Object.freeze({
  status: "idle",
});
