import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import {
  DemoSeedVerificationError,
  verifyDemoSeedDatabase,
} from "@/prisma/seed/verifier";

const unreachableDatabase = Object.freeze({}) as PrismaClient;

describe("Phase-05 database verifier boundary", () => {
  it("rejects an invalid anchor before reaching the database", async () => {
    await expect(
      verifyDemoSeedDatabase(unreachableDatabase, new Date(Number.NaN)),
    ).rejects.toThrow(
      "Demo seed verification requires a valid anchorAt Date.",
    );
  });

  it("rejects divergent orchestrator handles before reaching the database", async () => {
    await expect(
      verifyDemoSeedDatabase(unreachableDatabase, new Date("2026-07-20T00:00:00.000Z"), {
        companyHandles: [],
      }),
    ).rejects.toBeInstanceOf(DemoSeedVerificationError);
  });
});
