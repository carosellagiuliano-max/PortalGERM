import { describe, expect, it } from "vitest";

import {
  SEED_DATASET_VERSION,
  SEED_GOLDEN_COUNTS,
  SEED_MANIFEST_SCHEMA_VERSION,
  SEED_NAMESPACE,
  type SeedCounts,
} from "@/prisma/seed/contract";
import { createSeedIdentity } from "@/prisma/seed/ids";
import {
  SeedManifestError,
  assertGoldenSeedCounts,
  assertSeedManifestEnvelope,
  buildSeedContractHeader,
  buildSeedManifest,
  createSeedBlockDigest,
  formatSeedManifestLog,
} from "@/prisma/seed/manifest";

const ANCHOR_AT = "2026-01-15T12:00:00.000Z";
const identities = [
  createSeedIdentity("company", "alpenblick-digital-ag"),
  createSeedIdentity("job", "backend-engineer-zuerich"),
];

describe("Phase-05 seed manifest", () => {
  it("publishes the exact closed golden-count contract", () => {
    expect(assertGoldenSeedCounts({ ...SEED_GOLDEN_COUNTS })).toEqual({
      cantons: 26,
      cities: 29,
      categories: 18,
      skills: 72,
      occupationCodes: 40,
      plans: 5,
      planVersions: 8,
      planEntitlements: 64,
      products: 11,
      companies: 25,
      jobs: 115,
      candidates: 30,
      applications: 80,
      savedJobs: 40,
      jobAlerts: 15,
      employerContactRequests: 6,
      identityRevealGrants: 2,
      conversations: 82,
      orders: 12,
      invoices: 7,
      jobBoosts: 10,
      salesLeads: 4,
      auditLogs: 30,
      analyticsEvents: 300,
      contentPages: 7,
    });
  });

  it("rejects changed, missing and unknown count fields", () => {
    expect(() =>
      assertGoldenSeedCounts({
        ...SEED_GOLDEN_COUNTS,
        jobs: 114,
      }),
    ).toThrow("jobs must be exactly 115");

    const { jobs: _jobs, ...missing } = SEED_GOLDEN_COUNTS;
    expect(() => assertGoldenSeedCounts(missing as SeedCounts)).toThrow(
      "missing or unknown fields",
    );

    expect(() =>
      assertGoldenSeedCounts({
        ...SEED_GOLDEN_COUNTS,
        unexpected: 1,
      } as SeedCounts),
    ).toThrow("missing or unknown fields");
  });

  it("builds a pre-write contract header aligned with the persisted schema", () => {
    const header = buildSeedContractHeader({
      anchorAt: ANCHOR_AT,
      identities,
      seedVersion: SEED_DATASET_VERSION,
    });

    expect(header).toMatchObject({
      anchorAt: ANCHOR_AT,
      namespace: SEED_NAMESPACE,
      schemaVersion: SEED_MANIFEST_SCHEMA_VERSION,
      seedVersion: SEED_DATASET_VERSION,
    });
    expect(header.contractHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of identity, block and projection object order", () => {
    const first = buildSeedManifest({
      anchorAt: ANCHOR_AT,
      blocks: [
        createSeedBlockDigest("jobs", 115, {
          jobs: [{ slug: "backend", status: "PUBLISHED" }],
          version: 1,
        }),
        createSeedBlockDigest("companies", 25, {
          z: 2,
          a: 1,
        }),
      ],
      counts: { ...SEED_GOLDEN_COUNTS },
      identities,
      seedVersion: SEED_DATASET_VERSION,
    });
    const second = buildSeedManifest({
      anchorAt: ANCHOR_AT,
      blocks: [
        createSeedBlockDigest("companies", 25, {
          a: 1,
          z: 2,
        }),
        createSeedBlockDigest("jobs", 115, {
          version: 1,
          jobs: [{ status: "PUBLISHED", slug: "backend" }],
        }),
      ],
      counts: { ...SEED_GOLDEN_COUNTS },
      identities: [...identities].reverse(),
      seedVersion: SEED_DATASET_VERSION,
    });

    expect(second).toEqual(first);
  });

  it("changes only the result hash when safe fixture content changes", () => {
    const build = (status: string) =>
      buildSeedManifest({
        anchorAt: ANCHOR_AT,
        blocks: [
          createSeedBlockDigest("jobs", 115, {
            jobs: [{ slug: "backend", status }],
          }),
        ],
        counts: { ...SEED_GOLDEN_COUNTS },
        identities,
        seedVersion: SEED_DATASET_VERSION,
      });

    const published = build("PUBLISHED");
    const draft = build("DRAFT");

    expect(draft.manifest.contractHash).toBe(published.manifest.contractHash);
    expect(draft.manifestSha256).not.toBe(published.manifestSha256);
  });

  it("changes the static contract hash when expected identities change", () => {
    const first = buildSeedContractHeader({
      anchorAt: ANCHOR_AT,
      identities,
      seedVersion: SEED_DATASET_VERSION,
    });
    const second = buildSeedContractHeader({
      anchorAt: ANCHOR_AT,
      identities: [
        ...identities,
        createSeedIdentity("skill", "typescript"),
      ],
      seedVersion: SEED_DATASET_VERSION,
    });

    expect(second.contractHash).not.toBe(first.contractHash);
  });

  it("rejects credential-like projections and keeps log output digest-only", () => {
    expect(() =>
      createSeedBlockDigest("users", 4, {
        passwordHash: "must-never-enter-the-manifest",
      }),
    ).toThrow("not allowed in a manifest projection");

    expect(() =>
      createSeedBlockDigest("users", 4, {
        source: "postgresql://user:password@database.internal/demo",
      }),
    ).toThrow("URL credentials");

    const projectionCanary = "safe-projection-canary";
    const envelope = buildSeedManifest({
      anchorAt: ANCHOR_AT,
      blocks: [
        createSeedBlockDigest("companies", 25, {
          marker: projectionCanary,
        }),
      ],
      counts: { ...SEED_GOLDEN_COUNTS },
      identities,
      seedVersion: SEED_DATASET_VERSION,
    });
    const log = formatSeedManifestLog(envelope);

    expect(log).not.toContain(projectionCanary);
    expect(log).not.toContain("alpenblick-digital-ag");
    expect(log).toContain(envelope.manifestSha256);
  });

  it("detects tampering and duplicate block names", () => {
    const envelope = buildSeedManifest({
      anchorAt: ANCHOR_AT,
      counts: { ...SEED_GOLDEN_COUNTS },
      identities,
      seedVersion: SEED_DATASET_VERSION,
    });

    expect(() =>
      assertSeedManifestEnvelope({
        ...envelope,
        manifestSha256: "0".repeat(64),
      }),
    ).toThrow("hash does not match");

    const block = createSeedBlockDigest("jobs", 115, { version: 1 });
    expect(() =>
      buildSeedManifest({
        anchorAt: ANCHOR_AT,
        blocks: [block, block],
        counts: { ...SEED_GOLDEN_COUNTS },
        identities,
        seedVersion: SEED_DATASET_VERSION,
      }),
    ).toThrow("Duplicate seed block jobs");
  });

  it.each([
    "2026-01-15",
    "2026-01-15T12:00:00Z",
    "not-a-date",
  ])("rejects a non-canonical anchor instant (%s)", (anchorAt) => {
    expect(() =>
      buildSeedContractHeader({
        anchorAt,
        identities,
        seedVersion: SEED_DATASET_VERSION,
      }),
    ).toThrow(SeedManifestError);
  });
});
