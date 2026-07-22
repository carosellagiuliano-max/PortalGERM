// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { RadarOpaqueKey } from "@/lib/privacy/radar-opaque";
import {
  buildRadarOpaqueLookupCandidates,
  buildRadarOpaqueRevocation,
  getRadarOpaqueEpoch,
  isCurrentRadarOpaqueMapping,
  mintRadarOpaqueIdForAuthorizedDto,
  remintRadarOpaqueIdAfterReoptIn,
  resolveRadarOpaqueId,
  type RadarOpaqueMappingRecord,
  type RadarOpaqueResolutionRepository,
} from "@/lib/talentradar/opaque-id";

const candidateProfileId = "11111111-1111-4111-8111-111111111111";
const firstCompanyId = "22222222-2222-4222-8222-222222222222";
const secondCompanyId = "33333333-3333-4333-8333-333333333333";
const mappingId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-07-22T10:00:00.000Z");

const oldLookupKey: RadarOpaqueKey = {
  version: "lookup-old",
  secret: Buffer.alloc(32, 21).toString("base64"),
};
const currentLookupKey: RadarOpaqueKey = {
  version: "lookup-current",
  secret: Buffer.alloc(32, 22).toString("base64"),
};
const oldEncryptionKey: RadarOpaqueKey = {
  version: "encryption-old",
  secret: Buffer.alloc(32, 23).toString("base64"),
};
const currentEncryptionKey: RadarOpaqueKey = {
  version: "encryption-current",
  secret: Buffer.alloc(32, 24).toString("base64"),
};

function repository(
  records: readonly RadarOpaqueMappingRecord[],
): RadarOpaqueResolutionRepository {
  return {
    findByScopedLookups: vi.fn(async () => records),
  };
}

describe("Radar opaque 30-calendar-day epochs", () => {
  it("anchors epoch zero at Zurich midnight and has an exact no-overlap boundary", () => {
    const first = getRadarOpaqueEpoch(new Date("2025-12-31T23:00:00.000Z"));
    expect(first).toMatchObject({ index: 0 });
    expect(first.epoch.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(first.validFrom.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(first.validTo.toISOString()).toBe("2026-01-30T23:00:00.000Z");

    const lastMillisecond = getRadarOpaqueEpoch(
      new Date(first.validTo.getTime() - 1),
    );
    const next = getRadarOpaqueEpoch(first.validTo);
    expect(lastMillisecond.index).toBe(0);
    expect(next.index).toBe(1);
    expect(next.validFrom.getTime()).toBe(first.validTo.getTime());
    expect(next.epoch.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("uses calendar days across Zurich daylight-saving changes", () => {
    const springEpoch = getRadarOpaqueEpoch(
      new Date("2026-03-10T12:00:00.000Z"),
    );
    const next = getRadarOpaqueEpoch(springEpoch.validTo);
    expect(springEpoch.index).toBe(2);
    expect(springEpoch.epoch.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(springEpoch.validFrom.toISOString()).toBe("2026-03-01T23:00:00.000Z");
    expect(springEpoch.validTo.toISOString()).toBe("2026-03-31T22:00:00.000Z");
    expect(
      (springEpoch.validTo.getTime() - springEpoch.validFrom.getTime()) /
        3_600_000,
    ).toBe(719);
    expect(next.validFrom.getTime()).toBe(springEpoch.validTo.getTime());
  });

  it("rejects instants before the platform anchor", () => {
    expect(() =>
      getRadarOpaqueEpoch(new Date("2025-12-31T22:59:59.999Z")),
    ).toThrow("Radar opaque epochs start");
  });
});

describe("Radar opaque mapping lifecycle", () => {
  it("mints independent 128-bit company-scoped values without persisting raw tokens", () => {
    const first = mintRadarOpaqueIdForAuthorizedDto({
      mappingId,
      candidateProfileId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    const second = mintRadarOpaqueIdForAuthorizedDto({
      mappingId: "55555555-5555-4555-8555-555555555555",
      candidateProfileId,
      companyId: secondCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });

    expect(first.opaqueId).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(second.opaqueId).not.toBe(first.opaqueId);
    expect(first.mapping.lookupHmac).not.toBe(second.mapping.lookupHmac);
    expect(
      buildRadarOpaqueLookupCandidates(
        first.opaqueId,
        secondCompanyId,
        first.mapping.epoch,
        [currentLookupKey],
      )[0]?.lookupHmac,
    ).not.toBe(first.mapping.lookupHmac);
    expect(JSON.stringify(first.mapping)).not.toContain(first.opaqueId);
    expect(first.mapping.validFrom).toEqual(now);
    expect(first.mapping.validTo.getTime()).toBeGreaterThan(now.getTime());
  });

  it("resolves old HMAC/encryption versions after rotation and mints with writers", async () => {
    const old = mintRadarOpaqueIdForAuthorizedDto({
      mappingId,
      candidateProfileId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [oldLookupKey],
      encryptionKeyring: [oldEncryptionKey],
    });
    const lookupCandidates = buildRadarOpaqueLookupCandidates(
      old.opaqueId,
      firstCompanyId,
      old.mapping.epoch,
      [currentLookupKey, oldLookupKey],
    );
    expect(lookupCandidates.map(({ lookupKeyVersion }) => lookupKeyVersion)).toEqual([
      "lookup-current",
      "lookup-old",
    ]);

    await expect(
      resolveRadarOpaqueId(
        {
          opaqueId: old.opaqueId,
          companyId: firstCompanyId,
          now,
          lookupKeyring: [currentLookupKey, oldLookupKey],
          encryptionKeyring: [currentEncryptionKey, oldEncryptionKey],
        },
        repository([old.mapping]),
      ),
    ).resolves.toEqual({
      ok: true,
      mappingId,
      candidateProfileId,
      validTo: old.mapping.validTo,
    });

    const current = mintRadarOpaqueIdForAuthorizedDto({
      candidateProfileId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey, oldLookupKey],
      encryptionKeyring: [currentEncryptionKey, oldEncryptionKey],
    });
    expect(current.mapping.lookupKeyVersion).toBe("lookup-current");
    expect(current.mapping.encryptionKeyVersion).toBe("encryption-current");
  });

  it("collapses malformed, revoked, expired, cross-company and ambiguous results", async () => {
    const issued = mintRadarOpaqueIdForAuthorizedDto({
      mappingId,
      candidateProfileId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    const baseInput = {
      opaqueId: issued.opaqueId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    } as const;
    const expected = { ok: false, code: "NOT_FOUND" };

    await expect(
      resolveRadarOpaqueId(
        { ...baseInput, opaqueId: "not-a-token" },
        repository([issued.mapping]),
      ),
    ).resolves.toEqual(expected);
    await expect(
      resolveRadarOpaqueId(
        baseInput,
        repository([{ ...issued.mapping, revokedAt: new Date(now) }]),
      ),
    ).resolves.toEqual(expected);
    await expect(
      resolveRadarOpaqueId(
        baseInput,
        repository([{ ...issued.mapping, validTo: new Date(now) }]),
      ),
    ).resolves.toEqual(expected);
    await expect(
      resolveRadarOpaqueId(
        baseInput,
        repository([{ ...issued.mapping, companyId: secondCompanyId }]),
      ),
    ).resolves.toEqual(expected);
    await expect(
      resolveRadarOpaqueId(baseInput, repository([issued.mapping, issued.mapping])),
    ).resolves.toEqual(expected);
    await expect(
      resolveRadarOpaqueId(
        { ...baseInput, companyId: secondCompanyId },
        repository([issued.mapping]),
      ),
    ).resolves.toEqual(expected);
  });

  it("does not collapse repository outages into token NOT_FOUND", async () => {
    const issued = mintRadarOpaqueIdForAuthorizedDto({
      mappingId,
      candidateProfileId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    const outage = new Error("database-unavailable");
    await expect(
      resolveRadarOpaqueId(
        {
          opaqueId: issued.opaqueId,
          companyId: firstCompanyId,
          now,
          lookupKeyring: [currentLookupKey],
          encryptionKeyring: [currentEncryptionKey],
        },
        {
          findByScopedLookups: vi.fn(async () => {
            throw outage;
          }),
        },
      ),
    ).rejects.toBe(outage);
  });

  it("fails closed for ciphertext, binding and removed-key tampering", async () => {
    const issued = mintRadarOpaqueIdForAuthorizedDto({
      mappingId,
      candidateProfileId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    const ciphertext = Uint8Array.from(issued.mapping.encryptedToken);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    const input = {
      opaqueId: issued.opaqueId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    } as const;

    await expect(
      resolveRadarOpaqueId(
        input,
        repository([{ ...issued.mapping, encryptedToken: ciphertext }]),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      resolveRadarOpaqueId(
        input,
        repository([
          {
            ...issued.mapping,
            candidateProfileId: "66666666-6666-4666-8666-666666666666",
          },
        ]),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      resolveRadarOpaqueId(
        { ...input, encryptionKeyring: [oldEncryptionKey] },
        repository([issued.mapping]),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("revokes with a closed reason and remints a fresh value after re-opt-in", () => {
    const initial = mintRadarOpaqueIdForAuthorizedDto({
      mappingId,
      candidateProfileId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    const revocation = buildRadarOpaqueRevocation("CANDIDATE_OPTED_OUT", now);
    expect(revocation).toEqual({
      revokedAt: now,
      revocationReason: "CANDIDATE_OPTED_OUT",
    });
    expect(
      isCurrentRadarOpaqueMapping(
        { ...initial.mapping, ...revocation },
        firstCompanyId,
        now,
      ),
    ).toBe(false);

    const reminted = remintRadarOpaqueIdAfterReoptIn({
      previous: {
        ...initial.mapping,
        revokedAt: revocation.revokedAt,
      },
      now: new Date(now.getTime() + 1),
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    expect(reminted.persistenceMode).toBe("REPLACE_REVOKED");
    expect(reminted.mapping.id).toBe(mappingId);
    expect(reminted.opaqueId).not.toBe(initial.opaqueId);
    expect(reminted.mapping.lookupHmac).not.toBe(initial.mapping.lookupHmac);
    expect(reminted.mapping.revokedAt).toBeNull();
  });

  it("creates a new mapping row when re-opt-in happens in a later epoch", () => {
    const previousEpoch = getRadarOpaqueEpoch(now);
    const reminted = remintRadarOpaqueIdAfterReoptIn({
      previous: {
        id: mappingId,
        candidateProfileId,
        companyId: firstCompanyId,
        epoch: previousEpoch.epoch,
        revokedAt: now,
      },
      now: previousEpoch.validTo,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    expect(reminted.persistenceMode).toBe("CREATE");
    expect(reminted.mapping.id).not.toBe(mappingId);
    expect(reminted.mapping.epoch.getTime()).not.toBe(previousEpoch.epoch.getTime());
  });

  it("makes the pre-opt-out token unresolvable after same-epoch replacement", async () => {
    const initial = mintRadarOpaqueIdForAuthorizedDto({
      mappingId,
      candidateProfileId,
      companyId: firstCompanyId,
      now,
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    const reminted = remintRadarOpaqueIdAfterReoptIn({
      previous: {
        ...initial.mapping,
        revokedAt: new Date(now),
      },
      now: new Date(now.getTime() + 1),
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    });
    const base = {
      companyId: firstCompanyId,
      now: new Date(now.getTime() + 1),
      lookupKeyring: [currentLookupKey],
      encryptionKeyring: [currentEncryptionKey],
    } as const;

    await expect(
      resolveRadarOpaqueId(
        { ...base, opaqueId: initial.opaqueId },
        repository([reminted.mapping]),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      resolveRadarOpaqueId(
        { ...base, opaqueId: reminted.opaqueId },
        repository([reminted.mapping]),
      ),
    ).resolves.toMatchObject({ ok: true, mappingId });
  });
});
