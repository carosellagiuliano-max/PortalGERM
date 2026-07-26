import "server-only";

import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { INTERNAL_REQUEST_PATH_HEADER } from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export function requireCandidatePage(): Promise<CurrentUser> {
  return requirePageRole(["CANDIDATE"]);
}

export function requireEmployerPage(): Promise<CurrentUser> {
  return requirePageRole(["EMPLOYER", "RECRUITER"]);
}

export function requireAdminPage(): Promise<CurrentUser> {
  return requirePageRole(["ADMIN"]);
}

export function requireAuthenticatedPage(): Promise<CurrentUser> {
  return requirePageRole(["CANDIDATE", "EMPLOYER", "RECRUITER", "ADMIN"]);
}

export async function requirePendingCompanyClaimPage(): Promise<CurrentUser> {
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
): Promise<CurrentUser> {
  const requestHeaders = await headers();
  const user = await getCurrentUser();
  if (user === null) {
    const next = sanitizePrivateRequestPath(
      requestHeaders.get(INTERNAL_REQUEST_PATH_HEADER),
    );
    redirect(
      next === null
        ? "/session/clear"
        : `/session/clear?next=${encodeURIComponent(next)}`,
    );
  }
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
  return user;
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
