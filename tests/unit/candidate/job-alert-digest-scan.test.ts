import { describe, expect, it, vi } from "vitest";

import { scanJobAlertDigestMatches } from "@/lib/candidate/job-alert-digest-scan";

describe("job-alert digest candidate scan", () => {
  it("continues past 1,000 ineligible candidates to a later eligible job", async () => {
    const candidates = [
      ...Array.from({ length: 1_001 }, (_, index) => ({
        id: `ineligible-${String(index).padStart(4, "0")}`,
        eligible: false,
      })),
      { id: "eligible-after-1000", eligible: true },
    ];
    const loadPage = vi.fn(
      async (afterCursor: string | undefined, take: number) => {
        const start = afterCursor === undefined
          ? 0
          : candidates.findIndex(({ id }) => id === afterCursor) + 1;
        return candidates.slice(start, start + take);
      },
    );

    const matches = await scanJobAlertDigestMatches({
      pageSize: 100,
      maximumMatches: 20,
      loadPage,
      cursorOf: ({ id }) => id,
      evaluatePage: async (page) => page.filter(({ eligible }) => eligible),
    });

    expect(matches).toEqual([{ id: "eligible-after-1000", eligible: true }]);
    expect(loadPage).toHaveBeenCalledTimes(11);
    expect(loadPage).toHaveBeenLastCalledWith("ineligible-0999", 100);
  });

  it("rejects a cycling keyset instead of treating a partial scan as success", async () => {
    await expect(
      scanJobAlertDigestMatches({
        pageSize: 1,
        maximumMatches: 1,
        loadPage: async () => [{ id: "same-row" }],
        cursorOf: ({ id }) => id,
        evaluatePage: async () => [],
      }),
    ).rejects.toThrow("Job-alert keyset scan did not advance.");
  });
});
