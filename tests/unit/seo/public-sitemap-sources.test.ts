import { beforeEach, describe, expect, it, vi } from "vitest";

const listIndexableClusterLandings = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/seo/cluster-indexability", () => ({
  listIndexableClusterLandings,
}));

import {
  listEligibleClusterSitemapRows,
  listEligibleCompanySitemapRows,
  listEligibleGuideSitemapRows,
  listEligibleJobSitemapRows,
  PublicSitemapCapacityError,
} from "@/lib/seo/public-sitemap";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const UPDATED_AT = new Date("2026-07-21T08:00:00.000Z");

function databaseWithTransaction(transaction: object) {
  return {
    $transaction: vi.fn(async (consumer: (client: object) => unknown) =>
      consumer(transaction)
    ),
  } as never;
}

function eligibleJobRow(id: string, slug: string) {
  return {
    id,
    slug,
    companyId: "00000000-0000-4000-8000-000000000010",
    status: "PUBLISHED",
    dataProvenance: "LIVE",
    currentRevisionId: `${id.slice(0, -2)}20`,
    publishedRevisionId: `${id.slice(0, -2)}20`,
    publishedAt: new Date("2026-07-01T08:00:00.000Z"),
    expiresAt: new Date("2026-08-01T08:00:00.000Z"),
    company: {
      name: "Acme AG",
      status: "ACTIVE",
      dataProvenance: "LIVE",
      verificationRequests: [{ id: "verified-cycle" }],
    },
    publishedRevision: {
      id: `${id.slice(0, -2)}20`,
      title: "Pflegefachperson",
      description: "Eine öffentliche Stelle.",
      approvedAt: new Date("2026-06-30T08:00:00.000Z"),
      rejectedAt: null,
      validThrough: new Date("2026-08-01T08:00:00.000Z"),
      categoryId: "00000000-0000-4000-8000-000000000030",
      category: { isActive: true },
      cantonId: "00000000-0000-4000-8000-000000000040",
      cityId: "00000000-0000-4000-8000-000000000050",
      salaryMin: 80_000,
      salaryMax: 100_000,
      salaryPeriod: "YEARLY",
      responseTargetDays: 7,
      remoteType: "HYBRID",
      jobType: "PERMANENT",
      workloadMin: 80,
      workloadMax: 100,
      scoreSnapshots: [{ scorePoints: 91 }],
    },
  };
}

describe("Phase 15 sitemap database sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechecks every job batch through canonical public eligibility", async () => {
    const visibleId = "00000000-0000-4000-8000-000000000001";
    const hiddenId = "00000000-0000-4000-8000-000000000002";
    const driftId = "00000000-0000-4000-8000-000000000003";
    const inactiveCategoryId = "00000000-0000-4000-8000-000000000004";
    const jobFindMany = vi.fn(async (query: { select?: { updatedAt?: boolean } }) =>
      query.select?.updatedAt
        ? [
            { id: visibleId, slug: "pflegefachperson-acme-a1", updatedAt: UPDATED_AT },
            { id: hiddenId, slug: "hidden-acme-b2", updatedAt: UPDATED_AT },
            { id: driftId, slug: "revision-drift-acme-c3", updatedAt: UPDATED_AT },
            { id: inactiveCategoryId, slug: "inactive-category-acme-d4", updatedAt: UPDATED_AT },
          ]
        : [
            eligibleJobRow(visibleId, "pflegefachperson-acme-a1"),
            eligibleJobRow(hiddenId, "hidden-acme-b2"),
            {
              ...eligibleJobRow(driftId, "revision-drift-acme-c3"),
              currentRevisionId: "00000000-0000-4000-8000-000000000099",
            },
            {
              ...eligibleJobRow(
                inactiveCategoryId,
                "inactive-category-acme-d4",
              ),
              publishedRevision: {
                ...eligibleJobRow(
                  inactiveCategoryId,
                  "inactive-category-acme-d4",
                ).publishedRevision,
                category: { isActive: false },
              },
            },
          ]
    );
    const moderationRestrictionFindMany = vi.fn().mockResolvedValue([
      { targetType: "HIDE_JOB", targetId: hiddenId },
    ]);
    const database = databaseWithTransaction({
      job: { findMany: jobFindMany },
      moderationRestriction: { findMany: moderationRestrictionFindMany },
    });

    await expect(
      listEligibleJobSitemapRows(NOW, database, 10),
    ).resolves.toEqual([
      {
        path: "/jobs/pflegefachperson-acme-a1",
        lastModified: UPDATED_AT,
      },
    ]);
    expect(jobFindMany).toHaveBeenCalledTimes(2);
    expect(moderationRestrictionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
  });

  it("uses the closed public Company projection and excludes effective pauses", async () => {
    const companies = [
      {
        id: "company-visible",
        slug: "acme-ag",
        name: "Acme AG",
        industry: "Gesundheit",
        size: "51-200",
        status: "ACTIVE",
        dataProvenance: "LIVE",
        updatedAt: UPDATED_AT,
        locations: [
          { city: { name: "Zürich" }, canton: { name: "Zürich" } },
        ],
        verificationRequests: [],
      },
      {
        id: "company-paused",
        slug: "paused-ag",
        name: "Paused AG",
        industry: null,
        size: null,
        status: "ACTIVE",
        dataProvenance: "LIVE",
        updatedAt: UPDATED_AT,
        locations: [],
        verificationRequests: [],
      },
      {
        id: "company-invalid",
        slug: "Ungültiger Slug",
        name: "Invalid AG",
        industry: null,
        size: null,
        status: "ACTIVE",
        dataProvenance: "LIVE",
        updatedAt: UPDATED_AT,
        locations: [],
        verificationRequests: [],
      },
    ];
    const database = databaseWithTransaction({
      company: { findMany: vi.fn().mockResolvedValue(companies) },
      moderationRestriction: {
        findMany: vi.fn().mockResolvedValue([
          { targetId: "company-paused" },
        ]),
      },
    });

    await expect(
      listEligibleCompanySitemapRows(NOW, database, 10),
    ).resolves.toEqual([
      { path: "/companies/acme-ag", lastModified: UPDATED_AT },
    ]);
  });

  it("includes only current reviewed LIVE Guides and normalizes their canonical route", async () => {
    const validRevision = {
      id: "revision-valid",
      contentPageId: "guide-valid",
      status: "PUBLISHED",
      title: "Bewerbung in der Schweiz",
      excerpt: "Der kompakte Leitfaden.",
      body: "Sicher bewerben und transparente Stellen vergleichen.",
      reviewedAt: new Date("2026-07-18T08:00:00.000Z"),
      publishedAt: new Date("2026-07-19T08:00:00.000Z"),
    };
    const guides = [
      {
        id: "guide-valid",
        slug: "bewerbung-schweiz",
        locale: "de-CH",
        type: "GUIDE",
        canonicalPath: "/ratgeber/bewerbung-schweiz",
        dataProvenance: "LIVE",
        currentPublishedRevisionId: validRevision.id,
        updatedAt: UPDATED_AT,
        currentPublishedRevision: validRevision,
      },
      {
        id: "guide-unreviewed",
        slug: "unreviewed",
        locale: "de-CH",
        type: "GUIDE",
        canonicalPath: "/guide/unreviewed",
        dataProvenance: "LIVE",
        currentPublishedRevisionId: "revision-unreviewed",
        updatedAt: UPDATED_AT,
        currentPublishedRevision: {
          ...validRevision,
          id: "revision-unreviewed",
          contentPageId: "guide-unreviewed",
          reviewedAt: null,
        },
      },
    ];
    const database = databaseWithTransaction({
      contentPage: { findMany: vi.fn().mockResolvedValue(guides) },
    });

    await expect(
      listEligibleGuideSitemapRows(NOW, database, 10),
    ).resolves.toEqual([
      { path: "/guide/bewerbung-schweiz", lastModified: UPDATED_AT },
    ]);
  });

  it("passes the same database and clock to the cluster gate without truncating", async () => {
    const database = {} as never;
    listIndexableClusterLandings.mockResolvedValue([
      { path: "/jobs/kanton/zuerich", lastModified: UPDATED_AT },
    ]);

    await expect(
      listEligibleClusterSitemapRows(NOW, database, 1),
    ).resolves.toEqual([
      { path: "/jobs/kanton/zuerich", lastModified: UPDATED_AT },
    ]);
    expect(listIndexableClusterLandings).toHaveBeenCalledWith(NOW, database);

    await expect(
      listEligibleClusterSitemapRows(NOW, database, 0),
    ).rejects.toBeInstanceOf(PublicSitemapCapacityError);
  });
});
