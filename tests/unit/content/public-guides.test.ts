// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const { getPublicDataContextMock } = vi.hoisted(() => ({
  getPublicDataContextMock: vi.fn(() => ({
    eligibilityEnvironment: "production" as "production" | "non-production",
    liveOnly: true as boolean,
    showDemoBanner: false as boolean,
  })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/lib/public/environment", () => ({
  getPublicDataContext: getPublicDataContextMock,
}));

import {
  evaluatePublicGuideEligibility,
  listPublicGuides,
  selectRelatedPublicGuides,
  type PublicGuideSnapshot,
} from "@/lib/content/public-guides";
import type { PublicGuideModel } from "@/lib/public/types";

const NOW = new Date("2026-07-20T12:00:00.000Z");

const SNAPSHOT: PublicGuideSnapshot = {
  id: "guide-1",
  slug: "lohn-verhandeln-schweiz",
  locale: "de-CH",
  type: "GUIDE",
  canonicalPath: "/ratgeber/lohn-verhandeln-schweiz",
  dataProvenance: "LIVE",
  currentPublishedRevisionId: "revision-1",
  revision: {
    id: "revision-1",
    contentPageId: "guide-1",
    status: "PUBLISHED",
    title: "<b>Lohn &amp; Verhandlung</b><script>secret()</script>",
    excerpt: "<p>Sachlich &amp; sicher.</p>",
    body: "<p>Erster Abschnitt.</p><iframe>hidden</iframe><p>Zweiter Abschnitt.</p>",
    reviewedAt: new Date("2026-07-01T09:00:00.000Z"),
    publishedAt: new Date("2026-07-02T09:00:00.000Z"),
  },
};

const LIVE_CONTEXT = Object.freeze({ liveOnly: true });
const DEMO_CONTEXT = Object.freeze({ liveOnly: false });

function revisionPatch(
  patch: Partial<NonNullable<PublicGuideSnapshot["revision"]>>,
): PublicGuideSnapshot {
  return {
    ...SNAPSHOT,
    revision: { ...SNAPSHOT.revision!, ...patch },
  };
}

function guideModel(
  id: string,
  slug: string,
  publishedAt: string,
): PublicGuideModel {
  return Object.freeze({
    id,
    slug,
    canonicalPath: `/guide/${slug}`,
    title: `Guide ${id}`,
    excerpt: "Excerpt",
    body: "Body",
    publishedAt: new Date(publishedAt),
    dataProvenance: "LIVE",
  });
}

describe("public Guide read policy", () => {
  it("returns only the sanitized public projection and accepts stored /ratgeber paths", () => {
    const result = evaluatePublicGuideEligibility(SNAPSHOT, NOW, LIVE_CONTEXT);

    expect(result).toEqual({
      id: "guide-1",
      slug: "lohn-verhandeln-schweiz",
      canonicalPath: "/guide/lohn-verhandeln-schweiz",
      title: "Lohn & Verhandlung",
      excerpt: "Sachlich & sicher.",
      body: "Erster Abschnitt.\n\nZweiter Abschnitt.",
      publishedAt: new Date("2026-07-02T09:00:00.000Z"),
      dataProvenance: "LIVE",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result?.publishedAt).not.toBe(SNAPSHOT.revision?.publishedAt);
    expect(JSON.stringify(result)).not.toMatch(/secret|hidden|reviewedAt|contentPageId/u);
  });

  it("also accepts the phase-07 /guide canonical form", () => {
    expect(
      evaluatePublicGuideEligibility(
        { ...SNAPSHOT, canonicalPath: `/guide/${SNAPSHOT.slug}` },
        NOW,
        LIVE_CONTEXT,
      ),
    ).not.toBeNull();
  });

  it.each([
    ["wrong locale", { ...SNAPSHOT, locale: "de-DE" }],
    ["wrong type", { ...SNAPSHOT, type: "CLUSTER" }],
    ["invalid slug", { ...SNAPSHOT, slug: "../guide" }],
    ["unrelated canonical path", { ...SNAPSHOT, canonicalPath: "/artikel/x" }],
    ["revision pointer drift", { ...SNAPSHOT, currentPublishedRevisionId: "old" }],
    ["revision ownership drift", revisionPatch({ contentPageId: "other-guide" })],
    ["draft", revisionPatch({ status: "DRAFT" })],
    ["in review", revisionPatch({ status: "IN_REVIEW" })],
    ["unpublished", revisionPatch({ status: "UNPUBLISHED" })],
    ["missing review", revisionPatch({ reviewedAt: null })],
    ["missing publication", revisionPatch({ publishedAt: null })],
    ["future publication", revisionPatch({ publishedAt: new Date(NOW.getTime() + 1) })],
    ["empty sanitized title", revisionPatch({ title: "<script>x</script>" })],
    ["empty sanitized excerpt", revisionPatch({ excerpt: "<style>x</style>" })],
    ["empty sanitized body", revisionPatch({ body: "<iframe>x</iframe>" })],
  ])("fails closed for %s", (_label, snapshot) => {
    expect(
      evaluatePublicGuideEligibility(snapshot, NOW, LIVE_CONTEXT),
    ).toBeNull();
  });

  it("allows publication exactly at now but rejects an invalid clock", () => {
    expect(
      evaluatePublicGuideEligibility(
        revisionPatch({ publishedAt: new Date(NOW) }),
        NOW,
        LIVE_CONTEXT,
      ),
    ).not.toBeNull();
    expect(
      evaluatePublicGuideEligibility(SNAPSHOT, new Date(Number.NaN), LIVE_CONTEXT),
    ).toBeNull();
  });

  it("excludes DEMO content from live-only reads and permits it in demo context", () => {
    const demo = { ...SNAPSHOT, dataProvenance: "DEMO" as const };
    expect(evaluatePublicGuideEligibility(demo, NOW, LIVE_CONTEXT)).toBeNull();
    expect(evaluatePublicGuideEligibility(demo, NOW, DEMO_CONTEXT)).toMatchObject({
      id: "guide-1",
      dataProvenance: "DEMO",
    });
  });

  it("gets provenance policy from the public data context for database reads", async () => {
    const demoRow = {
      id: SNAPSHOT.id,
      slug: SNAPSHOT.slug,
      locale: SNAPSHOT.locale,
      type: "GUIDE",
      canonicalPath: SNAPSHOT.canonicalPath,
      dataProvenance: "DEMO",
      currentPublishedRevisionId: SNAPSHOT.currentPublishedRevisionId,
      currentPublishedRevision: SNAPSHOT.revision,
    };
    const findMany = vi.fn().mockResolvedValue([demoRow]);
    const database = { contentPage: { findMany } };

    getPublicDataContextMock.mockReturnValueOnce({
      eligibilityEnvironment: "production",
      liveOnly: true,
      showDemoBanner: false,
    });
    await expect(
      listPublicGuides({ now: NOW, database: database as never }),
    ).resolves.toEqual([]);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        locale: "de-CH",
        type: "GUIDE",
        dataProvenance: "LIVE",
        currentPublishedRevision: {
          is: {
            status: "PUBLISHED",
            reviewedAt: { not: null },
            publishedAt: { lte: NOW },
          },
        },
      },
    });

    getPublicDataContextMock.mockReturnValueOnce({
      eligibilityEnvironment: "non-production",
      liveOnly: false,
      showDemoBanner: true,
    });
    await expect(
      listPublicGuides({ now: NOW, database: database as never }),
    ).resolves.toMatchObject([{ id: SNAPSHOT.id, dataProvenance: "DEMO" }]);
  });

  it("selects related guides deterministically by publication, slug and id", () => {
    const guides = [
      guideModel("current", "current", "2026-07-20T00:00:00.000Z"),
      guideModel("b", "zeta", "2026-07-19T00:00:00.000Z"),
      guideModel("c", "alpha", "2026-07-19T00:00:00.000Z"),
      guideModel("d", "older", "2026-07-18T00:00:00.000Z"),
      guideModel("c", "alpha", "2026-07-19T00:00:00.000Z"),
    ];

    const related = selectRelatedPublicGuides(guides, "current", 3);

    expect(related.map(({ id }) => id)).toEqual(["c", "b", "d"]);
    expect(Object.isFrozen(related)).toBe(true);
  });

  it("validates related-guide limits instead of silently changing semantics", () => {
    expect(() => selectRelatedPublicGuides([], "current", 0)).toThrow(RangeError);
    expect(() => selectRelatedPublicGuides([], "current", 13)).toThrow(RangeError);
  });
});
