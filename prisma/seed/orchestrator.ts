import type { DatabaseClient } from "@/lib/db/factory";
import { createDatabaseClient } from "@/lib/db/factory";
import {
  buildBillingOpsSeedBlockDigest,
  seedBillingOpsContent,
} from "@/prisma/seed/blocks/billing-ops";
import {
  buildAuthRbacSeedBlockDigest,
  seedAuthRbacFixtures,
} from "@/prisma/seed/blocks/auth-rbac";
import {
  buildEmployerCoreSeedBlockDigest,
  seedEmployerCoreFixtures,
} from "@/prisma/seed/blocks/employer-core";
import {
  DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
  seedCandidateWorkflows,
  type CandidateWorkflowSeedCryptoConfig,
} from "@/prisma/seed/blocks/candidate-workflows";
import { seedDemoAccountsCompaniesAndJobs } from "@/prisma/seed/blocks/companies-jobs";
import {
  REFERENCE_CATALOG_SEED_IDENTITIES,
  seedReferenceCatalog,
} from "@/prisma/seed/blocks/reference-catalog";
import {
  canonicalJson,
  type CanonicalJsonValue,
} from "@/prisma/seed/canonical-json";
import {
  SEED_DATASET_VERSION,
  SEED_MANIFEST_SCHEMA_VERSION,
  SEED_NAMESPACE,
  type SeedBlockDigest,
  type SeedIdentityRecord,
  type SeedManifestEnvelope,
} from "@/prisma/seed/contract";
import {
  buildSeedPlanningGraph,
  type SeedPlanningGraph,
} from "@/prisma/seed/contract-identities";
import {
  CANDIDATE_FIXTURES,
  CANDIDATE_WORKFLOW_BLOCK_DIGEST,
  CANDIDATE_WORKFLOW_SEED_IDENTITIES,
  DEMO_ACCOUNT_FIXTURES,
  DEMO_GUIDE_FIXTURES,
} from "@/prisma/seed/fixtures";
import {
  createGuardedSeedClient,
  type DemoSeedEnvironment,
  type DemoSeedGuardDecision,
} from "@/prisma/seed/guard";
import { mergeSeedIdentitySets } from "@/prisma/seed/identity-catalog";
import { stableSeedId } from "@/prisma/seed/ids";
import {
  beginSeedRun,
  completeSeedRun,
  SeedLifecycleError,
} from "@/prisma/seed/lifecycle";
import {
  buildSeedContractHeader,
  buildSeedManifest,
  createSeedBlockDigest,
} from "@/prisma/seed/manifest";
import {
  verifyDemoSeedDatabase,
  type DemoSeedVerificationResult,
} from "@/prisma/seed/verifier";

export class SeedOrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedOrchestrationError";
  }
}

export type SeedOrchestrationPorts = Readonly<{
  beginSeedRun: typeof beginSeedRun;
  buildPlanningGraph: typeof buildSeedPlanningGraph;
  completeSeedRun: typeof completeSeedRun;
  seedBillingOpsContent: typeof seedBillingOpsContent;
  seedAuthRbac: typeof seedAuthRbacFixtures;
  seedCandidateWorkflows: typeof seedCandidateWorkflows;
  seedCompaniesJobs: typeof seedDemoAccountsCompaniesAndJobs;
  seedEmployerCore: typeof seedEmployerCoreFixtures;
  seedReferenceCatalog: typeof seedReferenceCatalog;
  verifyDatabase: typeof verifyDemoSeedDatabase;
}>;

export type SeedVerificationPorts = Readonly<{
  buildPlanningGraph: typeof buildSeedPlanningGraph;
  verifyDatabase: typeof verifyDemoSeedDatabase;
}>;

export type SeedOrchestrationResult = Readonly<{
  envelope: SeedManifestEnvelope;
  previouslyCompleted: boolean;
  verificationCheckCount: number;
}>;

export type GuardedSeedResult = SeedOrchestrationResult &
  Readonly<{ guard: DemoSeedGuardDecision }>;

export type SeedVerificationResult = Readonly<{
  envelope: SeedManifestEnvelope;
  verificationCheckCount: number;
}>;

export type GuardedSeedVerificationResult = SeedVerificationResult &
  Readonly<{ guard: DemoSeedGuardDecision }>;

export type SeedRuntimeOptions = Readonly<{
  candidateWorkflowCrypto?: CandidateWorkflowSeedCryptoConfig;
  clientFactory?: (databaseUrl: string) => DatabaseClient;
  ports?: SeedOrchestrationPorts;
}>;

export type SeedVerificationRuntimeOptions = Readonly<{
  clientFactory?: (databaseUrl: string) => DatabaseClient;
  ports?: SeedVerificationPorts;
}>;

const DEFAULT_ORCHESTRATION_PORTS: SeedOrchestrationPorts = Object.freeze({
  beginSeedRun,
  buildPlanningGraph: buildSeedPlanningGraph,
  completeSeedRun,
  seedBillingOpsContent,
  seedAuthRbac: seedAuthRbacFixtures,
  seedCandidateWorkflows,
  seedCompaniesJobs: seedDemoAccountsCompaniesAndJobs,
  seedEmployerCore: seedEmployerCoreFixtures,
  seedReferenceCatalog,
  verifyDatabase: verifyDemoSeedDatabase,
});

const DEFAULT_VERIFICATION_PORTS: SeedVerificationPorts = Object.freeze({
  buildPlanningGraph: buildSeedPlanningGraph,
  verifyDatabase: verifyDemoSeedDatabase,
});

const SEED_RUN_LOCK_KEY = `${SEED_NAMESPACE}:${SEED_DATASET_VERSION}`;
const SEED_RUN_LOCK_WAIT_MS = 600_000;
const SEED_RUN_LOCK_RETRY_BASE_MS = 50;
const SEED_RUN_LOCK_RETRY_MAX_MS = 500;
const SEED_RUN_TRANSACTION_TIMEOUT_MS = 600_000;

type SeedRunLockAttempt<T> =
  | Readonly<{ acquired: false }>
  | Readonly<{ acquired: true; value: T }>;

/**
 * Runs the environment guard before the client factory can observe a database
 * URL. This is the only runtime entry point used by the write-capable CLI.
 */
export async function runDemoSeed(
  environment: DemoSeedEnvironment,
  options: SeedRuntimeOptions = {},
): Promise<GuardedSeedResult> {
  const guarded = createGuardedSeedClient(
    environment,
    options.clientFactory ?? createDatabaseClient,
  );

  try {
    const result = await orchestrateDemoSeed(
      guarded.client,
      options.ports ?? DEFAULT_ORCHESTRATION_PORTS,
      options.candidateWorkflowCrypto ?? DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
    );
    return Object.freeze({ ...result, guard: guarded.guard });
  } finally {
    await guarded.client.$disconnect();
  }
}

/**
 * Executes every create-or-verify block on every invocation. A completed run
 * is not short-circuited: its freshly observed manifest must still match the
 * immutable persisted hash before completion is acknowledged.
 */
export async function orchestrateDemoSeed(
  database: DatabaseClient,
  ports: SeedOrchestrationPorts = DEFAULT_ORCHESTRATION_PORTS,
  candidateWorkflowCrypto: CandidateWorkflowSeedCryptoConfig = DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
): Promise<SeedOrchestrationResult> {
  const planning = ports.buildPlanningGraph();

  // Persist the first run's anchor outside the serialized write transaction so
  // a failed attempt can resume against the same deterministic clock.
  await ports.beginSeedRun(database, planning.identities);

  return withSerializedSeedRun(database, async (serializedDatabase) => {
    // Re-read after acquiring the lock: another runner may have completed while
    // this runner was waiting, and that state controls hash verification and the
    // previouslyCompleted result.
    const lifecycle = await ports.beginSeedRun(
      serializedDatabase,
      planning.identities,
    );
    return executeSeedRun(
      serializedDatabase,
      planning,
      lifecycle,
      ports,
      candidateWorkflowCrypto,
    );
  });
}

async function executeSeedRun(
  database: DatabaseClient,
  planning: SeedPlanningGraph,
  lifecycle: Awaited<ReturnType<typeof beginSeedRun>>,
  ports: SeedOrchestrationPorts,
  candidateWorkflowCrypto: CandidateWorkflowSeedCryptoConfig,
): Promise<SeedOrchestrationResult> {
  const anchorAt = lifecycle.anchorAt;

  const referenceCatalog = await ports.seedReferenceCatalog(database);
  const companiesJobs = await ports.seedCompaniesJobs(database, anchorAt);
  const authRbac = await ports.seedAuthRbac(database, anchorAt);
  const employerCore = await ports.seedEmployerCore(database, anchorAt);
  const candidateWorkflows = await ports.seedCandidateWorkflows(
    database,
    anchorAt,
    {
      companies: companiesJobs.companies,
      jobs: companiesJobs.jobs,
    },
    candidateWorkflowCrypto,
  );
  const billingOps = await ports.seedBillingOpsContent({
    adminUserId: planning.adminUserId,
    anchorAt,
    companies: companiesJobs.companies,
    db: database,
    jobs: companiesJobs.jobs,
    referenceCatalog,
  });

  assertCompleteIdentityContract(planning.identities, [
    REFERENCE_CATALOG_SEED_IDENTITIES,
    companiesJobs.identities,
    authRbac.identities,
    employerCore.identities,
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    billingOps.identities,
  ]);

  const expectedStaticDigests = buildStaticSeedBlockDigests(planning);
  assertBlockDigest(
    authRbac.blockDigest,
    requireBlockDigest(expectedStaticDigests, "auth-rbac"),
  );
  assertBlockDigest(
    companiesJobs.blockDigest,
    requireBlockDigest(expectedStaticDigests, "companies-jobs"),
  );
  assertBlockDigest(
    employerCore.blockDigest,
    requireBlockDigest(expectedStaticDigests, "employer-core"),
  );
  assertBlockDigest(
    candidateWorkflows.blockDigest,
    requireBlockDigest(expectedStaticDigests, "candidate-workflows"),
  );
  assertBlockDigest(
    billingOps.blockDigest,
    requireBlockDigest(expectedStaticDigests, "billing-ops-content"),
  );

  const verification = await ports.verifyDatabase(
    database,
    anchorAt,
    buildVerificationExpectations(
      planning,
      companiesJobs.companies,
      companiesJobs.jobs,
    ),
  );
  const envelope = buildVerifiedEnvelope(planning, anchorAt, verification);

  if (
    lifecycle.completed &&
    lifecycle.manifestHash !== envelope.manifestSha256
  ) {
    throw new SeedLifecycleError(
      "The completed demo seed no longer matches its sealed manifest hash.",
    );
  }

  await ports.completeSeedRun(database, envelope);

  return Object.freeze({
    envelope,
    previouslyCompleted: lifecycle.completed,
    verificationCheckCount: verification.report.checkCount,
  });
}

/**
 * Serializes the complete versioned seed run with a PostgreSQL transaction
 * advisory lock. `pg_try_advisory_xact_lock` avoids exceeding the database
 * client's short statement timeout while another (potentially long) seed run
 * owns the lock; each miss closes its transaction before a bounded retry.
 */
async function withSerializedSeedRun<T>(
  database: DatabaseClient,
  operation: (serializedDatabase: DatabaseClient) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + SEED_RUN_LOCK_WAIT_MS;
  let retry = 0;

  while (true) {
    const attempt = await database.$transaction(
      async (transaction): Promise<SeedRunLockAttempt<T>> => {
        // The regular client is configured with a short idle-in-transaction
        // timeout. This dedicated lock transaction intentionally remains open
        // while seed blocks use their existing transaction boundaries.
        await transaction.$executeRaw`
          SET LOCAL idle_in_transaction_session_timeout = 0
        `;
        const rows = await transaction.$queryRaw<
          Array<Readonly<{ acquired: boolean }>>
        >`
          SELECT pg_try_advisory_xact_lock(
            hashtextextended(${SEED_RUN_LOCK_KEY}, 0)
          ) AS acquired
        `;
        if (rows[0]?.acquired !== true) {
          return Object.freeze({ acquired: false });
        }

        return Object.freeze({
          acquired: true,
          value: await operation(database),
        });
      },
      {
        isolationLevel: "ReadCommitted",
        maxWait: 5_000,
        timeout: SEED_RUN_TRANSACTION_TIMEOUT_MS,
      },
    );

    if (attempt.acquired) {
      return attempt.value;
    }
    if (Date.now() >= deadline) {
      throw new SeedOrchestrationError(
        `Timed out waiting for the versioned demo seed run lock after ${SEED_RUN_LOCK_WAIT_MS}ms.`,
      );
    }

    const retryDelay = Math.min(
      SEED_RUN_LOCK_RETRY_BASE_MS * 2 ** Math.min(retry, 4),
      SEED_RUN_LOCK_RETRY_MAX_MS,
    );
    retry += 1;
    await wait(retryDelay);
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Guarded read-only entry point. It never calls beginSeedRun or any block
 * writer; it only reconstructs and compares the already sealed manifest.
 */
export async function runDemoSeedVerification(
  environment: DemoSeedEnvironment,
  options: SeedVerificationRuntimeOptions = {},
): Promise<GuardedSeedVerificationResult> {
  const guarded = createGuardedSeedClient(
    environment,
    options.clientFactory ?? createDatabaseClient,
  );

  try {
    const result = await verifyPersistedDemoSeed(
      guarded.client,
      options.ports ?? DEFAULT_VERIFICATION_PORTS,
    );
    return Object.freeze({ ...result, guard: guarded.guard });
  } finally {
    await guarded.client.$disconnect();
  }
}

export async function verifyPersistedDemoSeed(
  database: DatabaseClient,
  ports: SeedVerificationPorts = DEFAULT_VERIFICATION_PORTS,
): Promise<SeedVerificationResult> {
  const planning = ports.buildPlanningGraph();
  const persisted = await database.demoSeedManifest.findUnique({
    where: {
      namespace_seedVersion: {
        namespace: SEED_NAMESPACE,
        seedVersion: SEED_DATASET_VERSION,
      },
    },
  });

  if (persisted === null) {
    throw new SeedLifecycleError(
      "No Phase-06 demo seed manifest exists for read-only verification.",
    );
  }
  if (persisted.completedAt === null || persisted.manifestHash === null) {
    throw new SeedLifecycleError(
      "The Phase-06 demo seed manifest is not sealed.",
    );
  }

  const header = buildSeedContractHeader({
    anchorAt: persisted.anchorAt.toISOString(),
    identities: planning.identities,
    seedVersion: SEED_DATASET_VERSION,
  });
  if (
    persisted.namespace !== header.namespace ||
    persisted.seedVersion !== header.seedVersion ||
    persisted.schemaVersion !== SEED_MANIFEST_SCHEMA_VERSION ||
    persisted.contractHash !== header.contractHash
  ) {
    throw new SeedLifecycleError(
      "The sealed demo seed header does not match the active fixture contract.",
    );
  }

  const verification = await ports.verifyDatabase(
    database,
    persisted.anchorAt,
    buildVerificationExpectations(planning),
  );
  const envelope = buildVerifiedEnvelope(
    planning,
    persisted.anchorAt,
    verification,
  );
  if (envelope.manifestSha256 !== persisted.manifestHash) {
    throw new SeedLifecycleError(
      "The observed demo seed database does not match its sealed manifest hash.",
    );
  }

  return Object.freeze({
    envelope,
    verificationCheckCount: verification.report.checkCount,
  });
}

export function buildStaticSeedBlockDigests(
  planning: SeedPlanningGraph,
): readonly SeedBlockDigest[] {
  const referenceCatalog = createSeedBlockDigest(
    "reference-catalog",
    REFERENCE_CATALOG_SEED_IDENTITIES.length,
    {
      identities: projectIdentities(REFERENCE_CATALOG_SEED_IDENTITIES),
    },
  );
  const companiesJobs = createSeedBlockDigest(
    "companies-jobs",
    DEMO_ACCOUNT_FIXTURES.length +
      planning.companies.length +
      planning.jobs.length,
    {
      accounts: DEMO_ACCOUNT_FIXTURES.map(({ id, email, role }) => ({
        id,
        email,
        role,
      })),
      companies: planning.companies.map(({ id, slug, planCode }) => ({
        id,
        slug,
        planCode,
      })),
      jobs: planning.jobs.map(({ id, slug, status, companyId }) => ({
        id,
        slug,
        status,
        companyId,
      })),
    },
  );

  return Object.freeze([
    referenceCatalog,
    buildAuthRbacSeedBlockDigest(),
    companiesJobs,
    buildEmployerCoreSeedBlockDigest(),
    CANDIDATE_WORKFLOW_BLOCK_DIGEST,
    buildBillingOpsSeedBlockDigest({
      companies: planning.companies,
      jobs: planning.jobs,
    }),
  ]);
}

function buildVerifiedEnvelope(
  planning: SeedPlanningGraph,
  anchorAt: Date,
  verification: DemoSeedVerificationResult,
): SeedManifestEnvelope {
  return buildSeedManifest({
    anchorAt: anchorAt.toISOString(),
    blocks: [
      ...buildStaticSeedBlockDigests(planning),
      verification.blockDigest,
    ],
    counts: verification.counts,
    identities: planning.identities,
    seedVersion: SEED_DATASET_VERSION,
  });
}

function buildVerificationExpectations(
  planning: SeedPlanningGraph,
  companies: readonly Readonly<{
    id: string;
    slug: string;
  }>[] = planning.companies,
  jobs: readonly Readonly<{ id: string; slug: string }>[] = planning.jobs,
  candidates: readonly Readonly<{
    id: string;
    key: string;
  }>[] = CANDIDATE_FIXTURES.map((fixture) => ({
    id: stableSeedId("candidate-profile", fixture.email),
    key: fixture.email,
  })),
) {
  return Object.freeze({
    candidateHandles: candidates.map(({ id, key }) => ({ id, key })),
    companyHandles: companies.map(({ id, slug }) => ({ id, key: slug })),
    contentPageHandles: DEMO_GUIDE_FIXTURES.map(({ slug }) => ({
      id: stableSeedId("content-page", slug),
      key: slug,
    })),
    expectedIdentityIds: planning.identities.map(({ id }) => id),
    jobHandles: jobs.map(({ id, slug }) => ({ id, key: slug })),
  });
}

function assertCompleteIdentityContract(
  expected: readonly SeedIdentityRecord[],
  blockSets: readonly (readonly SeedIdentityRecord[])[],
): void {
  const observed = mergeSeedIdentitySets(...blockSets);
  if (
    canonicalJson(observed as unknown as CanonicalJsonValue) !==
    canonicalJson(expected as unknown as CanonicalJsonValue)
  ) {
    throw new SeedOrchestrationError(
      "Seed block identities do not match the complete planning graph.",
    );
  }
}

function projectIdentities(identities: readonly SeedIdentityRecord[]) {
  return identities.map(({ entity, id, naturalKey }) => ({
    entity,
    id,
    naturalKey,
  }));
}

function requireBlockDigest(
  blocks: readonly SeedBlockDigest[],
  name: string,
): SeedBlockDigest {
  const block = blocks.find((candidate) => candidate.name === name);
  if (block === undefined) {
    throw new SeedOrchestrationError(`Missing static seed block ${name}.`);
  }
  return block;
}

function assertBlockDigest(
  actual: SeedBlockDigest,
  expected: SeedBlockDigest,
): void {
  if (
    actual.name !== expected.name ||
    actual.recordCount !== expected.recordCount ||
    actual.digestSha256 !== expected.digestSha256
  ) {
    throw new SeedOrchestrationError(
      `Seed block ${expected.name} does not match its static fixture digest.`,
    );
  }
}
