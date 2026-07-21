import "server-only";

import { notFound, redirect } from "next/navigation";

import {
  getEmployerContext,
  type EmployerMembershipContext,
} from "@/lib/auth/employer-context";

export async function requireEmployerCompanyContext(): Promise<
  EmployerMembershipContext
> {
  const context = await getEmployerContext();
  if (context === null) notFound();
  if (context.memberships.length === 0) {
    redirect("/employer/company/claim-pending");
  }
  if (context.current === null) {
    redirect("/employer/dashboard?selectCompany=1");
  }
  return context.current;
}

export function canManageCompany(
  role: EmployerMembershipContext["membershipRole"],
) {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageJobs(
  role: EmployerMembershipContext["membershipRole"],
) {
  return role === "OWNER" || role === "ADMIN" || role === "RECRUITER";
}
