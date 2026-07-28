import { Buffer } from "node:buffer";
import { posix, win32 } from "node:path";

import { z } from "zod";

import { inspectPostgresTarget } from "@/lib/db/database-target";
import { BUILD_IDENTIFIER_PATTERN } from "@/lib/health/build-identifier";

const KEYRING_VARIABLES = [
  "AUDIT_IP_HASH_KEYS",
  "RADAR_OPAQUE_LOOKUP_KEYS",
  "RADAR_OPAQUE_ENCRYPTION_KEYS",
  "REVEAL_CONFIRMATION_KEYS",
  "PII_REVEAL_KEYS",
  "NOTIFICATION_DELIVERY_KEYS",
  "DOCUMENT_STORAGE_KEYS",
  "PRIVACY_EXPORT_KEYS",
] as const;

const FUTURE_PROVIDER_VARIABLES = [
  "OPENAI_API_KEY",
  "STORAGE_ENDPOINT",
  "JOBROOM_API_URL",
  "MAPS_API_KEY",
] as const;

const SENSITIVE_VARIABLES = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "SESSION_SECRET",
  "DEV_MAILBOX_SECRET",
  ...KEYRING_VARIABLES,
  ...FUTURE_PROVIDER_VARIABLES,
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "EMAIL_PROVIDER_API_KEY",
] as const;

const PLACEHOLDER_PATTERN =
  /(replace|change[-_ ]?me|placeholder|example|your[-_]|<[^>]+>)/i;
const KEY_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;
const secretPurpose: unique symbol = Symbol("secret-purpose");

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const adminEmailDistribution = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform((value) =>
      value.split(",").map((email) => email.trim().toLowerCase()),
    )
    .pipe(z.array(z.string().email().max(320)).min(1).max(20))
    .refine(
      (emails) => new Set(emails).size === emails.length,
      "must not contain duplicate recipients",
    )
    .transform((emails) => Object.freeze([...emails]))
    .optional(),
);

const rawEnvironmentSchema = z
  .object({
    APP_ENV: z.enum(["local", "ci", "preview", "staging", "production"], {
      error: "is required",
    }),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z
      .string({ error: "is required" })
      .refine(isPostgresUrl, "must be a postgresql:// or postgres:// URL"),
    TEST_DATABASE_URL: optionalString.refine(
      (value) => value === undefined || isPostgresUrl(value),
      "must be a postgresql:// or postgres:// URL",
    ),
    APP_URL: z
      .string({ error: "is required" })
      .refine(
        isHttpOrigin,
        "must be an absolute credential-free http(s) origin",
      ),
    NEXT_PUBLIC_APP_NAME: z
      .string({ error: "is required" })
      .trim()
      .min(2, "must contain at least 2 characters")
      .max(80, "must contain at most 80 characters"),
    APP_BUILD_ID: optionalString.refine(
      (value) => value === undefined || BUILD_IDENTIFIER_PATTERN.test(value),
      "must be a safe non-secret build identifier",
    ),
    SESSION_SECRET: z.string({ error: "is required" }),
    AUDIT_IP_HASH_KEYS: z.string({ error: "is required" }),
    RADAR_OPAQUE_LOOKUP_KEYS: z.string({ error: "is required" }),
    RADAR_OPAQUE_ENCRYPTION_KEYS: z.string({ error: "is required" }),
    REVEAL_CONFIRMATION_KEYS: z.string({ error: "is required" }),
    PII_REVEAL_KEYS: z.string({ error: "is required" }),
    NOTIFICATION_DELIVERY_KEYS: optionalString,
    DOCUMENT_STORAGE_KEYS: optionalString,
    PRIVACY_EXPORT_KEYS: optionalString,
    RATE_LIMIT_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),
    ENABLE_LOCAL_MOCK_MAILBOX: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DEV_MAILBOX_SECRET: optionalString,
    IDENTITY_VERIFICATION_ENFORCEMENT: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LOGIN_EMAIL_CHANGE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ADMIN_MFA_REQUIRED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVILEGED_STEP_UP_MODE: z
      .enum(["disabled", "observe", "enforce"])
      .default("disabled"),
    TRUST_RISK_MODE: z
      .enum(["observe", "hold"])
      .default("observe"),
    COMPANY_TRUST_V2: z
      .enum(["disabled", "observe", "enforce"])
      .default("disabled"),
    COMPANY_DOMAIN_CHALLENGE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    COMPANY_REGISTER_CHECK: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    COMPANY_VERIFICATION_DOCUMENT: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    COMPANY_STRONG_BADGE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    COMPANY_TRUST_PUBLIC_ELIGIBILITY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    COMPANY_TRUST_RAPID_REVOKE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LEGACY_COMPANY_REVERIFY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    COMPANY_REGISTER_PROVIDER_MODE: z
      .enum(["disabled", "deterministic_sandbox"])
      .default("disabled"),
    COMPANY_DOMAIN_PROVIDER_MODE: z
      .enum(["disabled", "deterministic_sandbox"])
      .default("disabled"),
    COMPANY_VERIFICATION_COHORT: z.enum(["none", "test"]).default("none"),
    IDENTITY_PERSONA_V2: z
      .enum(["disabled", "dual_read", "internal", "allowlist", "launch_scope"])
      .default("disabled"),
    EXISTING_IDENTITY_INVITATION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PERSONA_PORTAL_SWITCH: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PERSONA_PRIVACY_V2: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PERSONA_LEGACY_CONTRACT: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    BREAK_GLASS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    NOTIFICATION_OUTBOX_PRODUCERS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    EMAIL_PROVIDER_MODE: z
      .enum(["disabled", "local_mock", "resend_sandbox"])
      .default("disabled"),
    NOTIFICATION_DISPATCH: z.enum(["paused", "command"]).default("paused"),
    OPTIONAL_EMAIL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DELIVERY_REPLAY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    WORKER_RUNTIME: z
      .enum(["paused", "sandbox_command", "autonomous"])
      .default("paused"),
    WORKER_SANDBOX_REPLAY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PAYMENT_PROVIDER_MODE: z
      .enum(["disabled", "stripe_sandbox"])
      .default("disabled"),
    PAYMENT_SANDBOX_COHORT: z.enum(["none", "test"]).default("none"),
    REAL_PAYMENT_INGESTION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    REAL_PAYMENT_PROJECTION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PAID_SELF_SERVICE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    FINANCE_REPAIR_ACTIONS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PAID_SERVICE_RECOVERY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DOCUMENT_VAULT_WRITES: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DOCUMENT_STORAGE_MODE: z
      .enum(["disabled", "filesystem_sandbox"])
      .default("disabled"),
    DOCUMENT_SCANNER_MODE: z.enum(["disabled", "sandbox"]).default("disabled"),
    DOCUMENT_CLEAN_READS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DOCUMENT_RECONCILIATION: z
      .enum(["disabled", "dry_run", "command"])
      .default("disabled"),
    DOCUMENT_BULK_ACCESS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DOCUMENT_VAULT_COHORT: z.enum(["none", "test"]).default("none"),
    DOCUMENT_STORAGE_ROOT: optionalString,
    DOCUMENT_STORAGE_REGION: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,31}$/u)
      .default("local-test"),
    LEGAL_PUBLICATION_PRIVACY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LEGAL_PUBLICATION_TERMS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LEGAL_PUBLICATION_IMPRINT: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_EXPORT_V2: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_CORRECTION_EXECUTION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_ERASURE_EXECUTION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_PROCESSING_MODE: z
      .enum(["disabled", "sandbox_command"])
      .default("disabled"),
    PRIVACY_PROCESSING_COHORT: z.enum(["none", "test"]).default("none"),
    PRIVACY_EXPORT_STORAGE_MODE: z
      .enum(["disabled", "filesystem_sandbox"])
      .default("disabled"),
    PRIVACY_EXPORT_STORAGE_ROOT: optionalString,
    PRIVACY_EXPORT_STORAGE_REGION: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,31}$/u)
      .default("local-test"),
    PRIVACY_PROVIDER_POSTGRES: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_PROVIDER_DOCUMENTS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_PROVIDER_EMAIL: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_PROVIDER_PAYMENT: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_PROVIDER_ANALYTICS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PRIVACY_PROVIDER_BACKUP: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    OPTIONAL_ANALYTICS_NAVIGATION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    OPTIONAL_ANALYTICS_CONVERSION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SEARCH_LEARNING_COLLECTION: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    EMAIL_FROM: optionalString.refine(
      (value) =>
        value === undefined ||
        /^[^<>\r\n]{1,120}<[^<>\s@]+@[^<>\s@]+>$/.test(value) ||
        /^[^<>\s@]+@[^<>\s@]+$/.test(value),
      "must be a bounded mailbox or display-name mailbox",
    ),
    ABUSE_REPORT_ADMIN_EMAILS: adminEmailDistribution,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    BACKUP_AGE_RECIPIENT: optionalString,
    BACKUP_AGE_IDENTITY_FILE: optionalString,
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    STRIPE_ACCOUNT_ID: optionalString,
    STRIPE_SECRET_VERSION: optionalString,
    EMAIL_PROVIDER_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    STORAGE_ENDPOINT: optionalString,
    JOBROOM_API_URL: optionalString,
    MAPS_API_KEY: optionalString,
  })
  .superRefine((environment, context) => {
    validateBase64Secret("SESSION_SECRET", environment.SESSION_SECRET, context);

    const seenKeyMaterial = new Map<string, string>();
    registerUniqueKeyMaterial(
      "SESSION_SECRET",
      environment.SESSION_SECRET,
      seenKeyMaterial,
      context,
    );

    for (const variable of KEYRING_VARIABLES) {
      const value = environment[variable];
      if (value === undefined) continue;
      const entries = parseKeyring(variable, value, context);
      for (const entry of entries) {
        registerUniqueKeyMaterial(
          `${variable}.${entry.version}`,
          entry.secret,
          seenKeyMaterial,
          context,
          variable,
        );
      }
    }

    const productionLike =
      environment.APP_ENV === "production" || environment.APP_ENV === "staging";
    const productionRuntime =
      productionLike || environment.NODE_ENV === "production";

    validateTestDatabaseIsolation(environment, context, productionLike);

    if (
      environment.RATE_LIMIT_BACKEND !== "postgres" &&
      environment.APP_ENV !== "local"
    ) {
      context.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_BACKEND"],
        message: "must be postgres outside local and test runtimes",
      });
    }

    if (productionLike && environment.TRUSTED_PROXY_HOPS < 1) {
      context.addIssue({
        code: "custom",
        path: ["TRUSTED_PROXY_HOPS"],
        message: "must be at least 1 in staging and production",
      });
    }

    if (productionRuntime && environment.ENABLE_LOCAL_MOCK_MAILBOX) {
      context.addIssue({
        code: "custom",
        path: ["ENABLE_LOCAL_MOCK_MAILBOX"],
        message: "must be false in a production runtime",
      });
    }

    if (
      environment.NOTIFICATION_OUTBOX_PRODUCERS &&
      environment.NOTIFICATION_DELIVERY_KEYS === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["NOTIFICATION_DELIVERY_KEYS"],
        message: "is required when notification outbox producers are enabled",
      });
    }

    if (
      environment.IDENTITY_VERIFICATION_ENFORCEMENT &&
      !environment.NOTIFICATION_OUTBOX_PRODUCERS
    ) {
      context.addIssue({
        code: "custom",
        path: ["IDENTITY_VERIFICATION_ENFORCEMENT"],
        message:
          "requires notification outbox producers so users cannot be locked without a verification message",
      });
    }

    if (
      environment.LOGIN_EMAIL_CHANGE &&
      (!environment.IDENTITY_VERIFICATION_ENFORCEMENT ||
        !environment.NOTIFICATION_OUTBOX_PRODUCERS)
    ) {
      context.addIssue({
        code: "custom",
        path: ["LOGIN_EMAIL_CHANGE"],
        message:
          "requires verified-identity enforcement and notification outbox producers",
      });
    }

    if (environment.BREAK_GLASS_ENABLED && !environment.ADMIN_MFA_REQUIRED) {
      context.addIssue({
        code: "custom",
        path: ["BREAK_GLASS_ENABLED"],
        message: "requires mandatory Admin MFA",
      });
    }

    if (
      environment.PRIVILEGED_STEP_UP_MODE === "enforce" &&
      !environment.IDENTITY_VERIFICATION_ENFORCEMENT
    ) {
      context.addIssue({
        code: "custom",
        path: ["PRIVILEGED_STEP_UP_MODE"],
        message: "requires verified-identity enforcement",
      });
    }

    const companyTrustPublicCapability =
      environment.COMPANY_STRONG_BADGE ||
      environment.COMPANY_TRUST_PUBLIC_ELIGIBILITY;
    const companyProviderSandboxSelected =
      environment.COMPANY_REGISTER_PROVIDER_MODE ===
        "deterministic_sandbox" ||
      environment.COMPANY_DOMAIN_PROVIDER_MODE === "deterministic_sandbox";
    if (
      companyProviderSandboxSelected &&
      (!["local", "ci"].includes(environment.APP_ENV) ||
        environment.COMPANY_VERIFICATION_COHORT !== "test")
    ) {
      context.addIssue({
        code: "custom",
        path: ["COMPANY_VERIFICATION_COHORT"],
        message:
          "deterministic company-verification providers require the isolated Local/CI test cohort",
      });
    }
    if (
      environment.COMPANY_REGISTER_CHECK &&
      environment.COMPANY_REGISTER_PROVIDER_MODE === "disabled"
    ) {
      context.addIssue({
        code: "custom",
        path: ["COMPANY_REGISTER_CHECK"],
        message: "requires an explicit company register provider mode",
      });
    }
    if (
      environment.COMPANY_DOMAIN_CHALLENGE &&
      environment.COMPANY_DOMAIN_PROVIDER_MODE === "disabled"
    ) {
      context.addIssue({
        code: "custom",
        path: ["COMPANY_DOMAIN_CHALLENGE"],
        message: "requires an explicit company domain provider mode",
      });
    }
    if (
      environment.COMPANY_VERIFICATION_DOCUMENT &&
      (!environment.DOCUMENT_VAULT_WRITES ||
        environment.DOCUMENT_STORAGE_MODE === "disabled" ||
        environment.DOCUMENT_SCANNER_MODE === "disabled")
    ) {
      context.addIssue({
        code: "custom",
        path: ["COMPANY_VERIFICATION_DOCUMENT"],
        message:
          "requires enabled vault writes plus explicit storage and scanner modes",
      });
    }

    const personaRuntimeEnabled =
      environment.EXISTING_IDENTITY_INVITATION ||
      environment.PERSONA_PORTAL_SWITCH ||
      environment.PERSONA_PRIVACY_V2 ||
      environment.PERSONA_LEGACY_CONTRACT;
    if (
      personaRuntimeEnabled &&
      environment.IDENTITY_PERSONA_V2 === "disabled"
    ) {
      context.addIssue({
        code: "custom",
        path: ["IDENTITY_PERSONA_V2"],
        message: "must be enabled before any Phase-27 runtime surface",
      });
    }
    if (
      (environment.EXISTING_IDENTITY_INVITATION ||
        environment.PERSONA_PORTAL_SWITCH) &&
      environment.IDENTITY_PERSONA_V2 === "dual_read"
    ) {
      context.addIssue({
        code: "custom",
        path: ["IDENTITY_PERSONA_V2"],
        message:
          "dual_read cannot expose invitation acceptance or portal switching",
      });
    }
    if (
      environment.PERSONA_LEGACY_CONTRACT &&
      (environment.IDENTITY_PERSONA_V2 !== "launch_scope" ||
        !environment.EXISTING_IDENTITY_INVITATION ||
        !environment.PERSONA_PORTAL_SWITCH ||
        !environment.PERSONA_PRIVACY_V2)
    ) {
      context.addIssue({
        code: "custom",
        path: ["PERSONA_LEGACY_CONTRACT"],
        message:
          "requires launch_scope plus invitation, switch and privacy contracts",
      });
    }
    if (
      companyTrustPublicCapability &&
      environment.COMPANY_TRUST_V2 !== "enforce"
    ) {
      context.addIssue({
        code: "custom",
        path: ["COMPANY_TRUST_V2"],
        message:
          "must be enforce before a strong badge or trust-based public eligibility can be enabled",
      });
    }
    if (
      companyTrustPublicCapability &&
      (!environment.COMPANY_REGISTER_CHECK ||
        !environment.COMPANY_DOMAIN_CHALLENGE)
    ) {
      context.addIssue({
        code: "custom",
        path: ["COMPANY_TRUST_PUBLIC_ELIGIBILITY"],
        message:
          "requires both register and domain evidence gates to be enabled",
      });
    }
    if (productionLike && companyTrustPublicCapability) {
      context.addIssue({
        code: "custom",
        path: ["COMPANY_STRONG_BADGE"],
        message:
          "must remain false until a legally approved LIVE register/domain provider mode exists",
      });
    }
    if (
      environment.LEGACY_COMPANY_REVERIFY &&
      (!["local", "ci"].includes(environment.APP_ENV) ||
        environment.COMPANY_VERIFICATION_COHORT !== "test")
    ) {
      context.addIssue({
        code: "custom",
        path: ["LEGACY_COMPANY_REVERIFY"],
        message:
          "is limited to the bounded Local/CI test cohort until capacity and provider gates are approved",
      });
    }

    if (
      environment.ADMIN_MFA_REQUIRED &&
      productionLike &&
      !environment.APP_URL.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "must use https when Admin MFA is required",
      });
    }

    if (environment.EMAIL_PROVIDER_MODE === "local_mock" && productionRuntime) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER_MODE"],
        message: "local_mock is forbidden in production runtimes",
      });
    }

    if (environment.EMAIL_PROVIDER_MODE === "resend_sandbox") {
      if (
        environment.EMAIL_PROVIDER_API_KEY === undefined ||
        environment.EMAIL_FROM === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER_MODE"],
          message:
            "resend_sandbox requires EMAIL_PROVIDER_API_KEY and EMAIL_FROM",
        });
      }
      if (environment.NOTIFICATION_DELIVERY_KEYS === undefined) {
        context.addIssue({
          code: "custom",
          path: ["NOTIFICATION_DELIVERY_KEYS"],
          message: "is required for sandbox delivery",
        });
      }
    } else if (environment.EMAIL_PROVIDER_API_KEY !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER_API_KEY"],
        message: "must remain empty unless resend_sandbox is selected",
      });
    }

    if (
      environment.NOTIFICATION_DISPATCH === "command" &&
      environment.EMAIL_PROVIDER_MODE === "disabled"
    ) {
      context.addIssue({
        code: "custom",
        path: ["NOTIFICATION_DISPATCH"],
        message: "command dispatch requires an explicit provider mode",
      });
    }

    if (
      environment.DELIVERY_REPLAY &&
      (environment.APP_ENV !== "local" ||
        environment.EMAIL_PROVIDER_MODE !== "local_mock")
    ) {
      context.addIssue({
        code: "custom",
        path: ["DELIVERY_REPLAY"],
        message:
          "is allowed only with the isolated local_mock sandbox until Phase 25",
      });
    }

    if (
      environment.WORKER_RUNTIME === "sandbox_command" &&
      environment.APP_ENV !== "local" &&
      environment.APP_ENV !== "ci"
    ) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_RUNTIME"],
        message: "sandbox_command is allowed only in local or CI",
      });
    }

    if (
      environment.WORKER_SANDBOX_REPLAY &&
      (environment.WORKER_RUNTIME !== "sandbox_command" ||
        (environment.APP_ENV !== "local" && environment.APP_ENV !== "ci"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["WORKER_SANDBOX_REPLAY"],
        message:
          "requires the isolated Local/CI sandbox command runtime until Phase 25",
      });
    }

    const paymentCapabilityEnabled =
      environment.REAL_PAYMENT_INGESTION ||
      environment.REAL_PAYMENT_PROJECTION ||
      environment.PAID_SELF_SERVICE ||
      environment.FINANCE_REPAIR_ACTIONS ||
      environment.PAID_SERVICE_RECOVERY;
    const stripeSandboxSelected =
      environment.PAYMENT_PROVIDER_MODE === "stripe_sandbox";
    if (
      stripeSandboxSelected &&
      !["local", "ci", "staging"].includes(environment.APP_ENV)
    ) {
      context.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER_MODE"],
        message:
          "stripe_sandbox is forbidden in preview and production runtimes",
      });
    }
    if (stripeSandboxSelected) {
      if (
        environment.STRIPE_SECRET_KEY === undefined ||
        !/^sk_test_[A-Za-z0-9]{8,}$/u.test(environment.STRIPE_SECRET_KEY)
      ) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_SECRET_KEY"],
          message: "must be a Stripe test-mode secret for stripe_sandbox",
        });
      }
      if (
        environment.STRIPE_WEBHOOK_SECRET === undefined ||
        !/^whsec_[A-Za-z0-9]{8,}$/u.test(environment.STRIPE_WEBHOOK_SECRET)
      ) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_WEBHOOK_SECRET"],
          message:
            "must be a Stripe endpoint signing secret for stripe_sandbox",
        });
      }
      if (
        environment.STRIPE_ACCOUNT_ID === undefined ||
        !/^acct_[A-Za-z0-9]{8,}$/u.test(environment.STRIPE_ACCOUNT_ID)
      ) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_ACCOUNT_ID"],
          message: "is required and must identify the sandbox merchant account",
        });
      }
      if (
        environment.STRIPE_SECRET_VERSION === undefined ||
        !KEY_VERSION_PATTERN.test(environment.STRIPE_SECRET_VERSION)
      ) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_SECRET_VERSION"],
          message: "is required and must be a safe non-secret version label",
        });
      }
    } else if (
      environment.STRIPE_SECRET_KEY !== undefined ||
      environment.STRIPE_WEBHOOK_SECRET !== undefined ||
      environment.STRIPE_ACCOUNT_ID !== undefined ||
      environment.STRIPE_SECRET_VERSION !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER_MODE"],
        message: "Stripe configuration requires stripe_sandbox mode",
      });
    }
    if (paymentCapabilityEnabled && !stripeSandboxSelected) {
      context.addIssue({
        code: "custom",
        path: ["REAL_PAYMENT_INGESTION"],
        message: "payment capabilities require an explicit sandbox provider",
      });
    }
    if (
      environment.REAL_PAYMENT_PROJECTION &&
      !environment.REAL_PAYMENT_INGESTION
    ) {
      context.addIssue({
        code: "custom",
        path: ["REAL_PAYMENT_PROJECTION"],
        message: "requires durable real-payment ingestion",
      });
    }
    if (
      (environment.PAID_SELF_SERVICE || environment.PAID_SERVICE_RECOVERY) &&
      (environment.PAYMENT_SANDBOX_COHORT !== "test" ||
        (environment.APP_ENV !== "local" && environment.APP_ENV !== "ci"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["PAID_SELF_SERVICE"],
        message:
          "paid actions remain limited to the isolated Local/CI test cohort until Phase 25 and 31 gates",
      });
    }
    if (environment.PAID_SELF_SERVICE && !environment.REAL_PAYMENT_PROJECTION) {
      context.addIssue({
        code: "custom",
        path: ["PAID_SELF_SERVICE"],
        message: "requires signed ingestion and sandbox projection",
      });
    }
    if (environment.FINANCE_REPAIR_ACTIONS) {
      context.addIssue({
        code: "custom",
        path: ["FINANCE_REPAIR_ACTIONS"],
        message:
          "must remain false until Phase-25 finance capability and step-up are complete",
      });
    }
    if (
      environment.APP_ENV === "production" &&
      (stripeSandboxSelected || paymentCapabilityEnabled)
    ) {
      context.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER_MODE"],
        message:
          "Phase-24 contains no LIVE adapter; production payments must remain disabled",
      });
    }

    if (environment.OPTIONAL_EMAIL && productionLike) {
      context.addIssue({
        code: "custom",
        path: ["OPTIONAL_EMAIL"],
        message:
          "must remain false until the Phase-22 purpose decision is approved",
      });
    }

    const documentSandboxSelected =
      environment.DOCUMENT_STORAGE_MODE === "filesystem_sandbox" ||
      environment.DOCUMENT_SCANNER_MODE === "sandbox";
    const documentCapabilityEnabled =
      environment.DOCUMENT_VAULT_WRITES ||
      environment.DOCUMENT_CLEAN_READS ||
      environment.DOCUMENT_RECONCILIATION !== "disabled";

    if (
      documentSandboxSelected &&
      environment.APP_ENV !== "local" &&
      environment.APP_ENV !== "ci"
    ) {
      context.addIssue({
        code: "custom",
        path: ["DOCUMENT_STORAGE_MODE"],
        message: "filesystem/scanner sandbox is allowed only in local or CI",
      });
    }

    if (documentSandboxSelected) {
      if (
        environment.DOCUMENT_STORAGE_ROOT === undefined ||
        !isAbsolutePathOutsideRepository(environment.DOCUMENT_STORAGE_ROOT)
      ) {
        context.addIssue({
          code: "custom",
          path: ["DOCUMENT_STORAGE_ROOT"],
          message:
            "must be an absolute path outside the repository for the document sandbox",
        });
      }
      if (environment.DOCUMENT_STORAGE_KEYS === undefined) {
        context.addIssue({
          code: "custom",
          path: ["DOCUMENT_STORAGE_KEYS"],
          message: "is required for encrypted document sandbox storage",
        });
      }
    }

    if (
      documentCapabilityEnabled &&
      (environment.DOCUMENT_STORAGE_MODE !== "filesystem_sandbox" ||
        environment.DOCUMENT_SCANNER_MODE !== "sandbox" ||
        environment.DOCUMENT_VAULT_COHORT !== "test")
    ) {
      context.addIssue({
        code: "custom",
        path: ["DOCUMENT_VAULT_WRITES"],
        message:
          "document capabilities require the explicit filesystem/scanner test cohort",
      });
    }

    if (
      environment.DOCUMENT_CLEAN_READS &&
      !environment.DOCUMENT_VAULT_WRITES
    ) {
      context.addIssue({
        code: "custom",
        path: ["DOCUMENT_CLEAN_READS"],
        message: "requires document vault writes in the Phase-21 sandbox",
      });
    }

    if (environment.DOCUMENT_BULK_ACCESS) {
      context.addIssue({
        code: "custom",
        path: ["DOCUMENT_BULK_ACCESS"],
        message:
          "must remain false until the Phase-25 step-up gate is approved",
      });
    }

    if (
      productionLike &&
      (documentSandboxSelected || documentCapabilityEnabled)
    ) {
      context.addIssue({
        code: "custom",
        path: ["DOCUMENT_STORAGE_MODE"],
        message:
          "Phase-21 document bytes remain disabled in staging and production",
      });
    }

    const privacyExecutionEnabled =
      environment.PRIVACY_EXPORT_V2 ||
      environment.PRIVACY_CORRECTION_EXECUTION ||
      environment.PRIVACY_ERASURE_EXECUTION;
    const privacyProviderEnabled =
      environment.PRIVACY_PROVIDER_POSTGRES ||
      environment.PRIVACY_PROVIDER_DOCUMENTS ||
      environment.PRIVACY_PROVIDER_EMAIL ||
      environment.PRIVACY_PROVIDER_PAYMENT ||
      environment.PRIVACY_PROVIDER_ANALYTICS ||
      environment.PRIVACY_PROVIDER_BACKUP;
    const privacySandboxSelected =
      environment.PRIVACY_EXPORT_STORAGE_MODE === "filesystem_sandbox" ||
      environment.PRIVACY_PROCESSING_MODE === "sandbox_command";

    if (
      privacySandboxSelected &&
      environment.APP_ENV !== "local" &&
      environment.APP_ENV !== "ci"
    ) {
      context.addIssue({
        code: "custom",
        path: ["PRIVACY_PROCESSING_MODE"],
        message: "Phase-22 sandbox processing is allowed only in local or CI",
      });
    }
    if (
      privacyExecutionEnabled &&
      (environment.PRIVACY_PROCESSING_MODE !== "sandbox_command" ||
        environment.PRIVACY_PROCESSING_COHORT !== "test" ||
        !environment.PRIVACY_PROVIDER_POSTGRES)
    ) {
      context.addIssue({
        code: "custom",
        path: ["PRIVACY_PROCESSING_MODE"],
        message:
          "privacy execution requires sandbox_command, the test cohort and the PostgreSQL processor",
      });
    }
    if (
      (environment.PRIVACY_EXPORT_V2 ||
        environment.PRIVACY_EXPORT_STORAGE_MODE === "filesystem_sandbox") &&
      (environment.PRIVACY_EXPORT_STORAGE_MODE !== "filesystem_sandbox" ||
        environment.PRIVACY_EXPORT_STORAGE_ROOT === undefined ||
        !isAbsolutePathOutsideRepository(
          environment.PRIVACY_EXPORT_STORAGE_ROOT,
        ) ||
        environment.PRIVACY_EXPORT_KEYS === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["PRIVACY_EXPORT_STORAGE_MODE"],
        message:
          "export V2 requires encrypted filesystem sandbox storage outside the repository and a dedicated keyring",
      });
    }
    if (
      privacyProviderEnabled &&
      environment.PRIVACY_PROCESSING_MODE === "disabled"
    ) {
      context.addIssue({
        code: "custom",
        path: ["PRIVACY_PROVIDER_POSTGRES"],
        message: "privacy providers require an explicit processing mode",
      });
    }
    if (productionLike && (privacyExecutionEnabled || privacySandboxSelected)) {
      context.addIssue({
        code: "custom",
        path: ["PRIVACY_PROCESSING_MODE"],
        message:
          "Phase-22 execution remains disabled in staging and production until Phase-25 step-up and separated grants",
      });
    }
    if (environment.SEARCH_LEARNING_COLLECTION) {
      context.addIssue({
        code: "custom",
        path: ["SEARCH_LEARNING_COLLECTION"],
        message: "must remain false until the Phase-30A learning gate",
      });
    }

    if (productionLike && environment.ABUSE_REPORT_ADMIN_EMAILS === undefined) {
      context.addIssue({
        code: "custom",
        path: ["ABUSE_REPORT_ADMIN_EMAILS"],
        message:
          "must configure at least one abuse-report recipient in staging and production",
      });
    }

    if (productionLike && environment.APP_BUILD_ID === undefined) {
      context.addIssue({
        code: "custom",
        path: ["APP_BUILD_ID"],
        message:
          "must be a commit-unique non-secret identifier in staging and production",
      });
    }

    if (environment.ENABLE_LOCAL_MOCK_MAILBOX) {
      const mailboxSecret = environment.DEV_MAILBOX_SECRET;
      if (
        mailboxSecret === undefined ||
        !isCanonicalBase64SecretWithMinimumByteLength(mailboxSecret, 32) ||
        PLACEHOLDER_PATTERN.test(mailboxSecret)
      ) {
        context.addIssue({
          code: "custom",
          path: ["DEV_MAILBOX_SECRET"],
          message:
            "must encode at least 32 random bytes when the mailbox is enabled",
        });
      }
    }

    if (productionLike) {
      const appUrl = parseHttpOrigin(environment.APP_URL);
      if (appUrl !== undefined && appUrl.protocol !== "https:") {
        context.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "must use https in staging and production",
        });
      }
    }

    if (
      environment.BACKUP_AGE_IDENTITY_FILE !== undefined &&
      !isAbsolutePathOutsideRepository(environment.BACKUP_AGE_IDENTITY_FILE)
    ) {
      context.addIssue({
        code: "custom",
        path: ["BACKUP_AGE_IDENTITY_FILE"],
        message: "must be an absolute path outside the repository",
      });
    }

    for (const variable of FUTURE_PROVIDER_VARIABLES) {
      if (environment[variable] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [variable],
          message: "must remain empty until its provider gate is approved",
        });
      }
    }
  });

export type SecretHandle<TPurpose extends string = string> = Readonly<{
  readonly [secretPurpose]: TPurpose;
  withValue<TResult>(consumer: (value: string) => TResult): TResult;
}>;

class InMemorySecretHandle<
  TPurpose extends string,
> implements SecretHandle<TPurpose> {
  readonly #value: string;
  readonly [secretPurpose]: TPurpose;

  constructor(purpose: TPurpose, value: string) {
    this[secretPurpose] = purpose;
    this.#value = value;
    Object.freeze(this);
  }

  withValue<TResult>(consumer: (value: string) => TResult): TResult {
    return consumer(this.#value);
  }

  toJSON() {
    return "[secret-handle]";
  }

  toString() {
    return "[secret-handle]";
  }
}

type KeyringVariable = (typeof KEYRING_VARIABLES)[number];

export type KeyringEntry<TPurpose extends KeyringVariable = KeyringVariable> =
  Readonly<{
    version: string;
    key: SecretHandle<TPurpose>;
  }>;

type RawEnvironment = z.output<typeof rawEnvironmentSchema>;
type NonSecretEnvironment = Omit<
  RawEnvironment,
  (typeof SENSITIVE_VARIABLES)[number]
>;

export type ServerEnvironment = Readonly<
  NonSecretEnvironment & {
    secrets: Readonly<{
      database: SecretHandle<"DATABASE_URL">;
      testDatabase?: SecretHandle<"TEST_DATABASE_URL">;
      session: SecretHandle<"SESSION_SECRET">;
      localMailbox?: SecretHandle<"DEV_MAILBOX_SECRET">;
      emailProvider?: SecretHandle<"EMAIL_PROVIDER_API_KEY">;
      stripeSecretKey?: SecretHandle<"STRIPE_SECRET_KEY">;
      stripeWebhookSecret?: SecretHandle<"STRIPE_WEBHOOK_SECRET">;
      keyrings: Readonly<{
        readonly [Purpose in KeyringVariable]: readonly KeyringEntry<Purpose>[];
      }>;
    }>;
  }
>;

export class EnvironmentValidationError extends Error {
  readonly issues: readonly string[];

  constructor(error: z.ZodError) {
    const issues = error.issues.map((issue) => {
      const variable = issue.path.join(".") || "ENVIRONMENT";
      return `${variable}: ${issue.message}`;
    });

    super(`Environment validation failed: ${issues.join("; ")}`);
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

export function parseEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  const result = rawEnvironmentSchema.safeParse(input);

  if (!result.success) {
    throw new EnvironmentValidationError(result.error);
  }

  const keyrings = Object.freeze(
    Object.fromEntries(
      KEYRING_VARIABLES.map((variable) => [
        variable,
        parseValidatedKeyring(variable, result.data[variable]),
      ]),
    ),
  ) as ServerEnvironment["secrets"]["keyrings"];

  const environment = { ...result.data } as Record<string, unknown>;
  for (const variable of SENSITIVE_VARIABLES) {
    delete environment[variable];
  }

  return Object.freeze({
    ...(environment as NonSecretEnvironment),
    secrets: Object.freeze({
      database: createSecretHandle("DATABASE_URL", result.data.DATABASE_URL),
      ...(result.data.TEST_DATABASE_URL === undefined
        ? {}
        : {
            testDatabase: createSecretHandle(
              "TEST_DATABASE_URL",
              result.data.TEST_DATABASE_URL,
            ),
          }),
      session: createSecretHandle("SESSION_SECRET", result.data.SESSION_SECRET),
      ...(result.data.DEV_MAILBOX_SECRET === undefined
        ? {}
        : {
            localMailbox: createSecretHandle(
              "DEV_MAILBOX_SECRET",
              result.data.DEV_MAILBOX_SECRET,
            ),
          }),
      ...(result.data.EMAIL_PROVIDER_API_KEY === undefined
        ? {}
        : {
            emailProvider: createSecretHandle(
              "EMAIL_PROVIDER_API_KEY",
              result.data.EMAIL_PROVIDER_API_KEY,
            ),
          }),
      ...(result.data.STRIPE_SECRET_KEY === undefined
        ? {}
        : {
            stripeSecretKey: createSecretHandle(
              "STRIPE_SECRET_KEY",
              result.data.STRIPE_SECRET_KEY,
            ),
          }),
      ...(result.data.STRIPE_WEBHOOK_SECRET === undefined
        ? {}
        : {
            stripeWebhookSecret: createSecretHandle(
              "STRIPE_WEBHOOK_SECRET",
              result.data.STRIPE_WEBHOOK_SECRET,
            ),
          }),
      keyrings,
    }),
  });
}

export function getSafeEnvironmentSummary(environment: ServerEnvironment) {
  return Object.freeze({
    appEnvironment: environment.APP_ENV,
    nodeEnvironment: environment.NODE_ENV,
    appUrl: environment.APP_URL,
    appName: environment.NEXT_PUBLIC_APP_NAME,
    buildIdentifier: environment.APP_BUILD_ID ?? "local-development",
    logLevel: environment.LOG_LEVEL,
    rateLimitBackend: environment.RATE_LIMIT_BACKEND,
    trustedProxyHops: environment.TRUSTED_PROXY_HOPS,
    mailboxEnabled: environment.ENABLE_LOCAL_MOCK_MAILBOX,
    identityVerificationEnforced: environment.IDENTITY_VERIFICATION_ENFORCEMENT,
    loginEmailChangeEnabled: environment.LOGIN_EMAIL_CHANGE,
    adminMfaRequired: environment.ADMIN_MFA_REQUIRED,
    privilegedStepUpMode: environment.PRIVILEGED_STEP_UP_MODE,
    trustRiskMode: environment.TRUST_RISK_MODE,
    companyTrustV2: environment.COMPANY_TRUST_V2,
    companyDomainChallenge: environment.COMPANY_DOMAIN_CHALLENGE,
    companyRegisterCheck: environment.COMPANY_REGISTER_CHECK,
    companyVerificationDocument: environment.COMPANY_VERIFICATION_DOCUMENT,
    companyStrongBadge: environment.COMPANY_STRONG_BADGE,
    companyTrustPublicEligibility:
      environment.COMPANY_TRUST_PUBLIC_ELIGIBILITY,
    companyTrustRapidRevoke: environment.COMPANY_TRUST_RAPID_REVOKE,
    legacyCompanyReverify: environment.LEGACY_COMPANY_REVERIFY,
    companyRegisterProviderMode:
      environment.COMPANY_REGISTER_PROVIDER_MODE,
    companyDomainProviderMode: environment.COMPANY_DOMAIN_PROVIDER_MODE,
    companyVerificationCohort: environment.COMPANY_VERIFICATION_COHORT,
    identityPersonaV2: environment.IDENTITY_PERSONA_V2,
    existingIdentityInvitation: environment.EXISTING_IDENTITY_INVITATION,
    personaPortalSwitch: environment.PERSONA_PORTAL_SWITCH,
    personaPrivacyV2: environment.PERSONA_PRIVACY_V2,
    personaLegacyContract: environment.PERSONA_LEGACY_CONTRACT,
    breakGlassEnabled: environment.BREAK_GLASS_ENABLED,
    notificationOutboxProducersEnabled:
      environment.NOTIFICATION_OUTBOX_PRODUCERS,
    emailProviderMode: environment.EMAIL_PROVIDER_MODE,
    notificationDispatch: environment.NOTIFICATION_DISPATCH,
    optionalEmailEnabled: environment.OPTIONAL_EMAIL,
    deliveryReplayEnabled: environment.DELIVERY_REPLAY,
    workerRuntime: environment.WORKER_RUNTIME,
    workerSandboxReplayEnabled: environment.WORKER_SANDBOX_REPLAY,
    paymentProviderMode: environment.PAYMENT_PROVIDER_MODE,
    paymentSandboxCohort: environment.PAYMENT_SANDBOX_COHORT,
    realPaymentIngestionEnabled: environment.REAL_PAYMENT_INGESTION,
    realPaymentProjectionEnabled: environment.REAL_PAYMENT_PROJECTION,
    paidSelfServiceEnabled: environment.PAID_SELF_SERVICE,
    financeRepairActionsEnabled: environment.FINANCE_REPAIR_ACTIONS,
    paidServiceRecoveryEnabled: environment.PAID_SERVICE_RECOVERY,
    documentVaultWrites: environment.DOCUMENT_VAULT_WRITES,
    documentStorageMode: environment.DOCUMENT_STORAGE_MODE,
    documentScannerMode: environment.DOCUMENT_SCANNER_MODE,
    documentCleanReads: environment.DOCUMENT_CLEAN_READS,
    documentReconciliation: environment.DOCUMENT_RECONCILIATION,
    documentBulkAccess: environment.DOCUMENT_BULK_ACCESS,
    documentVaultCohort: environment.DOCUMENT_VAULT_COHORT,
    documentStorageRegion: environment.DOCUMENT_STORAGE_REGION,
    legalPublicationFlags: Object.freeze({
      privacy: environment.LEGAL_PUBLICATION_PRIVACY,
      terms: environment.LEGAL_PUBLICATION_TERMS,
      imprint: environment.LEGAL_PUBLICATION_IMPRINT,
    }),
    privacyExportV2: environment.PRIVACY_EXPORT_V2,
    privacyCorrectionExecution: environment.PRIVACY_CORRECTION_EXECUTION,
    privacyErasureExecution: environment.PRIVACY_ERASURE_EXECUTION,
    privacyProcessingMode: environment.PRIVACY_PROCESSING_MODE,
    privacyProcessingCohort: environment.PRIVACY_PROCESSING_COHORT,
    privacyExportStorageMode: environment.PRIVACY_EXPORT_STORAGE_MODE,
    privacyExportStorageRegion: environment.PRIVACY_EXPORT_STORAGE_REGION,
    optionalAnalyticsNavigation: environment.OPTIONAL_ANALYTICS_NAVIGATION,
    optionalAnalyticsConversion: environment.OPTIONAL_ANALYTICS_CONVERSION,
    searchLearningCollection: environment.SEARCH_LEARNING_COLLECTION,
    abuseReportAdminRecipientCount:
      environment.ABUSE_REPORT_ADMIN_EMAILS?.length ?? 0,
    keyringWriterVersions: Object.fromEntries(
      Object.entries(environment.secrets.keyrings).map(([name, entries]) => [
        name,
        entries[0]?.version,
      ]),
    ),
  });
}

function isPostgresUrl(value: string) {
  return inspectPostgresTarget(value) !== undefined;
}

function isHttpOrigin(value: string) {
  return parseHttpOrigin(value) !== undefined;
}

function parseHttpOrigin(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function validateTestDatabaseIsolation(
  environment: z.output<typeof rawEnvironmentSchema>,
  context: z.RefinementCtx,
  productionLike: boolean,
) {
  const testDatabaseUrl = environment.TEST_DATABASE_URL;

  if (environment.APP_ENV === "ci" && testDatabaseUrl === undefined) {
    context.addIssue({
      code: "custom",
      path: ["TEST_DATABASE_URL"],
      message: "is required in CI",
    });
  }

  if (productionLike && testDatabaseUrl !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["TEST_DATABASE_URL"],
      message: "must remain empty in staging and production",
    });
  }

  if (testDatabaseUrl !== undefined) {
    const testTarget = inspectPostgresTarget(testDatabaseUrl);

    if (testTarget !== undefined && !/test/i.test(testTarget.databaseName)) {
      context.addIssue({
        code: "custom",
        path: ["TEST_DATABASE_URL"],
        message: "must name an explicitly test-labelled database",
      });
    }

    const applicationTarget = inspectPostgresTarget(environment.DATABASE_URL);
    if (
      applicationTarget !== undefined &&
      testTarget !== undefined &&
      applicationTarget.identity === testTarget.identity
    ) {
      context.addIssue({
        code: "custom",
        path: ["TEST_DATABASE_URL"],
        message: "must be different from DATABASE_URL",
      });
    }
  }

  if (environment.APP_ENV === "ci") {
    const applicationTarget = inspectPostgresTarget(environment.DATABASE_URL);
    if (
      applicationTarget !== undefined &&
      !/(ci|test)/i.test(applicationTarget.databaseName)
    ) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "must name an explicitly CI- or test-labelled database in CI",
      });
    }
  }
}

function isAbsolutePathOutsideRepository(value: string) {
  const pathApi = win32.isAbsolute(value)
    ? win32
    : posix.isAbsolute(value)
      ? posix
      : undefined;

  if (pathApi === undefined) {
    return false;
  }

  const repository = process.cwd();
  if (!pathApi.isAbsolute(repository)) {
    return true;
  }

  const relativePath = pathApi.relative(
    pathApi.resolve(repository),
    pathApi.resolve(value),
  );

  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativePath)
  );
}

function validateBase64Secret(
  variable: string,
  value: string,
  context: z.RefinementCtx,
) {
  if (PLACEHOLDER_PATTERN.test(value)) {
    context.addIssue({
      code: "custom",
      path: [variable],
      message: "must not contain a placeholder",
    });
    return;
  }

  if (!isCanonicalBase64WithByteLength(value, 32)) {
    context.addIssue({
      code: "custom",
      path: [variable],
      message: "must be canonical base64 for exactly 32 bytes",
    });
  }
}

function parseKeyring(
  variable: (typeof KEYRING_VARIABLES)[number],
  value: string,
  context: z.RefinementCtx,
) {
  const entries: Array<{ version: string; secret: string }> = [];
  const versions = new Set<string>();

  for (const [index, rawEntry] of value.split(",").entries()) {
    const separatorIndex = rawEntry.indexOf(":");
    if (separatorIndex <= 0) {
      context.addIssue({
        code: "custom",
        path: [variable],
        message: `entry ${index + 1} must use version:base64 format`,
      });
      continue;
    }

    const version = rawEntry.slice(0, separatorIndex).trim();
    const secret = rawEntry.slice(separatorIndex + 1).trim();

    if (!KEY_VERSION_PATTERN.test(version)) {
      context.addIssue({
        code: "custom",
        path: [variable],
        message: `entry ${index + 1} has an invalid version`,
      });
    }

    if (versions.has(version)) {
      context.addIssue({
        code: "custom",
        path: [variable],
        message: `contains duplicate version ${version}`,
      });
    }
    versions.add(version);

    validateBase64Secret(variable, secret, context);
    entries.push({ version, secret });
  }

  if (entries.length === 0) {
    context.addIssue({
      code: "custom",
      path: [variable],
      message: "must contain at least one key",
    });
  }

  return entries;
}

function parseValidatedKeyring<TPurpose extends KeyringVariable>(
  purpose: TPurpose,
  value: string | undefined,
): readonly KeyringEntry<TPurpose>[] {
  if (value === undefined) return Object.freeze([]);
  return Object.freeze(
    value.split(",").map((rawEntry) => {
      const separatorIndex = rawEntry.indexOf(":");
      return Object.freeze({
        version: rawEntry.slice(0, separatorIndex).trim(),
        key: createSecretHandle(
          purpose,
          rawEntry.slice(separatorIndex + 1).trim(),
        ),
      });
    }),
  );
}

function createSecretHandle<TPurpose extends string>(
  purpose: TPurpose,
  value: string,
): SecretHandle<TPurpose> {
  return new InMemorySecretHandle(purpose, value);
}

function registerUniqueKeyMaterial(
  label: string,
  secret: string,
  seen: Map<string, string>,
  context: z.RefinementCtx,
  path = label,
) {
  if (!isCanonicalBase64WithByteLength(secret, 32)) {
    return;
  }

  const normalized = Buffer.from(secret, "base64").toString("base64");
  const previous = seen.get(normalized);
  if (previous !== undefined) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: `must not reuse key material from ${previous}`,
    });
    return;
  }

  seen.set(normalized, label);
}

function isCanonicalBase64WithByteLength(value: string, byteLength: number) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }

  try {
    const decoded = Buffer.from(value, "base64");
    return (
      decoded.length === byteLength && decoded.toString("base64") === value
    );
  } catch {
    return false;
  }
}

function isCanonicalBase64SecretWithMinimumByteLength(
  value: string,
  byteLength: number,
) {
  if (isCanonicalBase64WithMinimumByteLength(value, byteLength)) {
    return true;
  }

  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return false;
  }

  try {
    const decoded = Buffer.from(value, "base64url");
    return (
      decoded.length >= byteLength && decoded.toString("base64url") === value
    );
  } catch {
    return false;
  }
}

function isCanonicalBase64WithMinimumByteLength(
  value: string,
  byteLength: number,
) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }

  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length >= byteLength && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}
