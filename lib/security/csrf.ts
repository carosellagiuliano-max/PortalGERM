const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CsrfOriginDecision = Readonly<{
  allowed: boolean;
  reason?: "MISSING_ORIGIN" | "INVALID_ORIGIN" | "ORIGIN_MISMATCH";
}>;

export function verifyCsrfOrigin(input: Readonly<{
  method: string;
  originHeader?: string | null;
  expectedOrigin: string;
}>): CsrfOriginDecision {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return Object.freeze({ allowed: true });
  }
  if (!input.originHeader) {
    return Object.freeze({ allowed: false, reason: "MISSING_ORIGIN" });
  }
  try {
    const actual = new URL(input.originHeader);
    const expected = new URL(input.expectedOrigin);
    if (actual.username || actual.password || expected.username || expected.password) {
      return Object.freeze({ allowed: false, reason: "INVALID_ORIGIN" });
    }
    return actual.origin === expected.origin
      ? Object.freeze({ allowed: true })
      : Object.freeze({ allowed: false, reason: "ORIGIN_MISMATCH" });
  } catch {
    return Object.freeze({ allowed: false, reason: "INVALID_ORIGIN" });
  }
}
