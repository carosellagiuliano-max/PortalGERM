export const EMAIL_VERIFICATION_POLICY_V1 = Object.freeze({
  schemaVersion: "email-verification-v1",
  tokenVersion: "v1",
  ttlMilliseconds: 30 * 60 * 1_000,
  maximumTokenLength: 256,
  targetHashDomain: "swisstalenthub.email-verification-target.v1",
  tokenSignatureDomain: "swisstalenthub.email-verification-token.v1",
});

export const LOW_ASSURANCE_ALLOWED_ACTIONS_V1 = Object.freeze([
  "LOGOUT",
  "VERIFY_EMAIL",
  "RESEND_VERIFICATION",
  "SECURITY_HELP",
  "ONBOARDING_DRAFT",
] as const);

export type IdentityActionV1 =
  | (typeof LOW_ASSURANCE_ALLOWED_ACTIONS_V1)[number]
  | "APPLICATION_SUBMIT"
  | "COMPANY_PUBLISH"
  | "BILLING_WRITE"
  | "RADAR_WRITE"
  | "PRIVACY_EXECUTE"
  | "TEAM_ROLE_WRITE"
  | "LOGIN_EMAIL_CHANGE";

export function hasVerifiedEmailIdentity(input: Readonly<{
  assurance: "LOW_ASSURANCE" | "VERIFIED_EMAIL" | "LEGACY_ASSURANCE";
  emailVerifiedAt: Date | null;
}>) {
  return (
    input.assurance === "VERIFIED_EMAIL" &&
    input.emailVerifiedAt !== null
  );
}

export function isIdentityActionAllowed(input: Readonly<{
  action: IdentityActionV1;
  assurance: "LOW_ASSURANCE" | "VERIFIED_EMAIL" | "LEGACY_ASSURANCE";
  emailVerifiedAt: Date | null;
}>) {
  if (hasVerifiedEmailIdentity(input)) {
    return true;
  }
  return LOW_ASSURANCE_ALLOWED_ACTIONS_V1.includes(
    input.action as (typeof LOW_ASSURANCE_ALLOWED_ACTIONS_V1)[number],
  );
}

export function isVerificationChallengeCurrent(input: Readonly<{
  addressEpoch: number;
  currentAddressEpoch: number;
  expiresAt: Date;
  usedAt: Date | null;
  supersededAt: Date | null;
  now: Date;
}>) {
  return (
    input.addressEpoch === input.currentAddressEpoch &&
    input.expiresAt.getTime() > input.now.getTime() &&
    input.usedAt === null &&
    input.supersededAt === null
  );
}

export function publicVerificationMessage(
  state:
    | "requested"
    | "verified"
    | "invalid"
    | "rate_limited",
) {
  switch (state) {
    case "requested":
      return "Falls ein passendes Konto existiert, wurde eine neue Bestätigungsnachricht vorbereitet.";
    case "verified":
      return "Deine E-Mail-Adresse wurde bestätigt.";
    case "rate_limited":
      return "Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.";
    case "invalid":
      return "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.";
  }
}
