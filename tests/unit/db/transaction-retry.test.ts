import { describe, expect, it, vi } from "vitest";

import {
  isRetryableTransactionError,
  runRetryableDatabaseOperation,
} from "@/lib/db/transaction-retry";

describe("database transaction retry", () => {
  it.each([
    { code: "P2034" },
    { code: "40001" },
    { code: "40P01" },
    { code: "P2010", meta: { code: "40001" } },
    {
      code: "P2010",
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "40P01",
            originalMessage: "deadlock detected",
          },
        },
      },
    },
    { cause: { cause: { sqlState: "40001" } } },
  ])("recognizes retryable PostgreSQL evidence %#", (error) => {
    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it.each([
    { code: "P2002" },
    { code: "P2010", meta: { code: "23505" } },
    new Error("ordinary database failure"),
    null,
  ])("rejects non-retryable evidence %#", (error) => {
    expect(isRetryableTransactionError(error)).toBe(false);
  });

  it("backs off and succeeds without exceeding the database operation count", async () => {
    const delays: number[] = [];
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({
        code: "P2010",
        meta: {
          driverAdapterError: { cause: { originalCode: "40001" } },
        },
      })
      .mockResolvedValue("ok");

    await expect(
      runRetryableDatabaseOperation(operation, {
        maxAttempts: 4,
        jitter: () => 0,
        delay: async (milliseconds) => {
          delays.push(milliseconds);
        },
      }),
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([5, 10]);
  });

  it("stops at the bounded retry limit", async () => {
    const delay = vi.fn(async () => undefined);
    const operation = vi.fn(async () => {
      throw { code: "40P01" };
    });

    await expect(
      runRetryableDatabaseOperation(operation, {
        maxAttempts: 3,
        jitter: () => 0,
        delay,
      }),
    ).rejects.toEqual({ code: "40P01" });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("never retries a non-retryable operation", async () => {
    const delay = vi.fn(async () => undefined);
    const failure = { code: "P2002" };
    const operation = vi.fn(async () => {
      throw failure;
    });

    await expect(
      runRetryableDatabaseOperation(operation, { delay }),
    ).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
});
