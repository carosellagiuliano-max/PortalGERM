export type LeadActionField =
  | "companyName"
  | "contactName"
  | "email"
  | "phone"
  | "companySizeCode"
  | "hiringNeedCode"
  | "interestCode"
  | "message"
  | "callbackWindowCode"
  | "acceptedContactPurpose";

export type LeadActionState = Readonly<{
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<LeadActionField, readonly string[]>>;
  values?: Partial<Record<LeadActionField, string>>;
}>;

export const INITIAL_LEAD_ACTION_STATE: LeadActionState = Object.freeze({
  status: "idle",
});
