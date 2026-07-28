import { describe, expect, it } from "vitest";

import {
  createDeterministicDomainChallengeProvider,
  createDeterministicRegisterProvider,
} from "@/lib/providers/company-verification/deterministic-sandbox";
import {
  normalizeCompanyName,
  normalizeDomainChallengeInput,
  normalizeRegisterCheckInput,
  providerDigest,
} from "@/lib/providers/company-verification/provider-contract";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const FIXTURE = Object.freeze({
  uid: "CHE-111.000.001",
  legalName: "NovaRigi Digital AG",
  cantonCode: "ZH",
  providerReference: "sandbox-register:nova-rigi:v1",
});

describe("Phase 26 company verification provider contract", () => {
  it("normalizes canonical Swiss register input without accepting extra fields", () => {
    expect(
      normalizeRegisterCheckInput({
        uid: " che-111.000.001 ",
        legalName: "  NovaRigi Dìgital AG  ",
        cantonCode: " zh ",
        requestKey: "request:1",
      }),
    ).toEqual({
      uid: "CHE-111.000.001",
      legalName: "novarigi digital ag",
      cantonCode: "ZH",
      requestKey: "request:1",
    });
    expect(normalizeCompanyName("Ärzte & Pflege GmbH")).toBe(
      "arzte pflege gmbh",
    );
    expect(
      normalizeRegisterCheckInput({
        uid: "CHE-111",
        legalName: "NovaRigi Digital AG",
        cantonCode: "ZH",
        requestKey: "request:1",
      }),
    ).toBeNull();
  });

  it.each([
    [
      "exact",
      {
        uid: FIXTURE.uid,
        legalName: "NovaRigi Digital AG",
        cantonCode: "ZH",
        requestKey: "request:exact",
      },
      "EXACT_MATCH",
    ],
    [
      "similar name",
      {
        uid: FIXTURE.uid,
        legalName: "NovaRigi Digitale AG",
        cantonCode: "ZH",
        requestKey: "request:name",
      },
      "MISMATCH",
    ],
    [
      "wrong canton",
      {
        uid: FIXTURE.uid,
        legalName: "NovaRigi Digital AG",
        cantonCode: "BE",
        requestKey: "request:canton",
      },
      "MISMATCH",
    ],
    [
      "unknown UID",
      {
        uid: "CHE-999.999.999",
        legalName: "NovaRigi Digital AG",
        cantonCode: "ZH",
        requestKey: "request:missing",
      },
      "NOT_FOUND",
    ],
  ] as const)("returns a typed %s register result", async (_label, input, result) => {
    const provider = createDeterministicRegisterProvider([FIXTURE], () => NOW);
    const checked = await provider.check(input);
    expect(checked.result).toBe(result);
    expect(checked.checkedAt).toEqual(NOW);
    expect(checked.requestDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(checked.responseDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(checked)).not.toContain(FIXTURE.providerReference);
    if (result === "EXACT_MATCH") {
      expect(checked.providerReferenceDigest).toBe(
        providerDigest(FIXTURE.providerReference),
      );
    }
  });

  it("binds the domain challenge to domain, secret, proof and request key", async () => {
    const provider = createDeterministicDomainChallengeProvider(() => NOW);
    const challengeToken = "s".repeat(32);
    const exact = await provider.check({
      domain: "verify.example.test",
      challengeToken,
      presentedProof: `sth-domain-verification=${challengeToken}`,
      requestKey: "domain:exact",
    });
    expect(exact).toMatchObject({
      result: "EXACT_MATCH",
      domainMatched: true,
      retryable: false,
      failureCode: null,
    });

    const mismatch = await provider.check({
      domain: "changed.example.test",
      challengeToken,
      presentedProof: `sth-domain-verification=${"x".repeat(32)}`,
      requestKey: "domain:mismatch",
    });
    expect(mismatch).toMatchObject({
      result: "MISMATCH",
      domainMatched: false,
      failureCode: "DOMAIN_PROOF_MISMATCH",
    });
    expect(mismatch.requestDigest).not.toBe(exact.requestDigest);
  });

  it("rejects malformed domains/secrets before any match can be produced", async () => {
    expect(
      normalizeDomainChallengeInput({
        domain: "https://example.test/path",
        challengeToken: "s".repeat(32),
        presentedProof: "p".repeat(32),
        requestKey: "domain:malformed",
      }),
    ).toBeNull();
    const result = await createDeterministicDomainChallengeProvider(() => NOW).check(
      {
        domain: "not-a-domain",
        challengeToken: "short",
        presentedProof: "short",
        requestKey: "domain:bad",
      },
    );
    expect(result).toMatchObject({
      result: "MALFORMED",
      domainMatched: null,
      failureCode: "CHALLENGE_INPUT_MALFORMED",
    });
  });

  it("produces stable order-independent object digests without raw payload output", () => {
    expect(providerDigest({ b: 2, a: 1 })).toBe(
      providerDigest({ a: 1, b: 2 }),
    );
    expect(providerDigest({ secret: "private" })).not.toContain("private");
    expect(providerDigest({ secret: "private" })).toMatch(/^[a-f0-9]{64}$/u);
  });
});
