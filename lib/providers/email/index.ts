import "server-only";

import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  captureLocalMockEmail,
  validateLocalMockEmail,
} from "@/lib/providers/email/local-mock-mailbox";
import {
  MockEmailProvider,
  type LocalMockMailboxCapturePort,
} from "@/lib/providers/email/mock-email-provider";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";

import type { EmailProvider } from "./email-provider";
import { createLegacyLocalMockEmailProvider } from "./legacy-local-mock-provider";

let explicitMockProvider: EmailProvider | undefined;

const localMailboxCapturePort: LocalMockMailboxCapturePort = Object.freeze({
  validate(input: Parameters<LocalMockMailboxCapturePort["validate"]>[0]) {
    validateLocalMockEmail(input);
  },
  capture(input: Parameters<LocalMockMailboxCapturePort["capture"]>[0]) {
    captureLocalMockEmail(input);
  },
});

function getExplicitMockProvider() {
  explicitMockProvider ??= new MockEmailProvider(
    new PrismaEmailLogRepository(getDatabase()),
    { mailbox: localMailboxCapturePort },
  );
  return explicitMockProvider;
}

/** Explicit mock-only composition root. No provider env key can switch it. */
export const emailProvider: EmailProvider = Object.freeze({
  ...createLegacyLocalMockEmailProvider({
    getMode: () => getServerEnvironment().EMAIL_PROVIDER_MODE,
    getLocalProvider: getExplicitMockProvider,
  }),
});

export { MockEmailProvider } from "./mock-email-provider";
export type { EmailProvider, EmailTemplateKey } from "./email-provider";
