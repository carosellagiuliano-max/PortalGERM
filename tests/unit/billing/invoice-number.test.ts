import {
  INVOICE_NUMBER_ADVISORY_LOCK_NAMESPACE,
  allocateInvoiceNumber,
  formatInvoiceNumber,
  getZurichYear,
  parseInvoiceNumber,
  type InvoiceNumberPort,
  type InvoiceNumberTransaction,
} from "@/lib/billing/invoice-number";
import { describe, expect, it, vi } from "vitest";

describe("invoice number format", () => {
  it.each([
    [2026, 1, "STH-2026-00001"],
    [2026, 99_999, "STH-2026-99999"],
    [2026, 100_000, "STH-2026-100000"],
  ] as const)("formats %s/%s", (year, sequence, expected) => {
    expect(formatInvoiceNumber(year, sequence)).toBe(expected);
    expect(parseInvoiceNumber(expected)).toEqual({ year, sequence });
  });

  it.each([
    "",
    "STH-26-00001",
    "STH-2026-1",
    "STH-2026-000001",
    "sth-2026-00001",
    "STH-2026-00000",
  ])(
    "rejects malformed number %s",
    (value) => {
      expect(parseInvoiceNumber(value)).toBeNull();
    },
  );

  it("uses the Europe/Zurich year at the UTC boundary", () => {
    expect(getZurichYear(new Date("2026-12-31T22:59:59.999Z"))).toBe(2026);
    expect(getZurichYear(new Date("2026-12-31T23:00:00.000Z"))).toBe(2027);
  });
});

describe("allocateInvoiceNumber", () => {
  function makePort(previousSequence: number | null) {
    const events: string[] = [];
    const transaction: InvoiceNumberTransaction = {
      acquireInvoiceYearAdvisoryLock: vi.fn(async () => {
        events.push("lock");
      }),
      findHighestInvoiceSequence: vi.fn(async () => {
        events.push("read");
        return previousSequence;
      }),
    };
    const port: InvoiceNumberPort = {
      transaction: vi.fn(async (callback) => {
        events.push("transaction:start");
        const result = await callback(transaction);
        events.push("transaction:end");
        return result;
      }),
    };
    return { events, port, transaction };
  }

  it("locks and inserts the first number in the same transaction callback", async () => {
    const { events, port, transaction } = makePort(null);
    const insert = vi.fn(async (receivedTransaction, number: string) => {
      events.push("insert");
      expect(receivedTransaction).toBe(transaction);
      return { invoiceId: "invoice-1", number };
    });

    const result = await allocateInvoiceNumber(
      new Date("2026-07-19T12:00:00.000Z"),
      port,
      insert,
    );

    expect(result).toEqual({
      number: "STH-2026-00001",
      value: { invoiceId: "invoice-1", number: "STH-2026-00001" },
    });
    expect(events).toEqual([
      "transaction:start",
      "lock",
      "read",
      "insert",
      "transaction:end",
    ]);
    expect(transaction.acquireInvoiceYearAdvisoryLock).toHaveBeenCalledWith(
      INVOICE_NUMBER_ADVISORY_LOCK_NAMESPACE,
      2026,
    );
  });

  it("continues beyond the five-digit minimum", async () => {
    const { port } = makePort(99_999);
    const result = await allocateInvoiceNumber(
      new Date("2026-07-19T12:00:00.000Z"),
      port,
      async (_transaction, number) => number,
    );
    expect(result).toEqual({
      number: "STH-2026-100000",
      value: "STH-2026-100000",
    });
  });

  it("fails closed on a malformed stored sequence", async () => {
    const { port } = makePort(0);
    await expect(
      allocateInvoiceNumber(
        new Date("2026-07-19T12:00:00.000Z"),
        port,
        async () => "not-inserted",
      ),
    ).rejects.toThrow("stored invoice sequence");
  });

  it("propagates insert failure so the transaction adapter can roll back", async () => {
    const { port } = makePort(4);
    await expect(
      allocateInvoiceNumber(
        new Date("2026-07-19T12:00:00.000Z"),
        port,
        async () => {
          throw new Error("insert failed");
        },
      ),
    ).rejects.toThrow("insert failed");
  });

  it("supports serialized concurrent reservations without duplicate return values", async () => {
    let highest = 0;
    let queue = Promise.resolve();
    const transaction: InvoiceNumberTransaction = {
      acquireInvoiceYearAdvisoryLock: async () => undefined,
      findHighestInvoiceSequence: async () => (highest === 0 ? null : highest),
    };
    const port: InvoiceNumberPort = {
      transaction: async (callback) => {
        const previous = queue;
        let release: () => void = () => undefined;
        queue = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback(transaction);
        } finally {
          release();
        }
      },
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        allocateInvoiceNumber(
          new Date("2026-07-19T12:00:00.000Z"),
          port,
          async (_transaction, number) => {
            const parsed = parseInvoiceNumber(number);
            expect(parsed).not.toBeNull();
            highest = parsed?.sequence ?? highest;
            return number;
          },
        ),
      ),
    );
    expect(results.map((result) => result.number)).toEqual([
      "STH-2026-00001",
      "STH-2026-00002",
      "STH-2026-00003",
      "STH-2026-00004",
      "STH-2026-00005",
    ]);
  });
});
