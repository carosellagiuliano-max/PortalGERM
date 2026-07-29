import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  SEARCH_CONCEPTS_DE_CH_V1,
  SEARCH_CONCEPT_CORPUS_DIGEST_V1,
  SEARCH_POLICY_RELEASE_V2,
  normalizeSearchValue,
} from "@/lib/search/concepts-v2";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-29T12:00:00.000Z");
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let releaseId = "";

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase30_search_dimensions");
  database = createDatabaseClient(migrated.connectionString);
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase 30 versioned search dimensions", () => {
  it("persists all six dimensions under one immutable release identity", async () => {
    const client = db();
    const release = await client.searchPolicyRelease.create({
      data: {
        id: randomUUID(),
        code: "de-ch-phase30-technical-draft",
        status: "DRAFT",
        ...releaseVersions(),
        corpusDigest: SEARCH_CONCEPT_CORPUS_DIGEST_V1,
        createdAt: NOW,
      },
    });
    releaseId = release.id;
    for (const entry of SEARCH_CONCEPTS_DE_CH_V1) {
      const concept = await client.searchConcept.create({
        data: {
          id: randomUUID(),
          stableKey: entry.key,
          releaseId,
          type: entry.type,
          locale: SEARCH_POLICY_RELEASE_V2.locale,
          canonicalLabel: entry.canonicalLabel,
          normalizedLabel: normalizeSearchValue(entry.canonicalLabel),
          createdAt: NOW,
        },
      });
      for (const alias of entry.aliases) {
        await client.searchAlias.create({
          data: {
            id: randomUUID(),
            releaseId,
            conceptId: concept.id,
            kind: alias.length <= 5 ? "ABBREVIATION" : "VARIANT",
            locale: SEARCH_POLICY_RELEASE_V2.locale,
            label: alias,
            normalizedLabel: normalizeSearchValue(alias),
            sourceCode: "PHASE30_TECHNICAL_DRAFT",
            createdAt: NOW,
          },
        });
      }
    }

    const grouped = await client.searchConcept.groupBy({
      by: ["type"],
      where: { releaseId },
      _count: { _all: true },
    });
    expect(new Set(grouped.map(({ type }) => type))).toEqual(
      new Set([
        "OCCUPATION",
        "LOCATION",
        "QUALIFICATION",
        "CERTIFICATE",
        "SKILL",
        "INDUSTRY",
      ]),
    );
    await expect(
      client.searchPolicyRelease.update({
        where: { id: releaseId },
        data: { corpusDigest: "f".repeat(64) },
      }),
    ).rejects.toThrow("Search release identity is immutable");
    const concept = await client.searchConcept.findFirstOrThrow({
      where: { releaseId },
    });
    await expect(
      client.searchConcept.update({
        where: { id: concept.id },
        data: { canonicalLabel: "Mutated" },
      }),
    ).rejects.toThrow("Phase 30 evidence is append-only");
  });

  it("rejects ambiguous aliases and self-relations at the database boundary", async () => {
    const client = db();
    const concepts = await client.searchConcept.findMany({
      where: { releaseId },
      orderBy: { stableKey: "asc" },
      take: 2,
    });
    expect(concepts).toHaveLength(2);
    const existingAlias = await client.searchAlias.findFirstOrThrow({
      where: { releaseId },
    });
    await expect(
      client.searchAlias.create({
        data: {
          id: randomUUID(),
          releaseId,
          conceptId: concepts[1]!.id,
          kind: "VARIANT",
          locale: "de-CH",
          label: existingAlias.label,
          normalizedLabel: existingAlias.normalizedLabel,
          sourceCode: "AMBIGUITY_CANARY",
        },
      }),
    ).rejects.toThrow();
    await expect(
      client.searchConceptRelation.create({
        data: {
          id: randomUUID(),
          releaseId,
          fromConceptId: concepts[0]!.id,
          toConceptId: concepts[0]!.id,
          relationCode: "RELATED",
        },
      }),
    ).rejects.toThrow();
  });

  it("allows only DRAFT to REVIEWED to ACTIVE to REVOKED", async () => {
    const client = db();
    await expect(
      client.searchPolicyRelease.update({
        where: { id: releaseId },
        data: {
          status: "ACTIVE",
          reviewedAt: NOW,
          activatedAt: NOW,
        },
      }),
    ).rejects.toThrow("Search release lifecycle transition is invalid");
    await client.searchPolicyRelease.update({
      where: { id: releaseId },
      data: { status: "REVIEWED", reviewedAt: NOW },
    });
    await client.searchPolicyRelease.update({
      where: { id: releaseId },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(NOW.getTime() + 1_000),
      },
    });
    await client.searchPolicyRelease.update({
      where: { id: releaseId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(NOW.getTime() + 2_000),
      },
    });
    await expect(
      client.searchPolicyRelease.findUniqueOrThrow({
        where: { id: releaseId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "REVOKED" });
  });
});

function releaseVersions() {
  return {
    locale: SEARCH_POLICY_RELEASE_V2.locale,
    searchPolicyVersion: SEARCH_POLICY_RELEASE_V2.searchPolicyVersion,
    taxonomyVersion: SEARCH_POLICY_RELEASE_V2.taxonomyVersion,
    rankingVersion: SEARCH_POLICY_RELEASE_V2.rankingVersion,
  } as const;
}

function db(): DatabaseClient {
  if (database === undefined)
    throw new Error("Search-dimension database unavailable.");
  return database;
}
