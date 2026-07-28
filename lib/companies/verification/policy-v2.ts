import { createHash } from "node:crypto";

export const COMPANY_TRUST_POLICY_V2 = Object.freeze({
  version: "COMPANY_TRUST_POLICY_V2" as const,
  publicScope: "COMPANY_IDENTITY" as const,
  strongLevel: "STRONG" as const,
  requiredEvidence: Object.freeze([
    "UID_REGISTER",
    "DOMAIN_CHALLENGE",
  ] as const),
  badgeCopyVersion: "COMPANY_TRUST_BADGE_COPY_V2" as const,
  expiryReminderOffsetsDays: Object.freeze([30, 14, 7] as const),
});

export type CompanyTrustEvidenceSnapshot = Readonly<{
  type:
    | "UID_REGISTER"
    | "DOMAIN_CHALLENGE"
    | "DOCUMENT"
    | "MANUAL_EXCEPTION"
    | "LEGACY_MANUAL";
  scope:
    | "LEGACY_PROFILE"
    | "COMPANY_IDENTITY"
    | "DOMAIN_CONTROL"
    | "REPRESENTATION";
  status: "PENDING" | "VALID" | "MISMATCH" | "FAILED" | "EXPIRED" | "REVOKED";
  source: string;
  checkedAt: Date | null;
  validFrom: Date | null;
  validTo: Date | null;
  revokedAt: Date | null;
  responseDigest: string;
}>;

export type CompanyTrustDecisionSnapshot = Readonly<{
  kind: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "REVOKED" | "RESTORED";
  scope:
    | "LEGACY_PROFILE"
    | "COMPANY_IDENTITY"
    | "DOMAIN_CONTROL"
    | "REPRESENTATION";
  riskLevel: "NORMAL" | "HIGH" | "MANUAL_EXCEPTION";
  policyVersion: string;
  requestedByUserId: string;
  decidedByUserId: string;
  approvedByUserId: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  decidedAt: Date;
  evidenceDigest: string;
}>;

export type CompanyTrustProjectionSnapshot = Readonly<{
  level: "NONE" | "LEGACY" | "STRONG";
  status: "PENDING" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "ON_HOLD" | "REVOKED";
  riskState: "CLEAR" | "REVIEW" | "HOLD" | "REVOKED";
  scope:
    | "LEGACY_PROFILE"
    | "COMPANY_IDENTITY"
    | "DOMAIN_CONTROL"
    | "REPRESENTATION";
  policyVersion: string;
  verifiedAt: Date | null;
  expiresAt: Date | null;
  evidenceDigest: string;
  verificationRequestStatus:
    | "DRAFT"
    | "PENDING"
    | "CHANGES_REQUESTED"
    | "VERIFIED"
    | "REJECTED"
    | "REVOKED";
  evidence: readonly CompanyTrustEvidenceSnapshot[];
  decision: CompanyTrustDecisionSnapshot | null;
}>;

export type CompanyTrustActivation = Readonly<{
  policyMode: "disabled" | "observe" | "enforce";
  strongBadge: boolean;
  publicEligibility: boolean;
  rapidRevoke: boolean;
  /** Only a local/CI compatibility seam; it can never produce a strong badge. */
  legacyDemoCompatibility: boolean;
}>;

export type CompanyTrustPublicDescriptor = Readonly<{
  level: "STRONG";
  label: "Firmenidentität geprüft";
  scopeLabel: "UID-Register und Domainkontrolle";
  method: "UID_REGISTER_AND_DOMAIN_CHALLENGE";
  policyVersion: typeof COMPANY_TRUST_POLICY_V2.version;
  copyVersion: typeof COMPANY_TRUST_POLICY_V2.badgeCopyVersion;
  verifiedAt: Date;
  validUntil: Date;
}>;

export type CompanyTrustEvaluation = Readonly<{
  current: boolean;
  strongVerified: boolean;
  badge: CompanyTrustPublicDescriptor | null;
  publicEligible: boolean;
  radarEligible: boolean;
  reason:
    | "STRONG_CURRENT"
    | "LEGACY_DEMO_ONLY"
    | "POLICY_DISABLED"
    | "COMPANY_INACTIVE"
    | "TRUST_MISSING"
    | "TRUST_NOT_CURRENT"
    | "RISK_BLOCKED"
    | "POLICY_VERSION_MISMATCH"
    | "EVIDENCE_INCOMPLETE"
    | "DECISION_INVALID"
    | "PUBLIC_ACTIVATION_DISABLED";
}>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function evaluateCompanyTrust(input: Readonly<{
  activation: CompanyTrustActivation;
  companyStatus: string;
  environment: "local" | "ci" | "preview" | "staging" | "production";
  hasActiveContainment: boolean;
  legacyVerifiedCycleCount: number;
  now: Date;
  projection: CompanyTrustProjectionSnapshot | null;
}>): CompanyTrustEvaluation {
  if (!isValidDate(input.now)) return denied("TRUST_NOT_CURRENT");
  if (input.companyStatus !== "ACTIVE") return denied("COMPANY_INACTIVE");
  if (
    input.hasActiveContainment ||
    input.projection?.riskState === "HOLD" ||
    input.projection?.riskState === "REVOKED" ||
    input.projection?.status === "ON_HOLD" ||
    input.projection?.status === "REVOKED"
  ) {
    return denied("RISK_BLOCKED");
  }

  const strong = evaluateStrongProjection(input.projection, input.now);
  if (strong.ok) {
    const localCompatibility =
      input.activation.legacyDemoCompatibility &&
      (input.environment === "local" || input.environment === "ci") &&
      input.legacyVerifiedCycleCount === 1 &&
      (input.activation.policyMode !== "enforce" ||
        (!input.activation.strongBadge &&
          !input.activation.publicEligibility));
    if (localCompatibility) {
      return Object.freeze({
        current: true,
        strongVerified: true,
        badge: null,
        publicEligible: true,
        radarEligible: true,
        reason: "LEGACY_DEMO_ONLY" as const,
      });
    }
    const badge =
      input.activation.policyMode === "enforce" && input.activation.strongBadge
        ? publicDescriptor(strong.projection)
        : null;
    const publicEligible =
      input.activation.policyMode === "enforce" &&
      input.activation.publicEligibility;
    return Object.freeze({
      current: true,
      strongVerified: true,
      badge,
      publicEligible,
      radarEligible: publicEligible,
      reason: publicEligible ? "STRONG_CURRENT" : "PUBLIC_ACTIVATION_DISABLED",
    });
  }

  const localCompatibility =
    input.activation.legacyDemoCompatibility &&
    (input.environment === "local" || input.environment === "ci") &&
    input.legacyVerifiedCycleCount === 1 &&
    (input.projection === null ||
      (input.projection.level === "LEGACY" &&
        input.projection.status === "ACTIVE" &&
        (input.projection.expiresAt === null ||
          input.now.getTime() < input.projection.expiresAt.getTime())));
  if (localCompatibility) {
    return Object.freeze({
      current: true,
      strongVerified: false,
      badge: null,
      publicEligible: true,
      radarEligible: true,
      reason: "LEGACY_DEMO_ONLY",
    });
  }

  if (input.activation.policyMode === "disabled") {
    return denied("POLICY_DISABLED");
  }
  return denied(strong.reason);
}

export function evaluateStrongProjection(
  projection: CompanyTrustProjectionSnapshot | null,
  now: Date,
):
  | Readonly<{ ok: true; projection: CompanyTrustProjectionSnapshot }>
  | Readonly<{
      ok: false;
      reason:
        | "TRUST_MISSING"
        | "TRUST_NOT_CURRENT"
        | "RISK_BLOCKED"
        | "POLICY_VERSION_MISMATCH"
        | "EVIDENCE_INCOMPLETE"
        | "DECISION_INVALID";
    }> {
  if (projection === null) return invalid("TRUST_MISSING");
  if (
    projection.level !== "STRONG" ||
    projection.verificationRequestStatus !== "VERIFIED" ||
    projection.scope !== COMPANY_TRUST_POLICY_V2.publicScope ||
    (projection.status !== "ACTIVE" && projection.status !== "EXPIRING") ||
    projection.riskState !== "CLEAR" ||
    projection.verifiedAt === null ||
    projection.expiresAt === null ||
    !isCurrentWindow(projection.verifiedAt, projection.expiresAt, now) ||
    !SHA256_PATTERN.test(projection.evidenceDigest)
  ) {
    return invalid(
      projection.status === "ON_HOLD" ||
        projection.status === "REVOKED" ||
        projection.riskState === "HOLD" ||
        projection.riskState === "REVOKED"
        ? "RISK_BLOCKED"
        : "TRUST_NOT_CURRENT",
    );
  }
  if (projection.policyVersion !== COMPANY_TRUST_POLICY_V2.version) {
    return invalid("POLICY_VERSION_MISMATCH");
  }
  const evidenceByType = new Map<
    CompanyTrustEvidenceSnapshot["type"],
    CompanyTrustEvidenceSnapshot[]
  >();
  for (const evidence of projection.evidence) {
    const candidates = evidenceByType.get(evidence.type) ?? [];
    candidates.push(evidence);
    evidenceByType.set(evidence.type, candidates);
  }
  const currentRequiredEvidence: CompanyTrustEvidenceSnapshot[][] = [];
  for (const requiredType of COMPANY_TRUST_POLICY_V2.requiredEvidence) {
    const candidates = (evidenceByType.get(requiredType) ?? []).filter(
      (evidence) =>
        evidence.scope === COMPANY_TRUST_POLICY_V2.publicScope &&
        evidence.status === "VALID" &&
        evidence.revokedAt === null &&
        evidence.checkedAt !== null &&
        evidence.validFrom !== null &&
        evidence.validTo !== null &&
        isCurrentWindow(evidence.validFrom, evidence.validTo, now) &&
        SHA256_PATTERN.test(evidence.responseDigest),
    );
    if (candidates.length === 0) {
      return invalid("EVIDENCE_INCOMPLETE");
    }
    currentRequiredEvidence.push(candidates);
  }
  const decision = projection.decision;
  if (
    decision === null ||
    !["APPROVED", "RESTORED"].includes(decision.kind) ||
    decision.scope !== COMPANY_TRUST_POLICY_V2.publicScope ||
    decision.policyVersion !== COMPANY_TRUST_POLICY_V2.version ||
    decision.requestedByUserId === decision.decidedByUserId ||
    !SHA256_PATTERN.test(decision.evidenceDigest) ||
    decision.evidenceDigest !== projection.evidenceDigest ||
    decision.validFrom === null ||
    decision.validTo === null ||
    !isCurrentWindow(decision.validFrom, decision.validTo, now) ||
    decision.decidedAt.getTime() > projection.verifiedAt.getTime() ||
    projection.expiresAt.getTime() > decision.validTo.getTime() ||
    (decision.riskLevel !== "NORMAL" &&
      (decision.approvedByUserId === null ||
        decision.approvedByUserId === decision.decidedByUserId ||
        decision.approvedByUserId === decision.requestedByUserId))
  ) {
    return invalid("DECISION_INVALID");
  }
  const [registerCandidates = [], domainCandidates = []] =
    currentRequiredEvidence;
  const digestMatches = registerCandidates.some((register) =>
    domainCandidates.some(
      (domain) =>
        companyTrustEvidenceDigest([register, domain]) ===
          projection.evidenceDigest &&
        projection.expiresAt!.getTime() <= register.validTo!.getTime() &&
        projection.expiresAt!.getTime() <= domain.validTo!.getTime(),
    ),
  );
  if (!digestMatches) return invalid("EVIDENCE_INCOMPLETE");
  return Object.freeze({ ok: true, projection });
}

export function companyTrustEvidenceDigest(
  evidence: readonly Readonly<{
    type: string;
    responseDigest: string;
    validTo: Date | null;
  }>[],
): string {
  const canonical = [...evidence]
    .sort((left, right) => left.type.localeCompare(right.type))
    .map((item) => ({
      type: item.type,
      responseDigest: item.responseDigest,
      validTo: item.validTo?.toISOString() ?? null,
    }));
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function publicDescriptor(
  projection: CompanyTrustProjectionSnapshot,
): CompanyTrustPublicDescriptor {
  return Object.freeze({
    level: "STRONG",
    label: "Firmenidentität geprüft",
    scopeLabel: "UID-Register und Domainkontrolle",
    method: "UID_REGISTER_AND_DOMAIN_CHALLENGE",
    policyVersion: COMPANY_TRUST_POLICY_V2.version,
    copyVersion: COMPANY_TRUST_POLICY_V2.badgeCopyVersion,
    verifiedAt: new Date(projection.verifiedAt!),
    validUntil: new Date(projection.expiresAt!),
  });
}

function isCurrentWindow(from: Date, to: Date, now: Date): boolean {
  return (
    isValidDate(from) &&
    isValidDate(to) &&
    from.getTime() <= now.getTime() &&
    now.getTime() < to.getTime()
  );
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function denied(reason: CompanyTrustEvaluation["reason"]): CompanyTrustEvaluation {
  return Object.freeze({
    current: false,
    strongVerified: false,
    badge: null,
    publicEligible: false,
    radarEligible: false,
    reason,
  });
}

function invalid(
  reason: Extract<
    ReturnType<typeof evaluateStrongProjection>,
    { ok: false }
  >["reason"],
) {
  return Object.freeze({ ok: false as const, reason });
}
