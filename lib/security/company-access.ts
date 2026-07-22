import "server-only";

import type { CompanyMembershipRole } from "@/lib/generated/prisma/enums";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { listBoundaryAccessibleMembershipIds } from "@/lib/billing/membership-access";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import { AuthorizationDeniedError, SafeNotFoundError } from "@/lib/security/errors";

export type CompanyAccess = Readonly<{
  companyId: string;
  userId: string;
  membershipId: string;
  membershipRole: CompanyMembershipRole;
  companyStatus: "ACTIVE";
}>;

export interface CompanyAccessRepository {
  findActiveMembership(input: Readonly<{
    companyId: string;
    userId: string;
  }>): Promise<CompanyAccess | null>;
}

export function createCompanyAccessRepository(
  database: DatabaseClient,
  now: () => Date = () => new Date(),
): CompanyAccessRepository {
  return {
    async findActiveMembership({ companyId, userId }) {
      const membership = await database.companyMembership.findFirst({
        where: {
          companyId,
          userId,
          status: "ACTIVE",
          company: { status: "ACTIVE" },
        },
        select: {
          id: true,
          companyId: true,
          userId: true,
          role: true,
          company: { select: { status: true } },
        },
      });
      if (membership?.company.status !== "ACTIVE") return null;
      const accessibleMembershipIds = await listBoundaryAccessibleMembershipIds(
        database,
        companyId,
        now(),
      );
      if (
        accessibleMembershipIds !== null &&
        !accessibleMembershipIds.includes(membership.id)
      ) {
        return null;
      }
      return Object.freeze({
        companyId: membership.companyId,
        userId: membership.userId,
        membershipId: membership.id,
        membershipRole: membership.role,
        companyStatus: "ACTIVE",
      });
    },
  };
}

export async function resolveCompanyAccess(
  input: Readonly<{
    companyId: string;
    user: CurrentUser;
    allowedRoles?: readonly CompanyMembershipRole[];
  }>,
  repository: CompanyAccessRepository,
): Promise<CompanyAccess> {
  if (!(["EMPLOYER", "RECRUITER", "ADMIN"] as const).includes(
    input.user.role as "EMPLOYER" | "RECRUITER" | "ADMIN",
  )) {
    throw new AuthorizationDeniedError();
  }
  const access = await repository.findActiveMembership({
    companyId: input.companyId,
    userId: input.user.id,
  });
  if (access === null) throw new SafeNotFoundError();
  if (input.allowedRoles && !input.allowedRoles.includes(access.membershipRole)) {
    throw new SafeNotFoundError();
  }
  return access;
}

export async function requireCompanyAccess(
  companyId: string,
  allowedRoles?: readonly CompanyMembershipRole[],
): Promise<CompanyAccess> {
  const user = await getCurrentUser();
  if (user === null) throw new SafeNotFoundError();
  return resolveCompanyAccess(
    { companyId, user, allowedRoles },
    createCompanyAccessRepository(getDatabase()),
  );
}
