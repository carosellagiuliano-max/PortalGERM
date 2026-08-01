import "server-only";

import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import {
  getCurrentAuthContext,
  type CurrentUser,
} from "@/lib/auth/current-user";
import { decideAdminRuntimeAccess } from "@/lib/auth/admin-runtime-policy";
import { INTERNAL_REQUEST_PATH_HEADER } from "@/lib/auth/request-context";
import type { AdminCapability } from "@/lib/admin/capabilities";
import {
  ADMIN_GRANTS_POLICY_V2,
  resolveAdminActor,
  type AdminDutyV2,
} from "@/lib/admin/role-policy";
import { hasCurrentAal2 } from "@/lib/auth/assurance/mfa-service";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export type AuthenticatedPageUser = CurrentUser &
  Readonly<{ sessionId: string }>;

export type AdminPageUser = AuthenticatedPageUser &
  Readonly<{
    capabilities: readonly AdminCapability[];
    adminDuties: readonly AdminDutyV2[];
    breakGlassGrantIds: readonly string[];
    adminGrantPolicyVersion: typeof ADMIN_GRANTS_POLICY_V2;
  }>;

export function requireCandidatePage(): Promise<AuthenticatedPageUser> {
  return requirePageRole(["CANDIDATE"]);
}

export function requireEmployerPage(): Promise<AuthenticatedPageUser> {
  return requirePageRole(["EMPLOYER", "RECRUITER"]);
}

export async function requireAdminPage(): Promise<AdminPageUser> {
  const user = await requirePageRole(["ADMIN"]);
  const environment = getServerEnvironment();
  if (!decideAdminRuntimeAccess(environment).allowed) forbidden();
  if (
    environment.ADMIN_MFA_REQUIRED &&
    !(await hasCurrentAal2(getDatabase(), {
      userId: user.id,
      sessionId: user.sessionId,
      now: new Date(),
    }))
  ) {
    const requestPath = sanitizePrivateRequestPath(
      (await headers()).get(INTERNAL_REQUEST_PATH_HEADER),
    );
    const pathname =
      requestPath === null
        ? null
        : new URL(requestPath, "https://private-route.invalid").pathname;
    if (pathname !== "/admin/security/authenticators") {
      redirect("/admin/security/authenticators?required=1");
    }
  }
  const resolved = await resolveAdminActor(
    getDatabase(),
    { userId: user.id, role: user.role, status: user.status },
    new Date(),
  );
  return Object.freeze({
    ...user,
    capabilities: resolved.capabilities,
    adminDuties: resolved.duties,
    breakGlassGrantIds: resolved.breakGlassGrantIds,
    adminGrantPolicyVersion: resolved.policyVersion,
  });
}

export function requireAuthenticatedPage(): Promise<AuthenticatedPageUser> {
  return requirePageRole(["CANDIDATE", "EMPLOYER", "RECRUITER", "ADMIN"]);
}

export async function requirePendingCompanyClaimPage(): Promise<AuthenticatedPageUser> {
  const user = await requireEmployerPage();
  const pending = await getDatabase().companyClaimRequest.findFirst({
    where: {
      requesterEmployerUserId: user.id,
      status: { in: ["PENDING", "NEEDS_EVIDENCE"] },
    },
    select: { id: true },
  });
  if (pending === null) redirect("/employer/dashboard");
  return user;
}

async function requirePageRole(
  allowedRoles: readonly CurrentUser["role"][],
): Promise<AuthenticatedPageUser> {
  const requestHeaders = await headers();
  const context = await getCurrentAuthContext();
  if (context === null) {
    const next = sanitizePrivateRequestPath(
      requestHeaders.get(INTERNAL_REQUEST_PATH_HEADER),
    );
    redirect(
      next === null
        ? "/session/clear"
        : `/session/clear?next=${encodeURIComponent(next)}`,
    );
  }
  const user = context.user;
  if (!allowedRoles.includes(user.role)) forbidden();
  const environment = getServerEnvironment();
  if (
    environment.IDENTITY_VERIFICATION_ENFORCEMENT &&
    (user.identityAssurance !== "VERIFIED_EMAIL" ||
      user.emailVerifiedAt === null)
  ) {
    const requestedPath = sanitizePrivateRequestPath(
      requestHeaders.get(INTERNAL_REQUEST_PATH_HEADER),
    );
    if (!isLowAssurancePage(requestedPath)) {
      redirect(
        requestedPath === null
          ? "/verify-email"
          : `/verify-email?next=${encodeURIComponent(requestedPath)}`,
      );
    }
  }
  return Object.freeze({ ...user, sessionId: context.session.id });
}

function isLowAssurancePage(path: string | null) {
  if (path === null) return false;
  const pathname = new URL(path, "https://private-route.invalid").pathname;
  return (
    pathname === "/candidate/notifications" ||
    pathname === "/employer/notifications" ||
    pathname === "/support"
  );
}

export function sanitizePrivateRequestPath(value: string | null): string | null {
  if (
    value === null ||
    value.length === 0 ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(value, "https://private-route.invalid");
    const privatePath = ["/candidate", "/employer", "/admin", "/support"].some(
      (prefix) =>
        parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`),
    );
    return privatePath ? `${parsed.pathname}${parsed.search}` : null;
  } catch {
    return null;
  }
}
