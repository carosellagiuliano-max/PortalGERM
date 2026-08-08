import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { safeToolEnvironment } from "@/scripts/ops/process-tools";

type ProductionHstsEnvironmentInput = Readonly<{
  sourceEnvironment: NodeJS.ProcessEnv;
  databaseUrl: string;
  buildId: string;
  secretCanary?: string;
}>;

type HttpSmokeRuntimeRootInput = Readonly<{
  sourceRoot: string;
  configuredArtifactRoot?: string;
  mode: "local-full" | "production-hsts";
}>;

/**
 * HSTS owns a fresh production-like build in the source clone. A caller may
 * provide APP_ARTIFACT_ROOT for the ordinary HTTP/browser gates, but that
 * Local artifact must never replace the production build that HSTS just made.
 */
export function resolveHttpSmokeRuntimeRoot({
  sourceRoot,
  configuredArtifactRoot,
  mode,
}: HttpSmokeRuntimeRootInput) {
  return mode === "production-hsts" || configuredArtifactRoot === undefined
    ? resolve(sourceRoot)
    : resolve(configuredArtifactRoot);
}

/**
 * Builds the deliberately minimal production profile used by the HSTS smoke.
 *
 * The smoke runs from Local/CI gates whose parent environment intentionally
 * enables sandbox capabilities. Application flags must therefore never be
 * inherited wholesale: doing so can either invalidate the production profile
 * or accidentally exercise a capability that the HSTS check does not own.
 */
export function createProductionHstsEnvironment({
  sourceEnvironment,
  databaseUrl,
  buildId,
  secretCanary,
}: ProductionHstsEnvironmentInput): NodeJS.ProcessEnv {
  const notificationDeliveryKeys = hstsSmokeKeyring(
    "hsts-notification-v1",
    databaseUrl,
    buildId,
  );
  const notificationRecipientHashKeys = hstsSmokeKeyring(
    "hsts-recipient-v1",
    databaseUrl,
    buildId,
  );
  return {
    ...safeToolEnvironment(sourceEnvironment),
    APP_ENV: "production",
    NODE_ENV: "production",
    APP_URL: "https://hsts-smoke.invalid",
    NEXT_PUBLIC_APP_NAME:
      sourceEnvironment.NEXT_PUBLIC_APP_NAME ?? "SwissTalentHub HSTS Smoke",
    APP_BUILD_ID: buildId,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: "",
    SESSION_SECRET: sourceEnvironment.SESSION_SECRET,
    AUDIT_IP_HASH_KEYS: sourceEnvironment.AUDIT_IP_HASH_KEYS,
    RADAR_OPAQUE_LOOKUP_KEYS: sourceEnvironment.RADAR_OPAQUE_LOOKUP_KEYS,
    RADAR_OPAQUE_ENCRYPTION_KEYS:
      sourceEnvironment.RADAR_OPAQUE_ENCRYPTION_KEYS,
    REVEAL_CONFIRMATION_KEYS: sourceEnvironment.REVEAL_CONFIRMATION_KEYS,
    PII_REVEAL_KEYS: sourceEnvironment.PII_REVEAL_KEYS,
    // The smoke owns an isolated database and must never require or inherit a
    // developer's/live notification keyring merely to boot the health route.
    NOTIFICATION_DELIVERY_KEYS: notificationDeliveryKeys,
    NOTIFICATION_RECIPIENT_HASH_KEYS: notificationRecipientHashKeys,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "1",
    IDENTITY_VERIFICATION_ENFORCEMENT: "true",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    DEV_MAILBOX_SECRET: "",
    NOTIFICATION_OUTBOX_PRODUCERS: "true",
    EMAIL_PROVIDER_MODE: "disabled",
    NOTIFICATION_DISPATCH: "paused",
    WORKER_RUNTIME: "paused",
    WORKER_SANDBOX_REPLAY: "false",
    PAYMENT_PROVIDER_MODE: "disabled",
    DOCUMENT_STORAGE_MODE: "disabled",
    DOCUMENT_SCANNER_MODE: "disabled",
    PRIVACY_PROCESSING_MODE: "disabled",
    PRIVACY_EXPORT_STORAGE_MODE: "disabled",
    ABUSE_REPORT_ADMIN_EMAILS: "security-smoke@example.test",
    BACKUP_AGE_RECIPIENT: "",
    BACKUP_AGE_IDENTITY_FILE: "",
    STRIPE_SECRET_KEY: "",
    EMAIL_PROVIDER_API_KEY: "",
    OPENAI_API_KEY: "",
    STORAGE_ENDPOINT: "",
    JOBROOM_API_URL: "",
    MAPS_API_KEY: "",
    ...(secretCanary === undefined
      ? {}
      : { HTTP_SMOKE_SECRET_CANARY: secretCanary }),
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function hstsSmokeKeyring(
  version: string,
  databaseUrl: string,
  buildId: string,
) {
  const key = createHash("sha256")
    .update(`phase34-hsts-smoke\0${version}\0${databaseUrl}\0${buildId}`)
    .digest("base64");
  return `${version}:${key}`;
}
