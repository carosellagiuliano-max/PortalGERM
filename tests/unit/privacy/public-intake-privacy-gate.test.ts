// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  lockPublicIntakePrivacyGate,
  preflightPublicIntakePrivacyGate,
  readPublicIntakePrivacyExpectedBinding,
  resolvePublicIntakePrivacyGate,
  toPublicIntakePrivacyExpectedBinding,
} from "@/lib/privacy/public-intake-privacy-gate";
import { localPublicIntakePrivacyBinding } from "@/tests/fixtures/public-intake-privacy";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const PUBLICATION_ID = "34070000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const PREVIEW_ENVIRONMENT = Object.freeze({
  APP_ENV: "preview" as const,
  LEGAL_PUBLICATION_PRIVACY: true,
});

describe("public intake privacy gate", () => {
  it("uses explicit synthetic evidence only in local/CI without reading legal rows", async () => {
    const findMany = vi.fn();

    const decision = await resolvePublicIntakePrivacyGate("ABUSE_REPORT", {
      database: { legalPublication: { findMany } } as never,
      environment: {
        APP_ENV: "local",
        LEGAL_PUBLICATION_PRIVACY: false,
      },
      now: NOW,
    });

    expect(decision).toMatchObject({
      allowed: true,
      binding: localPublicIntakePrivacyBinding("ABUSE_REPORT"),
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("fails closed in deployed environments unless one non-revoked exact publication exists", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const database = { legalPublication: { findMany } } as never;

    await expect(
      resolvePublicIntakePrivacyGate("EMPLOYER_DEMO", {
        database,
        environment: PREVIEW_ENVIRONMENT,
        now: NOW,
      }),
    ).resolves.toEqual({
      allowed: false,
      code: "PUBLICATION_UNAVAILABLE",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "CURRENT",
          revokedAt: null,
          effectiveAt: { lte: NOW },
        }),
        take: 2,
      }),
    );

    findMany.mockResolvedValueOnce([publication(), publication()]);
    await expect(
      resolvePublicIntakePrivacyGate("EMPLOYER_DEMO", {
        database,
        environment: PREVIEW_ENVIRONMENT,
        now: NOW,
      }),
    ).resolves.toEqual({
      allowed: false,
      code: "PUBLICATION_UNAVAILABLE",
    });
  });

  it("binds the exact approved de-CH privacy publication and rejects a stale hash", async () => {
    const database = {
      legalPublication: { findMany: vi.fn().mockResolvedValue([publication()]) },
    } as never;
    const current = await resolvePublicIntakePrivacyGate("ABUSE_REPORT", {
      database,
      environment: PREVIEW_ENVIRONMENT,
      now: NOW,
    });
    expect(current).toMatchObject({
      allowed: true,
      binding: {
        evidenceMode: "PUBLISHED_LEGAL",
        legalPublicationId: PUBLICATION_ID,
        publicationHash: HASH,
        publicationVersion: "2026-08",
      },
    });
    if (!current.allowed) throw new Error("Expected legal publication binding.");

    await expect(
      preflightPublicIntakePrivacyGate(
        {
          ...toPublicIntakePrivacyExpectedBinding(current.binding),
          publicationHash: "b".repeat(64),
        },
        { database, environment: PREVIEW_ENVIRONMENT, now: NOW },
      ),
    ).resolves.toEqual({
      allowed: false,
      code: "STALE_OR_TAMPERED_BINDING",
    });
  });

  it("revalidates the non-revoked publication under a row lock", async () => {
    const transaction = {
      legalPublication: { findMany: vi.fn().mockResolvedValue([publication()]) },
      $queryRaw: vi.fn().mockResolvedValue([lockedPublication()]),
    } as never;
    const resolved = await resolvePublicIntakePrivacyGate("ABUSE_REPORT", {
      database: transaction,
      environment: PREVIEW_ENVIRONMENT,
      now: NOW,
    });
    if (!resolved.allowed) throw new Error("Expected a current publication.");
    const expected = toPublicIntakePrivacyExpectedBinding(resolved.binding);

    await expect(
      lockPublicIntakePrivacyGate(transaction, expected, {
        environment: PREVIEW_ENVIRONMENT,
        now: NOW,
      }),
    ).resolves.toMatchObject({ allowed: true });

    (transaction as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw.mockResolvedValueOnce([]);
    await expect(
      lockPublicIntakePrivacyGate(transaction, expected, {
        environment: PREVIEW_ENVIRONMENT,
        now: NOW,
      }),
    ).resolves.toEqual({
      allowed: false,
      code: "STALE_OR_TAMPERED_BINDING",
    });
  });

  it("rejects duplicate or purpose-tampered hidden fields", () => {
    const binding = localPublicIntakePrivacyBinding("ABUSE_REPORT");
    const form = formDataFor(binding);
    form.append("privacyNoticeHash", binding.noticeHash);
    expect(
      readPublicIntakePrivacyExpectedBinding(form, "ABUSE_REPORT"),
    ).toBeNull();

    const wrongPurpose = formDataFor(binding);
    wrongPurpose.set("privacyPurpose", "EMPLOYER_DEMO");
    expect(
      readPublicIntakePrivacyExpectedBinding(wrongPurpose, "ABUSE_REPORT"),
    ).toBeNull();
  });
});

function publication() {
  return {
    id: PUBLICATION_ID,
    publicationHash: HASH,
    legalDocument: { type: "PRIVACY", locale: "de-CH", slug: "privacy" },
    legalRevision: {
      status: "APPROVED",
      versionLabel: "2026-08",
      contentHash: HASH,
    },
  };
}

function lockedPublication() {
  return {
    publicationId: PUBLICATION_ID,
    publicationHash: HASH,
    versionLabel: "2026-08",
    contentHash: HASH,
    revisionStatus: "APPROVED",
    documentType: "PRIVACY",
    locale: "de-CH",
    slug: "privacy",
  };
}

function formDataFor(
  binding: ReturnType<typeof localPublicIntakePrivacyBinding>,
) {
  const form = new FormData();
  form.set("privacyPurpose", binding.purpose);
  form.set("privacyEvidenceMode", binding.evidenceMode);
  form.set("privacyLegalPublicationId", binding.legalPublicationId ?? "");
  form.set("privacyPublicationHash", binding.publicationHash ?? "");
  form.set("privacyPublicationVersion", binding.publicationVersion ?? "");
  form.set("privacyNoticeVersion", binding.noticeVersion);
  form.set("privacyNoticeHash", binding.noticeHash);
  return form;
}
