export type BillingActionState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message?: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;

export const INITIAL_BILLING_ACTION_STATE: BillingActionState = Object.freeze({
  status: "idle",
});
