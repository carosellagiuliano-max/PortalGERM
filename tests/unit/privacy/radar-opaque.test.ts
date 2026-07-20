// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildRadarOpaqueLookup,
  decryptRadarOpaqueToken,
  encryptRadarOpaqueToken,
  RADAR_OPAQUE_POLICY_V1,
  type RadarOpaqueBinding,
  type RadarOpaqueEnvelope,
  type RadarOpaqueKey,
} from "@/lib/privacy/radar-opaque";

const lookupKey: RadarOpaqueKey = {
  version: "lookup-2026-07",
  secret: Buffer.alloc(32, 11).toString("base64"),
};
const encryptionKey: RadarOpaqueKey = {
  version: "opaque-2026-07",
  secret: Buffer.alloc(32, 12).toString("base64"),
};
const binding: RadarOpaqueBinding = {
  mappingId: "11111111-1111-4111-8111-111111111111",
  candidateProfileId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  epoch: new Date("2026-07-20T00:00:00.000Z"),
};

describe("Radar opaque token envelope", () => {
  it("encrypts a fresh canonical 128-bit token and exposes a keyed scoped lookup", () => {
    const created = encryptRadarOpaqueToken(
      [lookupKey],
      [encryptionKey],
      binding,
    );

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(created.token, "base64url")).toHaveLength(
      RADAR_OPAQUE_POLICY_V1.tokenBytes,
    );
    expect(Buffer.from(created.token, "base64url").toString("base64url")).toBe(
      created.token,
    );
    expect(created.envelope.nonce).toHaveLength(12);
    expect(created.envelope.authTag).toHaveLength(16);
    expect(created.envelope.lookupHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(created.envelope.encryptedToken).toString("utf8")).not.toBe(
      created.token,
    );
    expect(
      decryptRadarOpaqueToken(
        created.envelope,
        [lookupKey],
        [encryptionKey],
        binding,
      ),
    ).toBe(created.token);
    expect(buildRadarOpaqueLookup(created.token, [lookupKey], binding)).toEqual({
      lookupHmac: created.envelope.lookupHmac,
      lookupKeyVersion: lookupKey.version,
    });

    const differentKey = {
      version: lookupKey.version,
      secret: Buffer.alloc(32, 13).toString("base64"),
    };
    expect(
      buildRadarOpaqueLookup(created.token, [differentKey], binding).lookupHmac,
    ).not.toBe(created.envelope.lookupHmac);
    expect(
      buildRadarOpaqueLookup(created.token, [lookupKey], {
        ...binding,
        epoch: new Date("2026-08-19T00:00:00.000Z"),
      }).lookupHmac,
    ).not.toBe(created.envelope.lookupHmac);
  });

  it("uses independent random tokens and nonces", () => {
    const first = encryptRadarOpaqueToken([lookupKey], [encryptionKey], binding);
    const second = encryptRadarOpaqueToken([lookupKey], [encryptionKey], binding);

    expect(second.token).not.toBe(first.token);
    expect(Buffer.from(second.envelope.nonce)).not.toEqual(
      Buffer.from(first.envelope.nonce),
    );
    expect(second.envelope.lookupHmac).not.toBe(first.envelope.lookupHmac);
  });

  it("fails closed for envelope, key and AAD-binding tampering", () => {
    const { envelope } = encryptRadarOpaqueToken(
      [lookupKey],
      [encryptionKey],
      binding,
    );
    const alteredCiphertext = Uint8Array.from(envelope.encryptedToken);
    alteredCiphertext[0] = (alteredCiphertext[0] ?? 0) ^ 1;
    const alteredEnvelope: RadarOpaqueEnvelope = {
      ...envelope,
      encryptedToken: alteredCiphertext,
    };

    expect(() =>
      decryptRadarOpaqueToken(
        alteredEnvelope,
        [lookupKey],
        [encryptionKey],
        binding,
      ),
    ).toThrow("Radar opaque token is unavailable.");
    expect(() =>
      decryptRadarOpaqueToken(
        envelope,
        [lookupKey],
        [
          {
            ...encryptionKey,
            secret: Buffer.alloc(32, 14).toString("base64"),
          },
        ],
        binding,
      ),
    ).toThrow("Radar opaque token is unavailable.");
    expect(() =>
      decryptRadarOpaqueToken(envelope, [lookupKey], [encryptionKey], {
        ...binding,
        candidateProfileId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toThrow("Radar opaque token is unavailable.");
  });
});
