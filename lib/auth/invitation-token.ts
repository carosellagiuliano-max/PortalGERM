import "server-only";

import { createHmac } from "node:crypto";

import type { SecretHandle } from "@/lib/config/env-schema";

const INVITATION_TOKEN_DOMAIN = "swisstalenthub.company-invitation-token.v2";

export function createCompanyInvitationToken(
  invitationId: string,
  version: number,
  secret: SecretHandle<"SESSION_SECRET">,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      invitationId,
    ) ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new TypeError("Company invitation token input is malformed.");
  }
  return secret.withValue((value) =>
    createHmac("sha256", Buffer.from(value, "base64"))
      .update(INVITATION_TOKEN_DOMAIN, "utf8")
      .update("\0", "utf8")
      .update(invitationId, "utf8")
      .update("\0", "utf8")
      .update(String(version), "utf8")
      .digest("base64url"),
  );
}
