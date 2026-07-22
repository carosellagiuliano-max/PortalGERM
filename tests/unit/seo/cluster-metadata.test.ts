import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicDataContext: vi.fn(),
  loadPublicClusterLanding: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/public/environment", () => ({
  getPublicDataContext: mocks.getPublicDataContext,
}));
vi.mock("@/lib/seo/cluster-indexability", () => ({
  loadPublicClusterLanding: mocks.loadPublicClusterLanding,
}));

import { buildClusterMetadata } from "@/lib/seo/cluster-metadata";

describe("cluster metadata gate", () => {
  beforeEach(() => {
    mocks.getPublicDataContext.mockReset();
    mocks.loadPublicClusterLanding.mockReset();
    mocks.getPublicDataContext.mockReturnValue({ publicIndexingAllowed: true });
    mocks.loadPublicClusterLanding.mockResolvedValue({
      kind: "pair",
      canonicalPath: "/jobs/kanton/zuerich/kategorie/informatik",
      indexable: true,
      canton: { name: "Zürich" },
      category: { name: "Informatik" },
      content: {
        title: "Geprüfte Informatik-Jobs in Zürich",
        description: "Redaktionell geprüfte Orientierung mit aktuellem Stellenbestand.",
      },
      aggregateFacts: {
        kind: "pair",
        evaluatedAt: new Date("2026-07-22T10:00:00.000Z"),
        eligibleJobCount: 50,
        activeEmployerCount: 15,
        activeCandidateCount: 200,
        responseRateBasisPoints: 7_000,
      },
    });
  });

  it("self-canonicalizes and indexes only the passing production landing", async () => {
    await expect(buildClusterMetadata({
      kind: "pair",
      cantonSlug: "zuerich",
      categorySlug: "informatik",
    })).resolves.toMatchObject({
      title: "Geprüfte Informatik-Jobs in Zürich",
      description: expect.stringContaining(
        "Geprüfter Stand vom 22.07.2026: 50 Stellen, 15 Arbeitgeber, 200 aktive Kandidierende und 70% fristgerechte Antworten.",
      ),
      alternates: { canonical: "/jobs/kanton/zuerich/kategorie/informatik" },
      robots: { index: true, follow: true },
      openGraph: { url: "/jobs/kanton/zuerich/kategorie/informatik" },
    });
  });

  it("adds the current passing-child aggregate to approved dimension copy", async () => {
    mocks.loadPublicClusterLanding.mockResolvedValue({
      kind: "canton",
      canonicalPath: "/jobs/kanton/zuerich",
      indexable: true,
      canton: { name: "Zürich" },
      category: null,
      content: {
        title: "Geprüfte Jobs im Kanton Zürich",
        description: "Redaktionell geprüfte Orientierung für Zürich.",
      },
      aggregateFacts: { kind: "dimension", passingChildCount: 2 },
    });

    const metadata = await buildClusterMetadata({
      kind: "canton",
      cantonSlug: "zuerich",
    });
    expect(metadata.description).toContain(
      "Geprüfter Stand: 2 freigegebene Fachcluster.",
    );
    expect(metadata.openGraph).toMatchObject({
      description: expect.stringContaining("2 freigegebene Fachcluster"),
    });
  });

  it.each([
    ["non-production", false, true, false],
    ["failed gate", true, false, false],
    ["cursor page", true, true, true],
  ] as const)("uses noindex,follow for %s", async (_label, production, indexable, pagination) => {
    mocks.getPublicDataContext.mockReturnValue({ publicIndexingAllowed: production });
    mocks.loadPublicClusterLanding.mockResolvedValue({
      kind: "canton",
      canonicalPath: "/jobs/kanton/zuerich",
      indexable,
      canton: { name: "Zürich" },
      category: null,
      content: null,
      aggregateFacts: { kind: "dimension", passingChildCount: 0 },
    });
    const metadata = await buildClusterMetadata(
      { kind: "canton", cantonSlug: "zuerich" },
      { hasPagination: pagination },
    );
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toEqual({ canonical: "/jobs/kanton/zuerich" });
  });

  it("fails closed on an unknown catalog slug without echoing it into content", async () => {
    mocks.loadPublicClusterLanding.mockResolvedValue(null);
    const metadata = await buildClusterMetadata({
      kind: "category",
      categorySlug: "unknown-safe-slug",
    });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.title).toBe("Jobs in Kategorie");
  });
});
