export type AuthActionState = Readonly<{
  status: "idle" | "error" | "success" | "rate_limited";
  message?: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  values?: Readonly<Record<string, string | boolean>>;
}>;

export const INITIAL_AUTH_ACTION_STATE: AuthActionState = Object.freeze({
  status: "idle",
});

export function valueFromState(
  state: AuthActionState,
  field: string,
): string | undefined {
  const value = state.values?.[field];
  return typeof value === "string" ? value : undefined;
}

export function inputDefaultKeyFromState(
  state: AuthActionState,
  field: string,
): string {
  const value = valueFromState(state, field);
  return state.values === undefined
    ? `${field}:initial`
    : `${field}:submitted:${value ?? ""}`;
}

export function checkedFromState(
  state: AuthActionState,
  field: string,
): boolean {
  return state.values?.[field] === true;
}
