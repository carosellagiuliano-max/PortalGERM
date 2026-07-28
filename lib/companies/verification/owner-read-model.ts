import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";
import { evaluateCompanyTrustForCompany } from "@/lib/companies/verification/read-model";

export async function getCompanyVerificationOwnerWorkspace(
  database: DatabaseClient,
  input: Readonly<{
    actorUserId: string;
    companyId: string;
    membershipId: string;
    now?: Date;
  }>,
) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) return null;
  const membership = await database.companyMembership.findFirst({
    where: {
      id: input.membershipId,
      companyId: input.companyId,
      userId: input.actorUserId,
      status: "ACTIVE",
      removedAt: null,
      company: { status: { in: ["DRAFT", "ACTIVE"] } },
      user: { status: "ACTIVE" },
    },
    select: {
      id: true,
      role: true,
      company: {
        select: {
          id: true,
          name: true,
          slug: true,
          uid: true,
          status: true,
          website: true,
          registrationCanton: { select: { code: true, name: true } },
          verificationRequests: {
            where: { supersededBy: null },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              id: true,
              status: true,
              riskLevel: true,
              policyVersion: true,
              version: true,
              assignedAt: true,
              reviewDueAt: true,
              decidedAt: true,
              createdAt: true,
              evidence: {
                orderBy: [{ type: "asc" }, { createdAt: "asc" }],
                select: {
                  id: true,
                  type: true,
                  scope: true,
                  status: true,
                  source: true,
                  reasonCode: true,
                  checkedAt: true,
                  validFrom: true,
                  validTo: true,
                  revokedAt: true,
                  documentVersionId: true,
                  domainChallenge: {
                    select: {
                      id: true,
                      domain: true,
                      status: true,
                      issuedAt: true,
                      expiresAt: true,
                      verifiedAt: true,
                    },
                  },
                },
              },
              appeals: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 10,
                select: {
                  id: true,
                  status: true,
                  safeStatement: true,
                  decisionReasonCode: true,
                  decidedAt: true,
                  createdAt: true,
                },
              },
              events: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 20,
                select: {
                  kind: true,
                  toStatus: true,
                  reasonCode: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (membership === null) return null;
  const trust = await evaluateCompanyTrustForCompany(
    database,
    membership.company.id,
    { now },
  );
  return Object.freeze({
    membershipId: membership.id,
    membershipRole: membership.role,
    canManage:
      membership.role === "OWNER" || membership.role === "ADMIN",
    company: Object.freeze({
      id: membership.company.id,
      name: membership.company.name,
      slug: membership.company.slug,
      uid: membership.company.uid,
      status: membership.company.status,
      website: membership.company.website,
      cantonCode: membership.company.registrationCanton?.code ?? null,
      cantonName: membership.company.registrationCanton?.name ?? null,
    }),
    current: membership.company.verificationRequests[0] ?? null,
    trust: Object.freeze({
      current: trust.current,
      strongVerified: trust.strongVerified,
      badge: trust.badge,
      reason: trust.reason,
    }),
  });
}
