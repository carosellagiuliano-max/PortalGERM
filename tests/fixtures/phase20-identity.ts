import { randomUUID } from "node:crypto";

import { hashPassword, PASSWORD_HASH_POLICY_V1 } from "@/lib/auth/password";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { issueSession } from "@/lib/auth/session-issuance";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { createValidEnvironment } from "@/tests/fixtures/environment";

export const PHASE20_NOW = new Date("2026-07-26T12:00:00.000Z");
export const PHASE20_APP_URL = "http://phase20-identity.test";
export const PHASE20_PASSWORD = "Phase20!SecurePassword42";

export function phase20Environment(
  connectionString: string,
  overrides: Record<string, string | undefined> = {},
): ServerEnvironment {
  return parseEnvironment(
    createValidEnvironment({
      APP_URL: PHASE20_APP_URL,
      DATABASE_URL: connectionString,
      RATE_LIMIT_BACKEND: "postgres",
      NOTIFICATION_OUTBOX_PRODUCERS: "true",
      ...overrides,
    }),
  );
}

export function phase20Request(index: number): AuthRequestContext {
  return Object.freeze({
    correlationId: randomUUID(),
    expectedOrigin: PHASE20_APP_URL,
    origin: PHASE20_APP_URL,
    production: false,
    sourceIp: `198.51.100.${(index % 200) + 1}`,
    userAgent: "SwissTalentHub Phase 20 integration test",
  });
}

export async function createPhase20User(
  database: DatabaseClient,
  input: Readonly<{
    email: string;
    role?: "CANDIDATE" | "EMPLOYER" | "RECRUITER";
    verified?: boolean;
    passwordHash?: string;
  }>,
) {
  const passwordHash =
    input.passwordHash ?? (await hashPassword(PHASE20_PASSWORD));
  return database.user.create({
    data: {
      email: input.email,
      emailNormalized: input.email,
      name: "Phase 20 Identity",
      role: input.role ?? "CANDIDATE",
      dataProvenance: "TEST",
      emailVerifiedAt: input.verified ? PHASE20_NOW : null,
      identityAssurance: input.verified
        ? "VERIFIED_EMAIL"
        : "LOW_ASSURANCE",
      credential: {
        create: {
          passwordHash,
          algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
          algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
          passwordChangedAt: PHASE20_NOW,
        },
      },
    },
    select: { id: true, emailNormalized: true, emailAddressEpoch: true },
  });
}

export async function issuePhase20Session(
  database: DatabaseClient,
  environment: ServerEnvironment,
  userId: string,
  request = phase20Request(1),
) {
  return database.$transaction((transaction) =>
    issueSession(transaction, {
      userId,
      now: PHASE20_NOW,
      request,
      auditIpKeyring:
        environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
    }),
  );
}
