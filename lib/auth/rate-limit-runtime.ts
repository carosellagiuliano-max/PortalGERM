import "server-only";

import { createHmac } from "node:crypto";

import {
  consumeRateLimit,
  createMemoryRateLimitStore,
  createPostgresRateLimitStore,
  type RateLimitDecision,
  type RateLimitPresetName,
  type RateLimitStore,
  type ServerRateLimitIdentity,
} from "@/lib/auth/rate-limit";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";

let memoryStore: RateLimitStore | undefined;
let postgresStore: RateLimitStore | undefined;

export async function consumeAuthRateLimit(
  preset: Extract<RateLimitPresetName, "LOGIN" | "REGISTER" | "FORGOT_PASSWORD">,
  identity: Omit<ServerRateLimitIdentity, "sourceIp">,
  context: Pick<AuthRequestContext, "sourceIp">,
  now = new Date(),
  runtime?: Readonly<{
    environment: ServerEnvironment;
    database: DatabaseClient;
  }>,
): Promise<RateLimitDecision> {
  const environment = runtime?.environment ?? getServerEnvironment();
  const store = runtime === undefined
    ? getRateLimitStore(environment)
    : environment.RATE_LIMIT_BACKEND === "memory"
      ? (memoryStore ??= createMemoryRateLimitStore(memoryRuntime(environment)))
      : createPostgresRateLimitStore(runtime.database);
  const writer = environment.secrets.keyrings.AUDIT_IP_HASH_KEYS[0];
  if (writer === undefined) {
    throw new Error("The audit keyring has no active writer.");
  }

  return writer.key.withValue((secret) =>
    consumeRateLimit(
      preset,
      { ...identity, sourceIp: context.sourceIp },
      {
        store,
        key: { version: writer.version, secret },
        now,
      },
    ),
  );
}

export function hashAuthIdentifier(
  normalizedEmail: string,
  environment: ServerEnvironment = getServerEnvironment(),
): string {
  const writer = environment.secrets.keyrings.AUDIT_IP_HASH_KEYS[0];
  if (writer === undefined) {
    throw new Error("The audit keyring has no active writer.");
  }
  return writer.key.withValue((secret) =>
    `${writer.version}:${createHmac("sha256", secret)
      .update(`auth-identifier\0${normalizedEmail}`, "utf8")
      .digest("hex")}`,
  );
}

function getRateLimitStore(environment: ServerEnvironment): RateLimitStore {
  if (environment.RATE_LIMIT_BACKEND === "memory") {
    memoryStore ??= createMemoryRateLimitStore(memoryRuntime(environment));
    return memoryStore;
  }
  postgresStore ??= createPostgresRateLimitStore(getDatabase());
  return postgresStore;
}

function memoryRuntime(environment: ServerEnvironment): "local" | "test" {
  return environment.NODE_ENV === "test" ? "test" : "local";
}
