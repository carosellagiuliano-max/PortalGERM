import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  SEARCH_CONCEPTS_DE_CH_V1,
  SEARCH_CONCEPT_CORPUS_DIGEST_V1,
  SEARCH_POLICY_RELEASE_V2,
  haveSearchConceptOverlapV2,
  normalizeSearchValue,
} from "@/lib/search/concepts-v2";
import { calculateRelevanceProxy } from "@/lib/search/relevance";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let releaseId = "";

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase30_search_parity");
  database = createDatabaseClient(migrated.connectionString);
  releaseId = randomUUID();
  await database.searchPolicyRelease.create({
    data: {
      id: releaseId,
      code: "phase30-technical-de-ch-v1",
      status: "DRAFT",
      locale: SEARCH_POLICY_RELEASE_V2.locale,
      searchPolicyVersion: SEARCH_POLICY_RELEASE_V2.searchPolicyVersion,
      taxonomyVersion: SEARCH_POLICY_RELEASE_V2.taxonomyVersion,
      rankingVersion: SEARCH_POLICY_RELEASE_V2.rankingVersion,
      corpusDigest: SEARCH_CONCEPT_CORPUS_DIGEST_V1,
    },
  });
  for (const concept of SEARCH_CONCEPTS_DE_CH_V1) {
    const conceptId = randomUUID();
    await database.searchConcept.create({
      data: {
        id: conceptId,
        releaseId,
        stableKey: concept.key,
        type: concept.type,
        locale: SEARCH_POLICY_RELEASE_V2.locale,
        canonicalLabel: concept.canonicalLabel,
        normalizedLabel: normalizeSearchValue(concept.canonicalLabel),
      },
    });
    await database.searchAlias.createMany({
      data: concept.aliases.map((alias) => ({
        id: randomUUID(),
        releaseId,
        conceptId,
        kind: "VARIANT" as const,
        locale: SEARCH_POLICY_RELEASE_V2.locale,
        label: alias,
        normalizedLabel: normalizeSearchValue(alias),
        sourceCode: "TECHNICAL_CORPUS_PENDING_EXPERT_REVIEW",
      })),
    });
  }
}, 600_000);

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe.sequential("Phase 30 PostgreSQL search-v2 consumer parity", () => {
  it("binds the persisted draft corpus to the exact runtime release identity", async () => {
    const release = await db().searchPolicyRelease.findUniqueOrThrow({
      where: { id: releaseId },
      include: {
        concepts: {
          orderBy: { stableKey: "asc" },
          include: { aliases: { orderBy: { normalizedLabel: "asc" } } },
        },
      },
    });

    expect(release).toMatchObject({
      status: "DRAFT",
      locale: SEARCH_POLICY_RELEASE_V2.locale,
      searchPolicyVersion: SEARCH_POLICY_RELEASE_V2.searchPolicyVersion,
      taxonomyVersion: SEARCH_POLICY_RELEASE_V2.taxonomyVersion,
      rankingVersion: SEARCH_POLICY_RELEASE_V2.rankingVersion,
      corpusDigest: SEARCH_CONCEPT_CORPUS_DIGEST_V1,
    });
    expect(release.concepts.map(({ stableKey }) => stableKey)).toEqual(
      SEARCH_CONCEPTS_DE_CH_V1.map(({ key }) => key).sort(),
    );
    expect(
      release.concepts.every(
        ({ aliases }) =>
          aliases.length > 0 &&
          aliases.every(
            ({ sourceCode }) =>
              sourceCode === "TECHNICAL_CORPUS_PENDING_EXPERT_REVIEW",
          ),
      ),
    ).toBe(true);
  });

  it("gives Search/Alerts and Preference/Recommendation matching the same concept identity", () => {
    for (const concept of SEARCH_CONCEPTS_DE_CH_V1) {
      for (const alias of concept.aliases) {
        expect(
          calculateRelevanceProxy(alias, {
            title: concept.canonicalLabel,
            companyName: "",
            body: "",
          }).score,
          `${concept.key}:${alias}`,
        ).toBeGreaterThan(0);
        expect(
          haveSearchConceptOverlapV2(alias, concept.canonicalLabel),
          `${concept.key}:${alias}`,
        ).toBe(true);
      }
    }
    expect(
      haveSearchConceptOverlapV2(
        "Pflegefachperson",
        "Softwareentwicklerin React",
      ),
    ).toBe(false);
  });
});

function db() {
  if (database === undefined) {
    throw new Error("Search parity test database unavailable.");
  }
  return database;
}
