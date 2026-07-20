import { inspectPostgresTarget } from "@/lib/db/database-target";

export const DEMO_SEED_ENABLE_VARIABLE = "ENABLE_DEMO_SEED" as const;

export type DemoSeedEnvironment = Readonly<{
  APP_ENV?: string;
  DATABASE_URL?: string;
  ENABLE_DEMO_SEED?: string;
}>;

export type DemoSeedGuardMode = "CI_TEST" | "EXPLICIT_PREVIEW" | "LOCAL_LOOPBACK";

export type DemoSeedGuardDecision = Readonly<{
  appEnvironment: "ci" | "local" | "preview";
  mode: DemoSeedGuardMode;
}>;

export type DemoSeedGuardErrorCode =
  | "CI_DATABASE_NOT_ISOLATED"
  | "DATABASE_TARGET_INVALID"
  | "LOCAL_DATABASE_NOT_LOOPBACK"
  | "PREVIEW_NOT_ENABLED"
  | "PRODUCTION_LABELLED_DATABASE"
  | "PRODUCTION_LIKE_ENVIRONMENT"
  | "UNSUPPORTED_ENVIRONMENT";

export class DemoSeedGuardError extends Error {
  readonly code: DemoSeedGuardErrorCode;

  constructor(code: DemoSeedGuardErrorCode, message: string) {
    super(message);
    this.name = "DemoSeedGuardError";
    this.code = code;
  }
}

/**
 * This check deliberately accepts only the three variables it needs and never
 * returns or logs the connection string. It must run before a Prisma client is
 * constructed.
 */
export function guardDemoSeedEnvironment(
  environment: DemoSeedEnvironment,
): DemoSeedGuardDecision {
  const appEnvironment = environment.APP_ENV;

  if (appEnvironment === "production" || appEnvironment === "staging") {
    throw new DemoSeedGuardError(
      "PRODUCTION_LIKE_ENVIRONMENT",
      "Demo seed is disabled in staging and production.",
    );
  }

  if (
    appEnvironment !== "local" &&
    appEnvironment !== "ci" &&
    appEnvironment !== "preview"
  ) {
    throw new DemoSeedGuardError(
      "UNSUPPORTED_ENVIRONMENT",
      "Demo seed requires APP_ENV=local, ci or explicitly enabled preview.",
    );
  }

  const databaseUrl = environment.DATABASE_URL;
  const target =
    typeof databaseUrl === "string"
      ? inspectPostgresTarget(databaseUrl)
      : undefined;
  if (target === undefined) {
    throw new DemoSeedGuardError(
      "DATABASE_TARGET_INVALID",
      "Demo seed requires an explicit PostgreSQL database target.",
    );
  }

  if (/(prod|production|staging)/i.test(target.databaseName)) {
    throw new DemoSeedGuardError(
      "PRODUCTION_LABELLED_DATABASE",
      "Demo seed refuses a production-labelled database target.",
    );
  }

  if (appEnvironment === "local") {
    if (target.hostname !== "loopback") {
      throw new DemoSeedGuardError(
        "LOCAL_DATABASE_NOT_LOOPBACK",
        "Local demo seed requires a loopback database target.",
      );
    }

    return Object.freeze({
      appEnvironment,
      mode: "LOCAL_LOOPBACK",
    });
  }

  if (appEnvironment === "ci") {
    if (!/(ci|test)/i.test(target.databaseName)) {
      throw new DemoSeedGuardError(
        "CI_DATABASE_NOT_ISOLATED",
        "CI demo seed requires an explicitly CI- or test-labelled database.",
      );
    }

    return Object.freeze({ appEnvironment, mode: "CI_TEST" });
  }

  if (environment.ENABLE_DEMO_SEED !== "true") {
    throw new DemoSeedGuardError(
      "PREVIEW_NOT_ENABLED",
      `Preview demo seed requires ${DEMO_SEED_ENABLE_VARIABLE}=true.`,
    );
  }

  return Object.freeze({
    appEnvironment,
    mode: "EXPLICIT_PREVIEW",
  });
}

/**
 * The only convenience path for constructing a seed client. The guard runs to
 * completion before the factory can observe the connection string.
 */
export function createGuardedSeedClient<TClient>(
  environment: DemoSeedEnvironment,
  factory: (databaseUrl: string) => TClient,
): Readonly<{ client: TClient; guard: DemoSeedGuardDecision }> {
  const guard = guardDemoSeedEnvironment(environment);
  const databaseUrl = environment.DATABASE_URL;

  // guardDemoSeedEnvironment already established this invariant.
  if (databaseUrl === undefined) {
    throw new DemoSeedGuardError(
      "DATABASE_TARGET_INVALID",
      "Demo seed requires an explicit PostgreSQL database target.",
    );
  }

  return Object.freeze({ client: factory(databaseUrl), guard });
}
