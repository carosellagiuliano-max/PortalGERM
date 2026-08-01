// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveRegistrationLegalGate } from "@/lib/auth/registration-legal-gate";

const NOW = new Date("2026-08-01T12:00:00.000Z");
const TERMS_ID = "11111111-1111-4111-8111-111111111111";
const PRIVACY_ID = "22222222-2222-4222-8222-222222222222";

describe("registration legal publication gate", () => {
  it("keeps the synthetic Local/CI demo available without claiming a publication", async () => {
    const findMany = vi.fn();

    await expect(
      resolveRegistrationLegalGate(
        { APP_ENV: "local" } as never,
        { legalPublication: { findMany } } as never,
        NOW,
      ),
    ).resolves.toEqual({
      allowed: true,
      mode: "LOCAL_SYNTHETIC",
      binding: null,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects public registration before any query when either feature gate is off", async () => {
    const findMany = vi.fn();

    await expect(
      resolveRegistrationLegalGate(
        {
          APP_ENV: "preview",
          LEGAL_PUBLICATION_TERMS: true,
          LEGAL_PUBLICATION_PRIVACY: false,
        } as never,
        { legalPublication: { findMany } } as never,
        NOW,
      ),
    ).resolves.toEqual({
      allowed: false,
      mode: "PUBLISHED_LEGAL",
      code: "PUBLICATION_UNAVAILABLE",
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("binds public registration to the exact current Terms and Privacy hashes", async () => {
    const findMany = vi.fn().mockResolvedValue([
      publication(TERMS_ID, "terms", "TERMS", "terms-2026-08", "a"),
      publication(PRIVACY_ID, "privacy", "PRIVACY", "privacy-2026-08", "b"),
    ]);

    await expect(
      resolveRegistrationLegalGate(
        publicEnvironment(),
        { legalPublication: { findMany } } as never,
        NOW,
      ),
    ).resolves.toEqual({
      allowed: true,
      mode: "PUBLISHED_LEGAL",
      binding: {
        policyVersion: "registration-publication-v1",
        terms: {
          publicationId: TERMS_ID,
          publicationHash: "a".repeat(64),
          versionLabel: "terms-2026-08",
        },
        privacy: {
          publicationId: PRIVACY_ID,
          publicationHash: "b".repeat(64),
          versionLabel: "privacy-2026-08",
        },
      },
    });
  });

  it("fails closed on missing, mismatched or unavailable publication data", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        publication(TERMS_ID, "terms", "TERMS", "terms-2026-08", "a"),
      ])
      .mockResolvedValueOnce([
        publication(TERMS_ID, "terms", "TERMS", "terms-2026-08", "a"),
        {
          ...publication(
            PRIVACY_ID,
            "privacy",
            "PRIVACY",
            "privacy-2026-08",
            "b",
          ),
          publicationHash: "c".repeat(64),
        },
      ])
      .mockRejectedValueOnce(new Error("database unavailable"));
    const database = { legalPublication: { findMany } } as never;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        resolveRegistrationLegalGate(publicEnvironment(), database, NOW),
      ).resolves.toMatchObject({
        allowed: false,
        code: "PUBLICATION_UNAVAILABLE",
      });
    }
  });
});

function publicEnvironment() {
  return {
    APP_ENV: "preview",
    LEGAL_PUBLICATION_TERMS: true,
    LEGAL_PUBLICATION_PRIVACY: true,
  } as never;
}

function publication(
  id: string,
  slug: "terms" | "privacy",
  type: "TERMS" | "PRIVACY",
  versionLabel: string,
  hashSeed: string,
) {
  const contentHash = hashSeed.repeat(64);
  return {
    id,
    publicationHash: contentHash,
    legalDocument: { type, locale: "de-CH", slug },
    legalRevision: { versionLabel, contentHash },
  };
}
