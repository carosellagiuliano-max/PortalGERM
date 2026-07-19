import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  hashIp,
  hashIpWithFirstKey,
  normalizeIpAddress,
} from "@/lib/utils/hash";

describe("IP privacy hashing", () => {
  it.each([
    ["192.0.2.42", "192.0.2.42"],
    ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8:0:0:0:0:0:1"],
    ["2001:db8::1", "2001:db8:0:0:0:0:0:1"],
    ["::ffff:192.0.2.128", "0:0:0:0:0:ffff:c000:280"],
  ])("normalizes %s", (value, expected) => {
    expect(normalizeIpAddress(value)).toBe(expected);
  });

  it("returns a versioned HMAC and makes equivalent IPv6 forms identical", () => {
    const key = { version: "2026-07", secret: "dedicated-secret" } as const;
    const normalized = "2001:db8:0:0:0:0:0:1";
    const expected = createHmac("sha256", key.secret)
      .update(normalized)
      .digest("hex");

    expect(hashIp("2001:db8::1", key)).toBe(`${key.version}:${expected}`);
    expect(hashIp("2001:0db8:0:0:0:0:0:1", key)).toBe(
      hashIp("2001:db8::1", key),
    );
  });

  it("rejects non-literals and invalid key metadata", () => {
    expect(() => normalizeIpAddress("example.com")).toThrow(TypeError);
    expect(() => hashIp("127.0.0.1", { version: "bad version", secret: "x" })).toThrow(
      TypeError,
    );
    expect(() => hashIp("127.0.0.1", { version: "v1", secret: "" })).toThrow(
      TypeError,
    );
  });

  it("uses only the first keyring entry and fails closed without one", () => {
    const keyring = [
      {
        version: "writer-v2",
        key: { withValue: <T>(consumer: (secret: string) => T) => consumer("new") },
      },
      {
        version: "reader-v1",
        key: { withValue: <T>(consumer: (secret: string) => T) => consumer("old") },
      },
    ] as const;

    expect(hashIpWithFirstKey("192.0.2.42", keyring, "TEST_KEYS")).toBe(
      hashIp("192.0.2.42", { version: "writer-v2", secret: "new" }),
    );
    expect(() => hashIpWithFirstKey("192.0.2.42", [], "TEST_KEYS")).toThrow(
      "TEST_KEYS requires an active writer key",
    );
  });
});
