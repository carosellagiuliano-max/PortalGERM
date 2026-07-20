import { describe, expect, it } from "vitest";

import { createSeedIdentity, SeedIdentityError } from "@/prisma/seed/ids";
import { mergeSeedIdentitySets } from "@/prisma/seed/identity-catalog";

describe("seed identity catalog", () => {
  it("collapses exact cross-block references", () => {
    const shared = createSeedIdentity("user", "candidate@demo.ch");
    const merged = mergeSeedIdentitySets(
      [shared, createSeedIdentity("company", "demo-ag")],
      [shared, createSeedIdentity("candidate-profile", "candidate@demo.ch")],
    );

    expect(merged).toHaveLength(3);
    expect(merged.filter((identity) => identity.entity === "user")).toEqual([
      shared,
    ]);
  });

  it("retains deterministic ordering independent of block order", () => {
    const first = [createSeedIdentity("skill", "react")];
    const second = [createSeedIdentity("category", "informatik")];

    expect(mergeSeedIdentitySets(first, second)).toEqual(
      mergeSeedIdentitySets(second, first),
    );
  });

  it("rejects a duplicate semantic identity with another UUID", () => {
    const stable = createSeedIdentity("user", "candidate@demo.ch");
    expect(() =>
      mergeSeedIdentitySets([stable], [
        {
          ...stable,
          id: "00000000-0000-5000-8000-000000000001",
        },
      ]),
    ).toThrow(SeedIdentityError);
  });
});
