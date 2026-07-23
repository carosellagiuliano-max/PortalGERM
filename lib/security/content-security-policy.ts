export const CONTENT_SECURITY_POLICY_HEADER = "content-security-policy";
export const CONTENT_SECURITY_POLICY_NONCE_HEADER = "x-nonce";

const NONCE_PATTERN = /^[a-f0-9]{32}$/u;

export function createContentSecurityPolicyNonce() {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}

export function isValidContentSecurityPolicyNonce(
  value: string | null | undefined,
): value is string {
  return value !== null && value !== undefined && NONCE_PATTERN.test(value);
}

export function buildContentSecurityPolicy(
  nonce: string,
  options: Readonly<{ development?: boolean }> = {},
) {
  if (!isValidContentSecurityPolicyNonce(nonce)) {
    throw new Error("A valid per-request CSP nonce is required.");
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(options.development ? ["'unsafe-eval'"] : []),
  ];
  const connectSources = [
    "'self'",
    ...(options.development ? ["ws:", "wss:"] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "media-src 'self'",
  ].join("; ");
}
