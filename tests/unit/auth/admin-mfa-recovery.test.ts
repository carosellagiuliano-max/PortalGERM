import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createRecoveryCodes,
  hashRecoveryCodeForLookup,
  TOTP_POLICY_V1,
  verifyTotp,
} from "@/lib/auth/assurance/totp";

const SESSION_SECRET = "phase25-unit-session-secret-with-at-least-32-characters";

describe("Phase 25 admin MFA and recovery policy", () => {
  it("creates only opaque, unique lookup hashes for single-use recovery codes", () => {
    const codes = createRecoveryCodes(SESSION_SECRET);
    expect(codes).toHaveLength(TOTP_POLICY_V1.recoveryCodeCount);
    expect(new Set(codes.map(({ raw }) => raw)).size).toBe(codes.length);
    expect(new Set(codes.map(({ hash }) => hash)).size).toBe(codes.length);
    for (const code of codes) {
      expect(code.raw).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/u);
      expect(code.hash).toMatch(/^[a-f0-9]{64}$/u);
      expect(code.hash).toBe(
        hashRecoveryCodeForLookup(code.raw.toLowerCase(), SESSION_SECRET),
      );
      expect(code.hash).not.toContain(code.raw.replaceAll("-", ""));
    }
  });

  it("accepts a TOTP step once and rejects replay of the accepted step", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    const now = new Date("2026-07-28T12:00:00.000Z");
    const step = BigInt(
      Math.floor(now.getTime() / 1_000 / TOTP_POLICY_V1.periodSeconds),
    );
    const code = totp(secret, step);
    const first = verifyTotp(code, secret, now, null);
    expect(first).toEqual({ valid: true, acceptedStep: step });
    expect(verifyTotp(code, secret, now, step)).toEqual({
      valid: false,
      acceptedStep: null,
    });
  });

  it("rejects malformed recovery and TOTP material", () => {
    expect(() =>
      hashRecoveryCodeForLookup("not-a-code", SESSION_SECRET),
    ).toThrow();
    expect(
      verifyTotp(
        "12345",
        Buffer.from("12345678901234567890", "ascii"),
        new Date("2026-07-28T12:00:00.000Z"),
        null,
      ),
    ).toEqual({ valid: false, acceptedStep: null });
  });
});

function totp(secret: Buffer, step: bigint): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
