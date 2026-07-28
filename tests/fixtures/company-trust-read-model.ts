import { createHash } from "node:crypto";

import type { CompanyTrustActivation } from "@/lib/companies/verification/policy-v2";

export const TEST_STRONG_COMPANY_TRUST_ACTIVATION = Object.freeze({
  policyMode: "enforce",
  strongBadge: true,
  publicEligibility: true,
  rapidRevoke: true,
  legacyDemoCompatibility: false,
} satisfies CompanyTrustActivation);

export const TEST_COMPANY_TRUST_ENVIRONMENT = "ci" as const;

export function companyTrustReadRow(input: Readonly<{
  companyId: string;
  now: Date;
  status?: "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  strong?: boolean;
}>) {
  const status = input.status ?? "ACTIVE";
  if (input.strong === false) {
    return {
      id: input.companyId,
      status,
      verificationRequests: [],
      trustProjections: [],
    };
  }

  const validFrom = new Date(input.now.getTime() - 86_400_000);
  const validTo = new Date(input.now.getTime() + 30 * 86_400_000);
  const uidEvidence = {
    type: "UID_REGISTER" as const,
    scope: "COMPANY_IDENTITY" as const,
    status: "VALID" as const,
    source: "phase26_unit_register",
    checkedAt: validFrom,
    validFrom,
    validTo,
    revokedAt: null,
    responseDigest: "a".repeat(64),
  };
  const domainEvidence = {
    type: "DOMAIN_CHALLENGE" as const,
    scope: "COMPANY_IDENTITY" as const,
    status: "VALID" as const,
    source: "phase26_unit_domain",
    checkedAt: validFrom,
    validFrom,
    validTo,
    revokedAt: null,
    responseDigest: "b".repeat(64),
  };
  const evidenceDigest = createHash("sha256")
    .update(
      JSON.stringify(
        [domainEvidence, uidEvidence]
          .sort((left, right) => left.type.localeCompare(right.type))
          .map((evidence) => ({
            type: evidence.type,
            responseDigest: evidence.responseDigest,
            validTo: evidence.validTo.toISOString(),
          })),
      ),
      "utf8",
    )
    .digest("hex");
  const requestedByUserId = `requester:${input.companyId}`;

  return {
    id: input.companyId,
    status,
    verificationRequests: [{ id: `legacy:${input.companyId}` }],
    trustProjections: [
      {
        level: "STRONG" as const,
        status: "ACTIVE" as const,
        riskState: "CLEAR" as const,
        scope: "COMPANY_IDENTITY" as const,
        policyVersion: "COMPANY_TRUST_POLICY_V2",
        verifiedAt: validFrom,
        expiresAt: validTo,
        evidenceDigest,
        decision: {
          kind: "APPROVED" as const,
          scope: "COMPANY_IDENTITY" as const,
          riskLevel: "NORMAL" as const,
          policyVersion: "COMPANY_TRUST_POLICY_V2",
          decidedByUserId: `reviewer:${input.companyId}`,
          approvedByUserId: null,
          validFrom,
          validTo,
          decidedAt: validFrom,
          evidenceDigest,
          verificationRequest: { requestedByUserId },
        },
        verificationRequest: {
          status: "VERIFIED" as const,
          evidence: [uidEvidence, domainEvidence],
        },
      },
    ],
  };
}
