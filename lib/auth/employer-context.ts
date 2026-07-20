import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

import {
  COMPANY_CONTEXT_COOKIE_POLICY_V1,
  createCompanyContextCookie,
  verifyCompanyContextCookie,
} from "@/lib/auth/company-context-cookie";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { shouldUseSecureAuthCookies } from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export type EmployerMembershipContext = Readonly<{
  membershipId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  companyId: string;
  companyName: string;
  companySlug: string;
  companyStatus: "DRAFT" | "ACTIVE";
}>;

export type EmployerContext = Readonly<{
  user: CurrentUser;
  memberships: readonly EmployerMembershipContext[];
  current: EmployerMembershipContext | null;
  needsSelection: boolean;
}>;

export async function getEmployerContext(): Promise<EmployerContext | null> {
  const user = await getCurrentUser();
  if (
    user === null ||
    (user.role !== "EMPLOYER" && user.role !== "RECRUITER")
  ) {
    return null;
  }
  const database = getDatabase();
  const rows = await database.companyMembership.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      company: { status: { in: ["DRAFT", "ACTIVE"] } },
    },
    orderBy: [{ company: { name: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      role: true,
      company: {
        select: { id: true, name: true, slug: true, status: true },
      },
    },
  });
  const memberships = Object.freeze(
    rows.map((row) =>
      Object.freeze({
        membershipId: row.id,
        membershipRole: row.role,
        companyId: row.company.id,
        companyName: row.company.name,
        companySlug: row.company.slug,
        companyStatus: row.company.status as "DRAFT" | "ACTIVE",
      }),
    ),
  );
  const cookieStore = await cookies();
  const environment = getServerEnvironment();
  const signed = cookieStore.get(
    COMPANY_CONTEXT_COOKIE_POLICY_V1.cookieName,
  )?.value;
  const payload = verifyCompanyContextCookie(
    signed,
    { userId: user.id, now: new Date() },
    environment.secrets.session,
  );
  const current = resolveEmployerContextSelection(
    memberships,
    payload?.companyId,
  );

  return Object.freeze({
    user,
    memberships,
    current,
    needsSelection: current === null && memberships.length > 1,
  });
}

export function resolveEmployerContextSelection(
  memberships: readonly EmployerMembershipContext[],
  signedCompanyId: string | undefined,
): EmployerMembershipContext | null {
  const selected = signedCompanyId === undefined
    ? undefined
    : memberships.find(({ companyId }) => companyId === signedCompanyId);
  if (selected !== undefined) return selected;
  return memberships.length === 1 ? (memberships[0] ?? null) : null;
}

export async function setEmployerCompanyContext(
  companyId: string,
): Promise<boolean> {
  if (!z.uuid().safeParse(companyId).success) return false;
  const user = await getCurrentUser();
  if (
    user === null ||
    (user.role !== "EMPLOYER" && user.role !== "RECRUITER")
  ) {
    return false;
  }
  const membership = await getDatabase().companyMembership.findFirst({
    where: {
      companyId,
      userId: user.id,
      status: "ACTIVE",
      company: { status: { in: ["DRAFT", "ACTIVE"] } },
    },
    select: { id: true },
  });
  if (membership === null) return false;

  const environment = getServerEnvironment();
  const value = createCompanyContextCookie(
    {
      userId: user.id,
      companyId,
      now: new Date(),
      production: shouldUseSecureAuthCookies(environment.APP_ENV),
    },
    environment.secrets.session,
  );
  const cookieStore = await cookies();
  cookieStore.set(value.name, value.value, value.options);
  return true;
}

export async function clearEmployerCompanyContext(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COMPANY_CONTEXT_COOKIE_POLICY_V1.cookieName);
}
