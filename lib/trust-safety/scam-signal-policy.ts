import {
  evaluateTrustRiskSignal,
  type TrustRiskDecision,
} from "@/lib/security/risk/trust-risk-policy";

export function evaluateScamSignal(input: Readonly<{
  kind:
    | "JOB_SCAM"
    | "JOB_DUPLICATE"
    | "MASS_MESSAGING"
    | "MASS_CONTACT"
    | "REPEATED_COMPLAINT";
  subjectType: "COMPANY" | "JOB" | "MESSAGE" | "CONTACT_REQUEST";
  observedCount: number;
}>): TrustRiskDecision {
  const source =
    input.kind === "MASS_MESSAGING"
      ? "MESSAGE_VELOCITY"
      : input.kind === "MASS_CONTACT"
        ? "CONTACT_VELOCITY"
        : input.kind === "REPEATED_COMPLAINT"
          ? "ABUSE_REPORT"
          : "JOB_MODERATION";
  return evaluateTrustRiskSignal({ ...input, source });
}
