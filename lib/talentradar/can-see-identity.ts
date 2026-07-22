import type { RevealReadScope } from "@/lib/privacy/reveal-dto";

export type RadarIdentityTrustScope = RevealReadScope &
  Readonly<{
    candidateUserStatus: string;
    companyStatus: string;
    companyVerificationCount: number;
    conversationKind: string;
  }>;

/**
 * Request-scoped Radar identity guard. Application identity is deliberately
 * outside this helper and continues to follow the Application policy.
 */
export function canSeeRadarIdentity(
  input: RadarIdentityTrustScope,
): boolean {
  return (
    input.candidateUserStatus === "ACTIVE" &&
    input.companyStatus === "ACTIVE" &&
    input.companyVerificationCount === 1 &&
    input.conversationKind === "TALENT_RADAR" &&
    input.requestStatus === "ACCEPTED" &&
    input.revokedAt === null &&
    input.requestId === input.grantRequestId &&
    input.requestCompanyId === input.grantCompanyId &&
    input.requestCandidateProfileId === input.grantCandidateProfileId &&
    input.requestConversationId !== null &&
    input.requestConversationId === input.grantConversationId &&
    input.viewerCompanyId === input.grantCompanyId
  );
}
