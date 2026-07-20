import { describe, expect, it } from "vitest";

import {
  SEED_COMPATIBILITY_BASE_VERSION,
  SEED_DATASET_VERSION,
} from "@/prisma/seed/contract";
import {
  SeedIdentityError,
  SeedIdentityRegistry,
  assertSeedIdentityIntegrity,
  createSeedIdentity,
  stableSeedId,
} from "@/prisma/seed/ids";

describe("stable Phase-09 seed identities", () => {
  it("rotates the manifest version without changing Phase-05 semantic IDs", () => {
    expect(SEED_DATASET_VERSION).toBe("phase-09-demo-v6");
    expect(SEED_COMPATIBILITY_BASE_VERSION).toBe("phase-05-demo-v1");
    expect(stableSeedId("user", "candidate@demo.ch")).toBe(
      "b05d30e2-ade6-57f2-b376-12cef27a86e4",
    );
    expect(stableSeedId("company", "novarigi-digital")).toBe(
      "3faaae32-cdfd-50e3-aebd-abe989d28209",
    );
  });

  it("derives the same RFC UUID from the same canonical semantic key", () => {
    const expected = stableSeedId("company", "demo-pro-company");

    expect(stableSeedId("company", "  DEMO-PRO-COMPANY ")).toBe(expected);
    expect(expected).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stableSeedId("job", "demo-pro-company")).not.toBe(expected);
  });

  it("sorts integrity snapshots independently of registration order", () => {
    const company = createSeedIdentity("company", "alpenblick-digital-ag");
    const job = createSeedIdentity("job", "backend-engineer-zuerich");

    expect(assertSeedIdentityIntegrity([company, job])).toEqual(
      assertSeedIdentityIntegrity([job, company]),
    );
  });

  it("rejects canonical duplicate natural keys", () => {
    const first = createSeedIdentity("company", "demo-company");
    const duplicate = {
      ...first,
      naturalKey: "  DEMO-COMPANY ",
    };

    expectIdentityError(
      () => assertSeedIdentityIntegrity([first, duplicate]),
      "DUPLICATE_NATURAL_KEY",
    );
  });

  it("rejects duplicate IDs across distinct semantic identities", () => {
    const first = createSeedIdentity("company", "first-company");
    const second = createSeedIdentity("company", "second-company");

    expectIdentityError(
      () => assertSeedIdentityIntegrity([first, { ...second, id: first.id }]),
      "DUPLICATE_ID",
    );
  });

  it("rejects ID drift even when the UUID is otherwise well formed", () => {
    const first = createSeedIdentity("company", "first-company");
    const unrelated = createSeedIdentity("company", "unrelated-company");

    expectIdentityError(
      () => assertSeedIdentityIntegrity([{ ...first, id: unrelated.id }]),
      "ID_DRIFT",
    );
  });

  it("offers a registry that rejects the second conflicting registration", () => {
    const registry = new SeedIdentityRegistry();
    registry.register("skill", "typescript");

    expectIdentityError(
      () => registry.register("skill", "TypeScript"),
      "DUPLICATE_NATURAL_KEY",
    );
    expect(registry.snapshot()).toHaveLength(1);
  });

  it.each([
    ["Company", "valid-key"],
    ["company", ""],
    ["company", "contains\u0000control"],
  ])("rejects a non-canonical semantic identity (%s, %s)", (entity, key) => {
    expect(() => stableSeedId(entity, key)).toThrow(SeedIdentityError);
  });
});

function expectIdentityError(
  action: () => unknown,
  code: SeedIdentityError["code"],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SeedIdentityError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected SeedIdentityError ${code}.`);
}
