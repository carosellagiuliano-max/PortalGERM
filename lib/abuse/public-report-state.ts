export type PublicReportActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
}>;

export const INITIAL_PUBLIC_REPORT_STATE: PublicReportActionState = Object.freeze({
  status: "idle",
  message: "",
});
