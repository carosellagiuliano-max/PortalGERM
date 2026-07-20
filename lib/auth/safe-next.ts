export const AUTH_ROLES_V1 = [
  "CANDIDATE",
  "EMPLOYER",
  "RECRUITER",
  "ADMIN",
] as const;

export type AuthRoleV1 = (typeof AUTH_ROLES_V1)[number];

export const DEFAULT_AUTH_PATH_BY_ROLE_V1 = Object.freeze({
  CANDIDATE: "/candidate/dashboard",
  EMPLOYER: "/employer/dashboard",
  RECRUITER: "/employer/dashboard",
  ADMIN: "/admin",
} as const satisfies Readonly<Record<AuthRoleV1, string>>);

export const SAFE_NEXT_PREFIXES_BY_ROLE_V1 = Object.freeze({
  CANDIDATE: Object.freeze(["/candidate"]),
  EMPLOYER: Object.freeze(["/employer"]),
  RECRUITER: Object.freeze(["/employer"]),
  ADMIN: Object.freeze(["/admin"]),
} as const satisfies Readonly<Record<AuthRoleV1, readonly string[]>>);

const SAFE_NEXT_BASE = "https://safe-next.invalid";
const ENCODED_PATH_SEPARATOR_OR_CONTROL = /%(?:00|0a|0d|25|2f|5c)/iu;

export function parseSafeNext(
  value: string | null | undefined,
  role: AuthRoleV1,
): string | null {
  if (
    value == null ||
    value.length === 0 ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    ENCODED_PATH_SEPARATOR_OR_CONTROL.test(value)
  ) {
    return null;
  }

  try {
    const url = new URL(value, SAFE_NEXT_BASE);
    if (url.origin !== SAFE_NEXT_BASE || url.username || url.password) {
      return null;
    }
    const allowed = SAFE_NEXT_PREFIXES_BY_ROLE_V1[role].some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    );
    return allowed ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

export function resolveSafeNext(
  value: string | null | undefined,
  role: AuthRoleV1,
): string {
  return parseSafeNext(value, role) ?? DEFAULT_AUTH_PATH_BY_ROLE_V1[role];
}
