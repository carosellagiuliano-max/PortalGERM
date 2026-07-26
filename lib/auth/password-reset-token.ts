import "server-only";

import { createHmac } from "node:crypto";

import type { SecretHandle } from "@/lib/config/env-schema";

const PASSWORD_RESET_TOKEN_DOMAIN =
  "swisstalenthub.password-reset-token.v2";

/**
 * A reset bearer stays a 256-bit opaque value, but is reproducible from the
 * reset row id so a durable outbox can hydrate the link after a restart.
 * PostgreSQL stores only its SHA-256 hash.
 */
export function createPasswordResetToken(
  resetId: string,
  secret: SecretHandle<"SESSION_SECRET">,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      resetId,
    )
  ) {
    throw new TypeError("Password reset id is malformed.");
  }
  return secret.withValue((value) =>
    createHmac("sha256", Buffer.from(value, "base64"))
      .update(PASSWORD_RESET_TOKEN_DOMAIN, "utf8")
      .update("\0", "utf8")
      .update(resetId, "utf8")
      .digest("base64url"),
  );
}
