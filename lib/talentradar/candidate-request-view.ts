import "server-only";

import { z } from "zod";

import { evaluateCompanyTrustForCompanies } from "@/lib/companies/verification/read-model";
import type { DatabaseClient } from "@/lib/db/factory";
import type { RevealField } from "@/lib/generated/prisma/enums";
import { isContactRequestEffectiveAt } from "@/lib/talentradar/contact-requests";

const UUID = z.uuid();
const MAX_REQUESTS = 100;

export type CandidateRadarRequestStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED";

export type CandidateRadarRequestSummary = Readonly<{
  id: string;
  company: Readonly<{
    name: string;
    verified: boolean;
  }>;
  subject: string;
  messagePreview: string;
  status: CandidateRadarRequestStatus;
  trusted: boolean;
  createdAt: Date;
  expiresAt: Date;
}>;

export type CandidateRadarRequestDetail = CandidateRadarRequestSummary &
  Readonly<{
    company: Readonly<{
      id: string;
      name: string;
      slug: string;
      verified: boolean;
    }>;
    conversationId: string | null;
    reveal: Readonly<{
      grantId: string;
      status: "ACTIVE" | "REVOKED" | "TRUST_BLOCKED";
      fields: readonly RevealField[];
      revealedAt: Date;
      revokedAt: Date | null;
    }> | null;
  }>;

export async function listCandidateRadarRequests(
  database: DatabaseClient,
  actorUserId: string,
  now: Date = new Date(),
): Promise<readonly CandidateRadarRequestSummary[]> {
  if (!validContext(actorUserId, now)) return Object.freeze([]);

  const requests = await database.employerContactRequest.findMany({
    where: {
      candidateProfile: {
        userId: actorUserId,
        user: { role: "CANDIDATE", status: "ACTIVE" },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_REQUESTS,
    select: {
      id: true,
      subject: true,
      messagePreview: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      company: {
        select: {
          id: true,
          name: true,
          status: true,
          verificationRequests: {
            where: { status: "VERIFIED", supersededBy: null },
            take: 2,
            select: { id: true },
          },
        },
      },
    },
  });
  const trustByCompanyId = await evaluateCompanyTrustForCompanies(
    database,
    requests.map((request) => request.company.id),
    { now },
  );

  return Object.freeze(
    requests.map((request) => {
      const trust = trustByCompanyId.get(request.company.id);
      const verified = trust?.strongVerified === true && trust.badge !== null;
      return Object.freeze({
        id: request.id,
        company: Object.freeze({
          id: request.company.id,
          name: request.company.name,
          verified,
        }),
        subject: request.subject,
        messagePreview: request.messagePreview,
        status: effectiveStatus(request, now),
        trusted: trust?.radarEligible === true,
        createdAt: new Date(request.createdAt),
        expiresAt: new Date(request.expiresAt),
      });
    }),
  );
}

export async function getCandidateRadarRequest(
  database: DatabaseClient,
  actorUserId: string,
  requestId: string,
  now: Date = new Date(),
): Promise<CandidateRadarRequestDetail | null> {
  if (!validContext(actorUserId, now) || !UUID.safeParse(requestId).success) {
    return null;
  }

  const request = await database.employerContactRequest.findFirst({
    where: {
      id: requestId,
      candidateProfile: {
        userId: actorUserId,
        user: { role: "CANDIDATE", status: "ACTIVE" },
      },
    },
    select: {
      id: true,
      subject: true,
      messagePreview: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      company: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          verificationRequests: {
            where: { status: "VERIFIED", supersededBy: null },
            take: 2,
            select: { id: true },
          },
        },
      },
      conversation: { select: { id: true } },
      revealGrant: {
        select: {
          id: true,
          revealedAt: true,
          revokedAt: true,
          fields: {
            orderBy: { field: "asc" },
            select: { field: true },
          },
        },
      },
    },
  });
  if (request === null) return null;

  const trust = await evaluateCompanyTrustForCompanies(
    database,
    [request.company.id],
    { now },
  ).then((evaluations) => evaluations.get(request.company.id));
  const verified = trust?.strongVerified === true && trust.badge !== null;
  const trusted = trust?.radarEligible === true;
  const grant = request.revealGrant;

  return Object.freeze({
    id: request.id,
    company: Object.freeze({
      id: request.company.id,
      name: request.company.name,
      slug: request.company.slug,
      verified,
    }),
    subject: request.subject,
    messagePreview: request.messagePreview,
    status: effectiveStatus(request, now),
    trusted,
    createdAt: new Date(request.createdAt),
    expiresAt: new Date(request.expiresAt),
    conversationId: request.conversation?.id ?? null,
    reveal:
      grant === null
        ? null
        : Object.freeze({
            grantId: grant.id,
            status:
              grant.revokedAt !== null
                ? ("REVOKED" as const)
                : trusted
                  ? ("ACTIVE" as const)
                  : ("TRUST_BLOCKED" as const),
            fields: Object.freeze(grant.fields.map(({ field }) => field)),
            revealedAt: new Date(grant.revealedAt),
            revokedAt:
              grant.revokedAt === null ? null : new Date(grant.revokedAt),
          }),
  });
}

function effectiveStatus(
  request: Readonly<{
    status: CandidateRadarRequestStatus;
    createdAt: Date;
    expiresAt: Date;
  }>,
  now: Date,
): CandidateRadarRequestStatus {
  return request.status === "PENDING" &&
    !isContactRequestEffectiveAt(request, now)
    ? "EXPIRED"
    : request.status;
}

function validContext(actorUserId: string, now: Date): boolean {
  return (
    UUID.safeParse(actorUserId).success &&
    now instanceof Date &&
    Number.isFinite(now.getTime())
  );
}
