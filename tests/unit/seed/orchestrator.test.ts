import { describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "@/lib/db/factory";
import {
  buildBillingOpsSeedBlockDigest,
  buildBillingOpsSeedIdentities,
} from "@/prisma/seed/blocks/billing-ops";
import {
  SEED_DATASET_VERSION,
  SEED_GOLDEN_COUNTS,
  SEED_MANIFEST_SCHEMA_VERSION,
  SEED_NAMESPACE,
} from "@/prisma/seed/contract";
import { buildSeedPlanningGraph } from "@/prisma/seed/contract-identities";
import {
  CANDIDATE_FIXTURES,
  CANDIDATE_WORKFLOW_BLOCK_DIGEST,
  COMPANIES_JOBS_SEED_IDENTITIES,
  DEMO_ACCOUNT_FIXTURES,
} from "@/prisma/seed/fixtures";
import { DemoSeedGuardError } from "@/prisma/seed/guard";
import { stableSeedId } from "@/prisma/seed/ids";
import {
  buildStaticSeedBlockDigests,
  orchestrateDemoSeed,
  runDemoSeed,
  verifyPersistedDemoSeed,
  type SeedOrchestrationPorts,
  type SeedVerificationPorts,
} from "@/prisma/seed/orchestrator";
import {
  buildSeedContractHeader,
  buildSeedManifest,
  createSeedBlockDigest,
} from "@/prisma/seed/manifest";

const ANCHOR = new Date("2026-07-20T10:00:00.000Z");
const LOCAL_DATABASE =
  "postgresql://seed:local-only@127.0.0.1:5434/swisstalenthub?schema=public";

describe("Phase-05 seed orchestrator", () => {
  it("guards production before constructing a client or reaching a write port", async () => {
    const write = vi.fn();
    const factory = vi.fn(() =>
      ({
        demoSeedManifest: { create: write },
        $disconnect: vi.fn(),
      }) as unknown as DatabaseClient,
    );

    await expect(
      runDemoSeed(
        {
          APP_ENV: "production",
          DATABASE_URL: LOCAL_DATABASE,
          ENABLE_DEMO_SEED: "true",
        },
        { clientFactory: factory },
      ),
    ).rejects.toMatchObject({
      code: "PRODUCTION_LIKE_ENVIRONMENT",
    } satisfies Partial<DemoSeedGuardError>);

    expect(factory).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("executes the closed block contract in order and seals observed counts", async () => {
    const fixture = createSuccessfulPorts();

    const result = await orchestrateDemoSeed(
      {} as DatabaseClient,
      fixture.ports,
    );

    expect(fixture.calls).toEqual([
      "planning",
      "begin",
      "reference-catalog",
      "companies-jobs",
      "candidate-workflows",
      "billing-ops",
      "database-verification",
      "complete",
    ]);
    expect(result.previouslyCompleted).toBe(false);
    expect(result.envelope.manifest.counts).toEqual(SEED_GOLDEN_COUNTS);
    expect(result.envelope.manifest.blocks.map(({ name }) => name)).toEqual([
      "billing-ops-content",
      "candidate-workflows",
      "companies-jobs",
      "database-verification",
      "reference-catalog",
    ]);
    expect(result.envelope.manifest.identityCount).toBe(
      fixture.planning.identities.length,
    );

    const verificationExpectations = vi.mocked(
      fixture.ports.verifyDatabase,
    ).mock.calls[0]?.[2];
    expect(verificationExpectations?.expectedIdentityIds).toEqual(
      fixture.planning.identities.map(({ id }) => id),
    );
    expect(fixture.completedEnvelope).toBe(result.envelope);
  });

  it("reruns every block but refuses a changed hash for a completed run", async () => {
    const fixture = createSuccessfulPorts({
      completed: true,
      manifestHash: "0".repeat(64),
    });

    await expect(
      orchestrateDemoSeed({} as DatabaseClient, fixture.ports),
    ).rejects.toThrow("no longer matches its sealed manifest hash");

    expect(fixture.calls).toEqual([
      "planning",
      "begin",
      "reference-catalog",
      "companies-jobs",
      "candidate-workflows",
      "billing-ops",
      "database-verification",
    ]);
    expect(fixture.ports.completeSeedRun).not.toHaveBeenCalled();
  });

  it("reconstructs a sealed manifest read-only without invoking write methods", async () => {
    const planning = buildSeedPlanningGraph();
    const verificationDigest = createSeedBlockDigest(
      "database-verification",
      1,
      { verified: true },
    );
    const verification = {
      blockDigest: verificationDigest,
      counts: SEED_GOLDEN_COUNTS,
      report: {
        anchorAt: ANCHOR.toISOString(),
        checkCount: 1,
        checks: [],
        observedDigestSha256: "1".repeat(64),
      },
    } as const;
    const envelope = buildSeedManifest({
      anchorAt: ANCHOR.toISOString(),
      blocks: [...buildStaticSeedBlockDigests(planning), verificationDigest],
      counts: SEED_GOLDEN_COUNTS,
      identities: planning.identities,
      seedVersion: SEED_DATASET_VERSION,
    });
    const header = buildSeedContractHeader({
      anchorAt: ANCHOR.toISOString(),
      identities: planning.identities,
      seedVersion: SEED_DATASET_VERSION,
    });
    const write = vi.fn();
    const findUnique = vi.fn(async () => ({
      anchorAt: ANCHOR,
      completedAt: new Date("2026-07-20T10:01:00.000Z"),
      contractHash: header.contractHash,
      createdAt: ANCHOR,
      manifestHash: envelope.manifestSha256,
      namespace: SEED_NAMESPACE,
      schemaVersion: SEED_MANIFEST_SCHEMA_VERSION,
      seedVersion: SEED_DATASET_VERSION,
    }));
    const database = {
      demoSeedManifest: {
        create: write,
        delete: write,
        findUnique,
        update: write,
        updateMany: write,
      },
    } as unknown as DatabaseClient;
    const ports = {
      buildPlanningGraph: vi.fn(() => planning),
      verifyDatabase: vi.fn(async () => verification),
    } as unknown as SeedVerificationPorts;

    const result = await verifyPersistedDemoSeed(database, ports);

    expect(result.envelope).toEqual(envelope);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(ports.verifyDatabase).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });
});

function createSuccessfulPorts(
  lifecycle: Readonly<{
    completed: boolean;
    manifestHash: string | null;
  }> = { completed: false, manifestHash: null },
) {
  const calls: string[] = [];
  const planning = buildSeedPlanningGraph();
  const staticDigests = buildStaticSeedBlockDigests(planning);
  const companyDigest = requireDigest(staticDigests, "companies-jobs");
  const billingIdentities = buildBillingOpsSeedIdentities(planning);
  const billingDigest = buildBillingOpsSeedBlockDigest(planning);
  const verificationDigest = createSeedBlockDigest(
    "database-verification",
    1,
    { verified: true },
  );
  let completedEnvelope: unknown;

  const ports = {
    buildPlanningGraph: vi.fn(() => {
      calls.push("planning");
      return planning;
    }),
    beginSeedRun: vi.fn(async () => {
      calls.push("begin");
      return { anchorAt: ANCHOR, ...lifecycle };
    }),
    seedReferenceCatalog: vi.fn(async () => {
      calls.push("reference-catalog");
      return {};
    }),
    seedCompaniesJobs: vi.fn(async () => {
      calls.push("companies-jobs");
      return {
        blockDigest: companyDigest,
        companies: planning.companies,
        demoAccounts: DEMO_ACCOUNT_FIXTURES,
        identities: COMPANIES_JOBS_SEED_IDENTITIES,
        jobs: planning.jobs,
      };
    }),
    seedCandidateWorkflows: vi.fn(async () => {
      calls.push("candidate-workflows");
      return {
        applications: [],
        blockDigest: CANDIDATE_WORKFLOW_BLOCK_DIGEST,
        candidates: CANDIDATE_FIXTURES.map((candidate, index) => ({
          id: stableSeedId("candidate-profile", candidate.email),
          key: `candidate-${String(index + 1).padStart(2, "0")}`,
          userId: stableSeedId("user", candidate.email),
        })),
        contactRequests: [],
        conversations: [],
      };
    }),
    seedBillingOpsContent: vi.fn(async () => {
      calls.push("billing-ops");
      return {
        analyticsEventIds: [],
        auditLogIds: [],
        blockDigest: billingDigest,
        contentPageIds: [],
        creditAccountIds: [],
        identities: billingIdentities,
        invoiceIds: [],
        jobBoostIds: [],
        orderIds: [],
        salesLeadIds: [],
        subscriptionIds: [],
        taxRateVersionId: stableSeedId("tax-rate-version", "CH:VAT:810:phase-05"),
      };
    }),
    verifyDatabase: vi.fn(async () => {
      calls.push("database-verification");
      return {
        blockDigest: verificationDigest,
        counts: SEED_GOLDEN_COUNTS,
        report: {
          anchorAt: ANCHOR.toISOString(),
          checkCount: 1,
          checks: [],
          observedDigestSha256: "1".repeat(64),
        },
      };
    }),
    completeSeedRun: vi.fn(async (_database, envelope) => {
      calls.push("complete");
      completedEnvelope = envelope;
    }),
  } as unknown as SeedOrchestrationPorts;

  return {
    calls,
    get completedEnvelope() {
      return completedEnvelope;
    },
    planning,
    ports,
  };
}

function requireDigest(
  digests: readonly Readonly<{ name: string }>[],
  name: string,
) {
  const digest = digests.find((candidate) => candidate.name === name);
  if (digest === undefined) {
    throw new Error(`Missing test digest ${name}.`);
  }
  return digest;
}
