import "server-only";

import type { Role } from "@/lib/generated/prisma/enums";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
} from "@/lib/security/errors";

export function assertRole(
  user: CurrentUser | null,
  allowedRole: Role | readonly Role[],
): CurrentUser {
  if (user === null) throw new AuthenticationRequiredError();
  const allowed = Array.isArray(allowedRole) ? allowedRole : [allowedRole];
  if (!allowed.includes(user.role)) throw new AuthorizationDeniedError();
  return user;
}

export async function requireRole(
  allowedRole: Role | readonly Role[],
): Promise<CurrentUser> {
  return assertRole(await getCurrentUser(), allowedRole);
}
