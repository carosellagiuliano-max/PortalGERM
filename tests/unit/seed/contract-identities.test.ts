import { describe, expect, it } from "vitest";

import { SEED_DATASET_VERSION } from "@/prisma/seed/contract";
import { buildSeedPlanningGraph } from "@/prisma/seed/contract-identities";
import { buildSeedContractHeader } from "@/prisma/seed/manifest";

describe("complete Phase-05 identity contract", () => {
  it("builds every dependency before the first database write", () => {
    const graph = buildSeedPlanningGraph();

    expect(graph.companies).toHaveLength(25);
    expect(graph.jobs).toHaveLength(115);
    expect(graph.jobs.filter((job) => job.status === "PUBLISHED")).toHaveLength(
      100,
    );
    expect(graph.adminUserId).toMatch(/^[a-f0-9-]{36}$/);
    expect(graph.identities.length).toBeGreaterThan(2_000);
  });

  it("produces a stable contract hash independent of construction order", () => {
    const first = buildSeedPlanningGraph();
    const second = buildSeedPlanningGraph();
    const input = {
      anchorAt: "2026-07-20T10:00:00.000Z",
      seedVersion: SEED_DATASET_VERSION,
    } as const;

    expect(first.identities).toEqual(second.identities);
    expect(
      buildSeedContractHeader({ ...input, identities: first.identities })
        .contractHash,
    ).toBe(
      buildSeedContractHeader({ ...input, identities: second.identities })
        .contractHash,
    );
  });
});
