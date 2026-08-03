export const ROUTE_HANDLER_ROLES = Object.freeze({
  "/api/analytics/public-jobs": ["PUBLIC_ANALYTICS_ORIGIN"],
  "/api/company-verification/documents/upload-intents": [
    "EMPLOYER",
    "RECRUITER",
  ],
  "/api/documents/read": ["AUTHENTICATED"],
  "/api/documents/read-grants/[id]/revoke": ["AUTHENTICATED"],
  "/api/documents/status": ["CANDIDATE"],
  "/api/documents/upload-intents": ["CANDIDATE"],
  "/api/documents/upload-intents/[id]/body": ["CANDIDATE"],
  "/api/documents/upload-intents/[id]/finalize": ["CANDIDATE"],
  "/api/documents/versions/[id]/delete-request": ["CANDIDATE"],
  "/api/documents/versions/[id]/read-grants": [
    "CANDIDATE",
    "EMPLOYER",
    "RECRUITER",
  ],
  "/api/documents/versions/[id]/scan": ["CANDIDATE"],
  "/api/privacy/exports/[id]": ["CANDIDATE"],
  "/api/recruiting/interviews/[id]/calendar": [
    "CANDIDATE",
    "EMPLOYER",
    "RECRUITER",
  ],
  "/api/webhooks/payments/[provider]": ["PAYMENT_PROVIDER_SIGNATURE"],
  "/dev/mailbox": ["LOCAL_OPS_TOKEN"],
  "/health/live": ["PUBLIC_OPERATIONS"],
  "/health/ready": ["PUBLIC_OPERATIONS"],
  "/invite/[token]": ["PUBLIC_TOKEN"],
  "/logout": ["AUTHENTICATED"],
  "/session/clear": ["AUTHENTICATED"],
  "/session/refresh": ["AUTHENTICATED"],
} as const satisfies Readonly<Record<string, readonly string[]>>);

// Reserved before the provider route lands so its first audit can never fall
// through to a public/default classification. Reserved policies are not
// emitted into the implemented-route inventory until the file exists.
export const RESERVED_ROUTE_HANDLER_ROLES = Object.freeze({
  "/api/webhooks/email/resend": ["EMAIL_PROVIDER_SIGNATURE"],
} as const satisfies Readonly<Record<string, readonly string[]>>);

export function rolesForRouteHandler(path: string): readonly string[] | null {
  if (Object.hasOwn(ROUTE_HANDLER_ROLES, path)) {
    return ROUTE_HANDLER_ROLES[path as keyof typeof ROUTE_HANDLER_ROLES];
  }
  if (Object.hasOwn(RESERVED_ROUTE_HANDLER_ROLES, path)) {
    return RESERVED_ROUTE_HANDLER_ROLES[
      path as keyof typeof RESERVED_ROUTE_HANDLER_ROLES
    ];
  }
  return null;
}
