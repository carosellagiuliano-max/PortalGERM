import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";
import type { CompanyAccess } from "@/lib/security/company-access";
import { SafeNotFoundError } from "@/lib/security/errors";

const INVOICE_ROLES = new Set(["OWNER", "ADMIN"]);
const RADAR_REQUEST_ROLES = new Set(["OWNER", "ADMIN", "RECRUITER"]);
const APPLICATION_OWNER_ADMIN_ROLES = ["OWNER", "ADMIN"] as const;
const APPLICATION_RECRUITER_ASSIGNMENT_ROLES = ["EDITOR", "PIPELINE"] as const;

function requireResourceRole(
  access: CompanyAccess,
  allowedRoles: ReadonlySet<string>,
): void {
  if (!allowedRoles.has(access.membershipRole)) {
    throw new SafeNotFoundError();
  }
}

function assignmentScope(access: CompanyAccess, now: Date) {
  return access.membershipRole === "RECRUITER"
    ? {
        assignments: {
          some: {
            membershipId: access.membershipId,
            userId: access.userId,
            status: "ACTIVE" as const,
            validFrom: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      }
    : {};
}

function applicationScope(access: CompanyAccess, now: Date) {
  const activeMembership = {
    id: access.membershipId,
    companyId: access.companyId,
    userId: access.userId,
    status: "ACTIVE" as const,
  };

  if (access.membershipRole === "OWNER" || access.membershipRole === "ADMIN") {
    return {
      companyId: access.companyId,
      company: {
        status: "ACTIVE" as const,
        memberships: {
          some: {
            ...activeMembership,
            role: { in: [...APPLICATION_OWNER_ADMIN_ROLES] },
          },
        },
      },
    };
  }

  if (access.membershipRole === "RECRUITER") {
    return {
      companyId: access.companyId,
      company: {
        status: "ACTIVE" as const,
        memberships: {
          some: { ...activeMembership, role: "RECRUITER" as const },
        },
      },
      assignments: {
        some: {
          membershipId: access.membershipId,
          companyId: access.companyId,
          userId: access.userId,
          role: { in: [...APPLICATION_RECRUITER_ASSIGNMENT_ROLES] },
          status: "ACTIVE" as const,
          validFrom: { lte: now },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    };
  }

  throw new SafeNotFoundError();
}

export async function getAuthorizedJob(
  input: Readonly<{ jobId: string; access: CompanyAccess; now: Date }>,
  database: DatabaseClient,
) {
  const job = await database.job.findFirst({
    where: {
      id: input.jobId,
      companyId: input.access.companyId,
      ...assignmentScope(input.access, input.now),
    },
    select: {
      id: true,
      companyId: true,
      status: true,
      currentRevisionId: true,
      publishedRevisionId: true,
      publishedAt: true,
      expiresAt: true,
    },
  });
  if (job === null) throw new SafeNotFoundError();
  return job;
}

export async function getAuthorizedApplication(
  input: Readonly<{ applicationId: string; access: CompanyAccess; now: Date }>,
  database: DatabaseClient,
) {
  const application = await database.application.findFirst({
    where: {
      id: input.applicationId,
      job: applicationScope(input.access, input.now),
    },
    select: {
      id: true,
      jobId: true,
      candidateProfileId: true,
      submittedJobRevisionId: true,
      status: true,
      submittedAt: true,
    },
  });
  if (application === null) throw new SafeNotFoundError();
  return application;
}

export async function getAuthorizedInvoice(
  input: Readonly<{ invoiceId: string; access: CompanyAccess }>,
  database: DatabaseClient,
) {
  requireResourceRole(input.access, INVOICE_ROLES);
  const invoice = await database.invoice.findFirst({
    where: { id: input.invoiceId, companyId: input.access.companyId },
    select: {
      id: true,
      companyId: true,
      orderId: true,
      number: true,
      status: true,
      currency: true,
      netTotalRappen: true,
      vatTotalRappen: true,
      totalRappen: true,
      dueAt: true,
      issuedAt: true,
    },
  });
  if (invoice === null) throw new SafeNotFoundError();
  return invoice;
}

export async function getAuthorizedRadarRequest(
  input: Readonly<{ requestId: string; access: CompanyAccess }>,
  database: DatabaseClient,
) {
  requireResourceRole(input.access, RADAR_REQUEST_ROLES);
  const request = await database.employerContactRequest.findFirst({
    where: { id: input.requestId, companyId: input.access.companyId },
    select: {
      id: true,
      companyId: true,
      candidateProfileId: true,
      requestingUserId: true,
      status: true,
      fundingSource: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  if (request === null) throw new SafeNotFoundError();
  return request;
}
