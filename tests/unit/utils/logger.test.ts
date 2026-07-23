import {
  createLogger,
  redactLogValue,
  type StructuredLogRecord,
} from "@/lib/utils/logger";
import { describe, expect, it } from "vitest";

describe("structured logger", () => {
  it("keeps only allowlisted fields and redacts Error details", () => {
    const secretCanary = "secret-canary-must-never-appear";
    const records: StructuredLogRecord[] = [];
    const logger = createLogger((record) => records.push(record));

    logger.error(
      "database.connection_failed",
      {
        databaseUrl: secretCanary,
        routeTemplate: "/health/ready",
        method: "GET",
        errorCode: "DATABASE_UNAVAILABLE",
        error: new Error(secretCanary),
      },
      "0196f82d-3fb4-7f1a-8c9d-123456789abc",
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "error",
      event: "database.connection_failed",
      environment: expect.stringMatching(
        /^(?:local|ci|preview|staging|production|development|test|unknown)$/u,
      ),
      correlationId: "0196f82d-3fb4-7f1a-8c9d-123456789abc",
      metadata: {
        routeTemplate: "/health/ready",
        method: "GET",
        errorCode: "DATABASE_UNAVAILABLE",
        error: { name: "Error", message: "Internal error" },
      },
    });
    expect(JSON.stringify(records[0])).not.toContain(secretCanary);
    expect(Number.isNaN(Date.parse(records[0]!.timestamp))).toBe(false);
  });

  it("sanitizes invalid event names and drops unknown metadata", () => {
    const records: StructuredLogRecord[] = [];
    const logger = createLogger((record) => records.push(record));

    logger.info("invalid event with spaces", { safe: "x".repeat(501) });

    expect(records[0]?.event).toBe("invalid_event_name");
    expect(records[0]?.metadata).toEqual({});
  });

  it("redacts secret, email and IP canaries even under allowlisted keys", () => {
    const records: StructuredLogRecord[] = [];
    const logger = createLogger((record) => records.push(record));

    logger.warn("security.denied", {
      reasonCode: "secret-canary",
      entityId: "203.0.113.25",
      errorReference: "person@example.test",
      routeTemplate: "/candidate/messages/[threadId]",
    });

    expect(records[0]?.metadata).toEqual({
      reasonCode: "[REDACTED]",
      entityId: "[REDACTED]",
      errorReference: "[REDACTED]",
      routeTemplate: "/candidate/messages/[threadId]",
    });
    expect(JSON.stringify(records[0])).not.toContain("secret-canary");
    expect(JSON.stringify(records[0])).not.toContain("203.0.113.25");
    expect(JSON.stringify(records[0])).not.toContain("person@example.test");
  });

  it("allows framework route templates but rejects resolved dynamic URLs", () => {
    const records: StructuredLogRecord[] = [];
    const logger = createLogger((record) => records.push(record));

    logger.error("request_failed", {
      routePath: "/invite/[token]",
      routeTemplate: "/files/[[...pathParts]]",
    });
    logger.error("request_failed", {
      routePath: "/support/raw-case-id-canary",
      routeTemplate: "/files/private/customer-case",
    });

    expect(records[0]?.metadata).toEqual({
      routePath: "/invite/[token]",
      routeTemplate: "/files/[[...pathParts]]",
    });
    expect(records[1]?.metadata).toEqual({
      routePath: "[REDACTED]",
      routeTemplate: "[REDACTED]",
    });
    expect(JSON.stringify(records[1])).not.toContain("raw-case-id-canary");
    expect(JSON.stringify(records[1])).not.toContain("customer-case");
  });

  it("only includes validated UUID correlation IDs", () => {
    const records: StructuredLogRecord[] = [];
    const logger = createLogger((record) => records.push(record));

    logger.info(
      "request_started",
      undefined,
      "0196F82D-3FB4-7F1A-8C9D-123456789ABC",
    );
    logger.info("request_started", undefined, "private-correlation-canary");

    expect(records[0]?.correlationId).toBe(
      "0196f82d-3fb4-7f1a-8c9d-123456789abc",
    );
    expect(records[1]).not.toHaveProperty("correlationId");
    expect(JSON.stringify(records[1])).not.toContain(
      "private-correlation-canary",
    );
  });

  it("does not serialize attacker-controlled Error names", () => {
    const records: StructuredLogRecord[] = [];
    const logger = createLogger((record) => records.push(record));
    const error = new Error("private message");
    error.name = "PrivateCustomerCanaryError";

    logger.error("request_failed", { error });
    const redacted = redactLogValue(error);

    expect(records[0]?.metadata).toEqual({
      error: { name: "Error", message: "Internal error" },
    });
    expect(redacted).toEqual({
      name: "Error",
      message: "Internal error",
    });
    expect(JSON.stringify(records[0])).not.toContain(
      "PrivateCustomerCanaryError",
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

  it("truncates oversized strings in the generic redaction helper", () => {
    const redacted = redactLogValue({ safe: "x".repeat(501) }) as {
      safe: string;
    };

    expect(redacted.safe).toHaveLength(501);
    expect(redacted.safe.endsWith("…")).toBe(true);
  });
});
