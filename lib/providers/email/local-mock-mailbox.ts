import "server-only";

import { createHash } from "node:crypto";

import { getServerEnvironment } from "@/lib/config/env";
import {
  LocalMockMailbox,
  type LocalMockMailboxCaptureInput,
  type LocalMockMailboxReadResult,
} from "@/lib/providers/email/local-mock-mailbox-core";

type ProcessMailboxState = Readonly<{
  configurationFingerprint: string;
  mailbox: LocalMockMailbox;
}>;

declare global {
  var swissTalentHubLocalMockMailbox: ProcessMailboxState | undefined;
}

export type ConfiguredMailboxReadResult =
  | Readonly<{ status: "closed" }>
  | LocalMockMailboxReadResult;

export function captureLocalMockEmail(
  input: LocalMockMailboxCaptureInput,
): "disabled" | "recorded" | "duplicate" {
  const mailbox = getConfiguredMailbox();
  return mailbox?.capture(input) ?? "disabled";
}

export function validateLocalMockEmail(
  input: LocalMockMailboxCaptureInput,
): "disabled" | "valid" {
  const mailbox = getConfiguredMailbox();
  if (mailbox === undefined) {
    return "disabled";
  }
  mailbox.validate(input);
  return "valid";
}

export function consumeLocalMockEmail(
  authorizationHeader: string | null,
): ConfiguredMailboxReadResult {
  const mailbox = getConfiguredMailbox();
  return mailbox?.consume(authorizationHeader) ?? Object.freeze({ status: "closed" });
}

function getConfiguredMailbox() {
  const environment = getServerEnvironment();
  if (
    environment.NODE_ENV === "production" ||
    environment.APP_ENV === "production" ||
    environment.APP_ENV === "staging" ||
    !environment.ENABLE_LOCAL_MOCK_MAILBOX
  ) {
    return undefined;
  }

  const secretHandle = environment.secrets.localMailbox;
  if (secretHandle === undefined) {
    return undefined;
  }

  return secretHandle.withValue((secret) => {
    const configurationFingerprint = createHash("sha256")
      .update("local-mock-mailbox-configuration-v1\0", "utf8")
      .update(environment.APP_URL, "utf8")
      .update("\0", "utf8")
      .update(secret, "utf8")
      .digest("hex");
    const current = globalThis.swissTalentHubLocalMockMailbox;
    if (current?.configurationFingerprint === configurationFingerprint) {
      return current.mailbox;
    }

    const mailbox = new LocalMockMailbox({
      allowedOrigin: environment.APP_URL,
      secret,
    });
    globalThis.swissTalentHubLocalMockMailbox = Object.freeze({
      configurationFingerprint,
      mailbox,
    });
    return mailbox;
  });
}
