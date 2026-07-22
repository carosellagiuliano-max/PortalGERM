import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildClusterMetadata: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/seo/cluster-metadata", () => ({
  buildClusterMetadata: mocks.buildClusterMetadata,
}));
vi.mock("@/components/public/job-cluster-page", () => ({
  JobClusterPage: () => null,
}));

import { generateMetadata as cantonMetadata } from "@/app/(public)/jobs/kanton/[slug]/page";
import { generateMetadata as categoryMetadata } from "@/app/(public)/jobs/kategorie/[slug]/page";
import { generateMetadata as pairMetadata } from "@/app/(public)/jobs/kanton/[slug]/kategorie/[category]/page";

describe("Phase 15 cluster route query-state indexing", () => {
  beforeEach(() => {
    mocks.buildClusterMetadata.mockReset();
    mocks.buildClusterMetadata.mockResolvedValue({ title: "Cluster" });
  });

  it.each([
    ["canton", cantonMetadata, { slug: "zuerich" }],
    ["category", categoryMetadata, { slug: "engineering-technik" }],
    ["pair", pairMetadata, { slug: "zuerich", category: "engineering-technik" }],
  ] as const)("marks every non-clean %s URL state as pagination/noindex state", async (
    _label,
    generateMetadata,
    params,
  ) => {
    await generateMetadata({
      params: Promise.resolve(params),
      searchParams: Promise.resolve({ campaign: "untrusted" }),
    } as never);

    expect(mocks.buildClusterMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      { hasPagination: true },
    );
  });

  it("keeps the clean landing eligible for the underlying gate decision", async () => {
    await cantonMetadata({
      params: Promise.resolve({ slug: "zuerich" }),
      searchParams: Promise.resolve({}),
    });

    expect(mocks.buildClusterMetadata).toHaveBeenCalledWith(
      { kind: "canton", cantonSlug: "zuerich" },
      { hasPagination: false },
    );
  });
});
