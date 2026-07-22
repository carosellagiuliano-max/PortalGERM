import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listIndexableClusterLandings,
  loadPublicClusterLanding,
} from "@/lib/seo/cluster-indexability";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const CANTON_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

describe("cluster indexability snapshot guard", () => {
  it.each([
    ["live jobs", { liveJobCount: 49 }],
    ["active employers", { activeEmployerCount: 14 }],
    ["active candidates", { activeCandidateCount: 199 }],
    ["median applications", { medianApplicationsTimes2: 5 }],
    ["response rate", { responseRateBasisPoints: 6_999 }],
    ["promoted-query coverage", { contentCoverageBasisPoints: 7_999 }],
  ] as const)(
    "keeps a persisted %s threshold-minus-one snapshot out of routes and sitemap",
    async (_label, override) => {
      const assessment = { ...passingAssessment(), ...override };
      const database = databaseForAssessment(assessment);

      await expect(
        loadPublicClusterLanding(
          {
            kind: "pair",
            cantonSlug: "zuerich",
            categorySlug: "engineering-technik",
          },
          { now: NOW, database },
        ),
      ).resolves.toMatchObject({
        indexable: false,
        activeAssessmentId: null,
      });
      await expect(
        listIndexableClusterLandings(NOW, database),
      ).resolves.toEqual([]);
    },
  );
});

function passingAssessment() {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    evaluatedAt: NOW,
    liveJobCount: 50,
    activeCandidateCount: 200,
    activeEmployerCount: 15,
    responseRateBasisPoints: 7_000,
    contentCoverageBasisPoints: 8_000,
    medianApplicationsTimes2: 6,
    canton: { slug: "zuerich" },
    category: { slug: "engineering-technik" },
  };
}

function databaseForAssessment(assessment: ReturnType<typeof passingAssessment>) {
  const content = {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "engineering-zuerich",
    canonicalPath: "/jobs/kanton/zuerich/kategorie/engineering-technik",
    locale: "de-CH",
    type: "CLUSTER",
    dataProvenance: "LIVE",
    currentPublishedRevisionId: "55555555-5555-4555-8555-555555555555",
    updatedAt: NOW,
    currentPublishedRevision: {
      id: "55555555-5555-4555-8555-555555555555",
      contentPageId: "44444444-4444-4444-8444-444444444444",
      status: "PUBLISHED",
      title: "Geprüfte Engineering-Jobs in Zürich",
      excerpt: "Redaktionell geprüfte Orientierung für diesen Schweizer Stellenmarkt.",
      body: Array.from(
        { length: 90 },
        (_, index) => `Orientierung${index}`,
      ).join(" "),
      reviewedAt: new Date("2026-07-21T10:00:00.000Z"),
      publishedAt: new Date("2026-07-21T11:00:00.000Z"),
    },
  };
  return {
    canton: {
      findFirst: async () => ({
        id: CANTON_ID,
        code: "ZH",
        name: "Zürich",
        slug: "zuerich",
      }),
    },
    category: {
      findFirst: async () => ({
        id: CATEGORY_ID,
        name: "Engineering & Technik",
        slug: "engineering-technik",
      }),
    },
    clusterLaunchAssessment: {
      findFirst: async () => assessment,
      findMany: async () => [assessment],
    },
    contentPage: {
      findFirst: async () => content,
      findMany: async () => [content],
    },
  } as never;
}
