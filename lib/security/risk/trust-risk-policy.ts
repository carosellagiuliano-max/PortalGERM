export const TRUST_RISK_POLICY_VERSION = "TRUST_RISK_POLICY_V1";

export const TRUST_RISK_SOURCES_V1 = Object.freeze([
  "AUTH_RATE_LIMIT",
  "SESSION_GUARD",
  "RECOVERY_GUARD",
  "ABUSE_REPORT",
  "JOB_MODERATION",
  "MESSAGE_VELOCITY",
  "CONTACT_VELOCITY",
  "RADAR_GUARD",
  "PRIVACY_EXPORT",
  "PAYMENT_RISK",
  "INCIDENT_CONFIRMED",
  "TRUST_REVIEW",
] as const);

export type TrustRiskSource = (typeof TRUST_RISK_SOURCES_V1)[number];
export type TrustRiskSignalKind =
  | "CREDENTIAL_STUFFING"
  | "PASSWORD_SPRAY"
  | "SESSION_ANOMALY"
  | "RECOVERY_ABUSE"
  | "COMPROMISED_COMPANY"
  | "JOB_SCAM"
  | "JOB_DUPLICATE"
  | "MASS_MESSAGING"
  | "MASS_CONTACT"
  | "REPEATED_COMPLAINT"
  | "REVEAL_ANOMALY"
  | "EXPORT_ANOMALY"
  | "PAYMENT_FRAUD";
export type TrustRiskSubjectType =
  | "USER"
  | "SESSION"
  | "COMPANY"
  | "JOB"
  | "MESSAGE"
  | "CONTACT_REQUEST"
  | "REVEAL"
  | "EXPORT"
  | "PAYMENT";
export type TrustRiskDecision = Readonly<{
  kind: "ALLOW" | "STEP_UP" | "HOLD" | "REVIEW" | "REVOKE";
  reasonCode: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  effectScope: readonly string[];
  opensCase: boolean;
  holdTtlMilliseconds: number | null;
  reviewSlaMilliseconds: number;
  policyVersion: typeof TRUST_RISK_POLICY_VERSION;
}>;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

const SUBJECTS_BY_SIGNAL = Object.freeze({
  CREDENTIAL_STUFFING: ["USER", "SESSION"],
  PASSWORD_SPRAY: ["USER"],
  SESSION_ANOMALY: ["USER", "SESSION"],
  RECOVERY_ABUSE: ["USER"],
  COMPROMISED_COMPANY: ["COMPANY"],
  JOB_SCAM: ["JOB"],
  JOB_DUPLICATE: ["JOB"],
  MASS_MESSAGING: ["COMPANY", "MESSAGE"],
  MASS_CONTACT: ["COMPANY", "CONTACT_REQUEST"],
  REPEATED_COMPLAINT: ["COMPANY", "JOB", "MESSAGE"],
  REVEAL_ANOMALY: ["REVEAL", "COMPANY"],
  EXPORT_ANOMALY: ["EXPORT", "USER", "COMPANY"],
  PAYMENT_FRAUD: ["PAYMENT", "COMPANY"],
} as const satisfies Readonly<
  Record<TrustRiskSignalKind, readonly TrustRiskSubjectType[]>
>);

export function evaluateTrustRiskSignal(input: Readonly<{
  kind: TrustRiskSignalKind;
  subjectType: TrustRiskSubjectType;
  source: TrustRiskSource;
  observedCount?: number | null;
}>): TrustRiskDecision {
  const count = normalizeCount(input.observedCount);
  const allowedSubjects = SUBJECTS_BY_SIGNAL[input.kind] as readonly TrustRiskSubjectType[];
  if (!allowedSubjects.includes(input.subjectType)) {
    return decision("REVIEW", "SUBJECT_SIGNAL_MISMATCH", "HIGH", [
      "MANUAL_REVIEW",
    ]);
  }

  switch (input.kind) {
    case "CREDENTIAL_STUFFING":
      return count < 5
        ? decision("ALLOW", "AUTH_BASELINE", "LOW", [])
        : count < 20
          ? decision("STEP_UP", "AUTH_VELOCITY_ELEVATED", "MEDIUM", [
              "SESSION",
            ])
          : decision("HOLD", "AUTH_VELOCITY_HIGH", "HIGH", [
              "SESSION",
              "ACCOUNT_SECURITY",
            ]);
    case "PASSWORD_SPRAY":
      return count < 3
        ? decision("ALLOW", "SPRAY_NOT_ESTABLISHED", "LOW", [])
        : count < 10
          ? decision("REVIEW", "PASSWORD_SPRAY_SUSPECTED", "HIGH", [
              "ACCOUNT_SECURITY",
            ])
          : decision("HOLD", "PASSWORD_SPRAY_CONFIRMED", "CRITICAL", [
              "SESSION",
              "ACCOUNT_SECURITY",
            ]);
    case "SESSION_ANOMALY":
      return count < 3
        ? decision("STEP_UP", "SESSION_REAUTH_REQUIRED", "MEDIUM", ["SESSION"])
        : decision("HOLD", "SESSION_ANOMALY_REPEATED", "HIGH", [
            "SESSION",
            "PRIVILEGED_ACTIONS",
          ]);
    case "RECOVERY_ABUSE":
      return count < 3
        ? decision("REVIEW", "RECOVERY_REVIEW_REQUIRED", "HIGH", [
            "ACCOUNT_RECOVERY",
          ])
        : decision("HOLD", "RECOVERY_ABUSE_REPEATED", "CRITICAL", [
            "SESSION",
            "ACCOUNT_RECOVERY",
          ]);
    case "COMPROMISED_COMPANY":
      return input.source === "INCIDENT_CONFIRMED"
        ? decision("REVOKE", "COMPANY_COMPROMISE_CONFIRMED", "CRITICAL", [
            "SESSION",
            "COMPANY",
            "BADGE",
            "PUBLIC_JOBS",
            "MESSAGING",
            "RADAR",
            "EXPORT",
            "PAYMENT",
          ])
        : decision("REVIEW", "COMPANY_COMPROMISE_REVIEW", "HIGH", [
            "COMPANY",
          ]);
    case "JOB_SCAM":
      return count < 2
        ? decision("REVIEW", "JOB_SCAM_REVIEW", "MEDIUM", ["JOB"])
        : decision("HOLD", "JOB_SCAM_CORROBORATED", "HIGH", [
            "JOB",
            "PUBLIC_JOBS",
          ]);
    case "JOB_DUPLICATE":
      return count < 2
        ? decision("ALLOW", "JOB_SIMILARITY_BASELINE", "LOW", [])
        : count < 5
          ? decision("REVIEW", "JOB_DUPLICATE_REVIEW", "MEDIUM", ["JOB"])
          : decision("HOLD", "JOB_DUPLICATE_VELOCITY", "HIGH", [
              "JOB",
              "PUBLIC_JOBS",
            ]);
    case "MASS_MESSAGING":
      return count < 10
        ? decision("ALLOW", "MESSAGE_VOLUME_BASELINE", "LOW", [])
        : count < 30
          ? decision("STEP_UP", "MESSAGE_VELOCITY_ELEVATED", "MEDIUM", [
              "MESSAGING",
            ])
          : decision("HOLD", "MESSAGE_VELOCITY_HIGH", "HIGH", [
              "MESSAGING",
            ]);
    case "MASS_CONTACT":
      return count < 5
        ? decision("ALLOW", "CONTACT_VOLUME_BASELINE", "LOW", [])
        : count < 15
          ? decision("STEP_UP", "CONTACT_VELOCITY_ELEVATED", "MEDIUM", [
              "RADAR",
            ])
          : decision("HOLD", "CONTACT_VELOCITY_HIGH", "HIGH", [
              "RADAR",
              "MESSAGING",
            ]);
    case "REPEATED_COMPLAINT":
      return count < 2
        ? decision("REVIEW", "COMPLAINT_REVIEW", "MEDIUM", [
            "MANUAL_REVIEW",
          ])
        : decision("HOLD", "COMPLAINTS_CORROBORATED", "HIGH", [
            input.subjectType === "JOB" ? "PUBLIC_JOBS" : "COMPANY",
          ]);
    case "REVEAL_ANOMALY":
      return count < 3
        ? decision("STEP_UP", "REVEAL_REAUTH_REQUIRED", "MEDIUM", ["RADAR"])
        : decision("HOLD", "REVEAL_VELOCITY_HIGH", "HIGH", [
            "RADAR",
            "IDENTITY_REVEAL",
          ]);
    case "EXPORT_ANOMALY":
      return count < 3
        ? decision("STEP_UP", "EXPORT_REAUTH_REQUIRED", "MEDIUM", ["EXPORT"])
        : decision("HOLD", "EXPORT_VELOCITY_HIGH", "HIGH", [
            "EXPORT",
            "PRIVILEGED_ACTIONS",
          ]);
    case "PAYMENT_FRAUD":
      return count < 2
        ? decision("REVIEW", "PAYMENT_RISK_REVIEW", "HIGH", ["PAYMENT"])
        : decision("HOLD", "PAYMENT_RISK_CORROBORATED", "CRITICAL", [
            "PAYMENT",
            "FULFILLMENT",
          ]);
  }
}

function decision(
  kind: TrustRiskDecision["kind"],
  reasonCode: string,
  severity: TrustRiskDecision["severity"],
  effectScope: readonly string[],
): TrustRiskDecision {
  const opensCase = kind === "REVIEW" || kind === "HOLD" || kind === "REVOKE";
  return Object.freeze({
    kind,
    reasonCode,
    severity,
    effectScope: Object.freeze([...effectScope]),
    opensCase,
    holdTtlMilliseconds: kind === "HOLD" ? 24 * HOUR : null,
    reviewSlaMilliseconds:
      severity === "CRITICAL" ? HOUR : severity === "HIGH" ? 4 * HOUR : DAY,
    policyVersion: TRUST_RISK_POLICY_VERSION,
  });
}

function normalizeCount(value: number | null | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0;
}
