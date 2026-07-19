import { Buffer } from "node:buffer";
import { posix, win32 } from "node:path";

import { z } from "zod";

import { inspectPostgresTarget } from "@/lib/db/database-target";

const KEYRING_VARIABLES = [
  "AUDIT_IP_HASH_KEYS",
  "RADAR_OPAQUE_LOOKUP_KEYS",
  "RADAR_OPAQUE_ENCRYPTION_KEYS",
  "REVEAL_CONFIRMATION_KEYS",
  "PII_REVEAL_KEYS",
] as const;

const FUTURE_PROVIDER_VARIABLES = [
  "STRIPE_SECRET_KEY",
  "EMAIL_PROVIDER_API_KEY",
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
] as const;

const PLACEHOLDER_PATTERN =
  /(replace|change[-_ ]?me|placeholder|example|your[-_]|<[^>]+>)/i;
const KEY_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;
const secretPurpose: unique symbol = Symbol("secret-purpose");

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const rawEnvironmentSchema = z
  .object({
    APP_ENV: z.enum(
      ["local", "ci", "preview", "staging", "production"],
      { error: "is required" },
    ),
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
      .refine(isHttpOrigin, "must be an absolute credential-free http(s) origin"),
    NEXT_PUBLIC_APP_NAME: z
      .string({ error: "is required" })
      .trim()
      .min(2, "must contain at least 2 characters")
      .max(80, "must contain at most 80 characters"),
    SESSION_SECRET: z.string({ error: "is required" }),
    AUDIT_IP_HASH_KEYS: z.string({ error: "is required" }),
    RADAR_OPAQUE_LOOKUP_KEYS: z.string({ error: "is required" }),
    RADAR_OPAQUE_ENCRYPTION_KEYS: z.string({ error: "is required" }),
    REVEAL_CONFIRMATION_KEYS: z.string({ error: "is required" }),
    PII_REVEAL_KEYS: z.string({ error: "is required" }),
    RATE_LIMIT_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
    ENABLE_LOCAL_MOCK_MAILBOX: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DEV_MAILBOX_SECRET: optionalString,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    BACKUP_AGE_RECIPIENT: optionalString,
    BACKUP_AGE_IDENTITY_FILE: optionalString,
    STRIPE_SECRET_KEY: optionalString,
    EMAIL_PROVIDER_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    STORAGE_ENDPOINT: optionalString,
    JOBROOM_API_URL: optionalString,
    MAPS_API_KEY: optionalString,
  })
  .superRefine((environment, context) => {
    validateBase64Secret(
      "SESSION_SECRET",
      environment.SESSION_SECRET,
      context,
    );

    const seenKeyMaterial = new Map<string, string>();
    registerUniqueKeyMaterial(
      "SESSION_SECRET",
      environment.SESSION_SECRET,
      seenKeyMaterial,
      context,
    );

    for (const variable of KEYRING_VARIABLES) {
      const entries = parseKeyring(variable, environment[variable], context);
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
      environment.APP_ENV === "production" ||
      environment.APP_ENV === "staging";
    const productionRuntime =
      productionLike || environment.NODE_ENV === "production";

    validateTestDatabaseIsolation(environment, context, productionLike);

    if (productionLike && environment.RATE_LIMIT_BACKEND !== "postgres") {
      context.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_BACKEND"],
        message: "must be postgres in staging and production",
      });
    }

    if (productionRuntime && environment.ENABLE_LOCAL_MOCK_MAILBOX) {
      context.addIssue({
        code: "custom",
        path: ["ENABLE_LOCAL_MOCK_MAILBOX"],
        message: "must be false in a production runtime",
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

class InMemorySecretHandle<TPurpose extends string>
  implements SecretHandle<TPurpose>
{
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

export type KeyringEntry<TPurpose extends KeyringVariable = KeyringVariable> = Readonly<{
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

  const keyrings = Object.freeze(Object.fromEntries(
    KEYRING_VARIABLES.map((variable) => [
      variable,
      parseValidatedKeyring(variable, result.data[variable]),
    ]),
  )) as ServerEnvironment["secrets"]["keyrings"];

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
    logLevel: environment.LOG_LEVEL,
    rateLimitBackend: environment.RATE_LIMIT_BACKEND,
    mailboxEnabled: environment.ENABLE_LOCAL_MOCK_MAILBOX,
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
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    )
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
  value: string,
): readonly KeyringEntry<TPurpose>[] {
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
    return (
      decoded.length >= byteLength && decoded.toString("base64") === value
    );
  } catch {
    return false;
  }
}
