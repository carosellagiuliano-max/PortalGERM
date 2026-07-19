import {
  createLogger,
  redactLogValue,
  type StructuredLogRecord,
} from "@/lib/utils/logger";
import { describe, expect, it } from "vitest";

describe("structured logger", () => {
  it("redacts nested sensitive metadata, arrays and Error details", () => {
    const secretCanary = "secret-canary-must-never-appear";
    const records: StructuredLogRecord[] = [];
    const logger = createLogger((record) => records.push(record));

    logger.error(
      "database.connection_failed",
      {
        databaseUrl: secretCanary,
        nested: {
          authorization: secretCanary,
          apiKey: secretCanary,
          encryptionKey: secretCanary,
          keyring: secretCanary,
          session: secretCanary,
          safeCode: "database_unavailable",
        },
        candidates: [{ email: secretCanary }],
        error: new Error(secretCanary),
      },
      "0196f82d-3fb4-7f1a-8c9d-123456789abc",
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "error",
      event: "database.connection_failed",
      correlationId: "0196f82d-3fb4-7f1a-8c9d-123456789abc",
      metadata: {
        databaseUrl: "[REDACTED]",
        nested: {
          authorization: "[REDACTED]",
          apiKey: "[REDACTED]",
          encryptionKey: "[REDACTED]",
          keyring: "[REDACTED]",
          session: "[REDACTED]",
          safeCode: "database_unavailable",
        },
        candidates: [{ email: "[REDACTED]" }],
        error: { name: "Error", message: "Internal error" },
      },
    });
    expect(JSON.stringify(records[0])).not.toContain(secretCanary);
    expect(Number.isNaN(Date.parse(records[0]!.timestamp))).toBe(false);
  });

  it("sanitizes invalid event names and truncates oversized safe strings", () => {
    const records: StructuredLogRecord[] = [];
    const logger = createLogger((record) => records.push(record));

    logger.info("invalid event with spaces", { safe: "x".repeat(501) });

    expect(records[0]?.event).toBe("invalid_event_name");
    expect(
      (records[0]?.metadata as { safe: string }).safe,
    ).toHaveLength(501);
    expect((records[0]?.metadata as { safe: string }).safe.endsWith("…")).toBe(
      true,
    );
  });

  it("does not mutate the caller's metadata", () => {
    const metadata = {
      password: "caller-value",
      nested: { safe: "kept" },
    };

    const redacted = redactLogValue(metadata);

    expect(redacted).toEqual({
      password: "[REDACTED]",
      nested: { safe: "kept" },
    });
    expect(metadata.password).toBe("caller-value");
  });

  it("keeps BigInt and cyclic metadata serializable", () => {
    const cyclic: {
      count: bigint;
      connectionString: string;
      self?: unknown;
    } = {
      count: 42n,
      connectionString: "postgresql://user:secret@database.example/app",
    };
    cyclic.self = cyclic;

    const redacted = redactLogValue(cyclic);

    expect(redacted).toEqual({
      count: "42",
      connectionString: "[REDACTED]",
      self: "[Circular]",
    });
    expect(() => JSON.stringify(redacted)).not.toThrow();
  });
});
