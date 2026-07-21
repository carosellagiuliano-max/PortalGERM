import { describe, expect, it, vi } from "vitest";

import {
  createOrVerifySeedRecord,
  SeedDataDriftError,
} from "@/prisma/seed/create-or-verify";

type Fixture = Readonly<{ id: string; name: string }>;

function input(overrides: Partial<{
  create: () => Promise<Fixture>;
  findExisting: () => Promise<Fixture | null>;
}> = {}) {
  return {
    create:
      overrides.create ??
      vi.fn(async () => ({ id: "stable-id", name: "Demo" })),
    entity: "fixture",
    expected: { id: "stable-id", name: "Demo" },
    findExisting: overrides.findExisting ?? vi.fn(async () => null),
    naturalKey: "demo",
    project: (record: Fixture) => ({ id: record.id, name: record.name }),
  } as const;
}

describe("create-or-verify seed records", () => {
  it("creates a missing row without issuing an update", async () => {
    const request = input();
    const result = await createOrVerifySeedRecord(request);

    expect(result).toEqual({ created: true, record: { id: "stable-id", name: "Demo" } });
    expect(request.create).toHaveBeenCalledOnce();
  });

  it("returns an identical existing row without calling create", async () => {
    const create = vi.fn(async () => ({ id: "stable-id", name: "Demo" }));
    const result = await createOrVerifySeedRecord(
      input({
        create,
        findExisting: vi.fn(async () => ({ id: "stable-id", name: "Demo" })),
      }),
    );

    expect(result.created).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("fails closed when an existing stable identity has drifted", async () => {
    await expect(
      createOrVerifySeedRecord(
        input({
          findExisting: vi.fn(async () => ({ id: "stable-id", name: "Changed" })),
        }),
      ),
    ).rejects.toBeInstanceOf(SeedDataDriftError);
  });

  it("propagates a unique violation so the transaction boundary can retry", async () => {
    const findExisting = vi
      .fn<() => Promise<Fixture | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "stable-id", name: "Demo" });
    const uniqueError = Object.assign(new Error("unique"), { code: "P2002" });

    await expect(
      createOrVerifySeedRecord(
        input({
          create: vi.fn(async () => Promise.reject(uniqueError)),
          findExisting,
        }),
      ),
    ).rejects.toBe(uniqueError);

    expect(findExisting).toHaveBeenCalledOnce();
  });

  it("does not hide non-unique database errors", async () => {
    const failure = new Error("database unavailable");
    await expect(
      createOrVerifySeedRecord(
        input({ create: vi.fn(async () => Promise.reject(failure)) }),
      ),
    ).rejects.toBe(failure);
  });
});
