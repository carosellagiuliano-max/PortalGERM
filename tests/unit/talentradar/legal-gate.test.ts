// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decideTalentRadarRuntimeGate,
  lockTalentRadarRuntimeGate,
} from "@/lib/talentradar/legal-gate";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const INVENTORY_ID = "10000000-0000-4000-8000-000000000001";
const APPROVAL_ID = "10000000-0000-4000-8000-000000000002";
const PUBLICATION_ID = "10000000-0000-4000-8000-000000000003";

function database(overrides: Readonly<{
  inventory?: unknown;
  approval?: unknown;
  locked?: readonly Readonly<{ approvalId: string }>[];
}> = {}) {
  return {
    $queryRaw: vi.fn(async () =>
      overrides.locked ?? [{ approvalId: APPROVAL_ID }]),
    privacyDataInventoryVersion: {
      findFirst: vi.fn(async () => overrides.inventory ?? approvedInventory()),
    },
    processingApproval: {
      findFirst: vi.fn(async () => overrides.approval ?? approvedGate()),
    },
  };
}

function approvedInventory() {
  return {
    id: INVENTORY_ID,
    contentHash: "b".repeat(64),
    owner: "Swiss Privacy Owner",
    reviewRef: "counsel:inventory:radar:v1",
    entries: [{
      fieldScope: "anonymous projection, consent and contact lifecycle",
      legalBasisCode: "COUNSEL_APPROVED_RADAR",
      holdRuleCode: "COUNSEL_APPROVED_HOLD_V1",
      owner: "Swiss Privacy Owner",
      processorKey: "postgres-primary",
      retentionDays: 180,
      storageRegion: "ch-zurich-1",
    }],
  };
}

function approvedGate(overrides: Readonly<Record<string, unknown>> = {}) {
  const hash = "a".repeat(64);
  return {
    id: APPROVAL_ID,
    scope: "TALENT_RADAR",
    region: "ch-zurich-1",
    processorKey: "postgres-primary",
    version: "radar-v1",
    status: "APPROVED",
    legalPublicationId: PUBLICATION_ID,
    legalBasisRef: "counsel:talent-radar:v1",
    avgDecisionRef: "seco:avg:talent-radar:v1",
    dpaRef: null,
    dsfaDecision: "NOT_REQUIRED",
    dsfaDecisionRef: "dsfa:talent-radar:not-required:v1",
    owner: "Swiss Privacy Owner",
    approvedBy: "Independent AVG Reviewer",
    effectiveAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    reviewAt: new Date(NOW.getTime() + 43_200_000),
    revokedAt: null,
    createdAt: new Date(NOW.getTime() - 120_000),
    legalPublication: {
      id: PUBLICATION_ID,
      status: "CURRENT",
      effectiveAt: new Date(NOW.getTime() - 60_000),
      expiresAt: null,
      revokedAt: null,
      publicationHash: hash,
      legalDocument: { type: "PRIVACY", locale: "de-CH" },
      legalRevision: { status: "APPROVED", contentHash: hash },
    },
    ...overrides,
  };
}

describe("Phase-34 Talent Radar legal runtime gate", () => {
  it.each(["local", "ci"] as const)(
    "keeps the explicitly synthetic %s journey without a legal DB query",
    async (appEnvironment) => {
      const client = database();
      await expect(decideTalentRadarRuntimeGate(client as never, {
        scope: "TALENT_RADAR",
        environment: {
          APP_ENV: appEnvironment,
          LEGAL_PUBLICATION_PRIVACY: false,
        },
        now: NOW,
      })).resolves.toMatchObject({
        allowed: true,
        mode: "LOCAL_SYNTHETIC",
      });
      expect(client.privacyDataInventoryVersion.findFirst).not.toHaveBeenCalled();
      expect(client.processingApproval.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each(["preview", "staging", "production"] as const)(
    "fails %s closed before any repository lookup while Privacy publication is disabled",
    async (appEnvironment) => {
      const client = database();
      await expect(decideTalentRadarRuntimeGate(client as never, {
        scope: "TALENT_RADAR",
        environment: {
          APP_ENV: appEnvironment,
          LEGAL_PUBLICATION_PRIVACY: false,
        },
        now: NOW,
      })).resolves.toEqual({
        allowed: false,
        mode: "BLOCKED",
        scope: "TALENT_RADAR",
        code: "FEATURE_DISABLED",
      });
      expect(client.privacyDataInventoryVersion.findFirst).not.toHaveBeenCalled();
      expect(client.processingApproval.findFirst).not.toHaveBeenCalled();
    },
  );

  it("allows prod-like processing only with matching inventory, Privacy publication, AVG and DSFA evidence", async () => {
    const client = database();
    await expect(decideTalentRadarRuntimeGate(client as never, {
      scope: "TALENT_RADAR",
      environment: {
        APP_ENV: "staging",
        LEGAL_PUBLICATION_PRIVACY: true,
      },
      now: NOW,
    })).resolves.toMatchObject({
      allowed: true,
      mode: "APPROVED_PROCESSING",
      approvalId: APPROVAL_ID,
      inventoryVersionId: INVENTORY_ID,
      processorKey: "postgres-primary",
      region: "ch-zurich-1",
    });
  });

  it("locks and revalidates the exact approved evidence for a mutation", async () => {
    const client = database();
    await expect(lockTalentRadarRuntimeGate(client as never, {
      scope: "TALENT_RADAR",
      environment: {
        APP_ENV: "production",
        LEGAL_PUBLICATION_PRIVACY: true,
      },
      now: NOW,
    })).resolves.toMatchObject({
      allowed: true,
      approvalId: APPROVAL_ID,
      inventoryVersionId: INVENTORY_ID,
      publicationId: PUBLICATION_ID,
    });
    expect(client.$queryRaw).toHaveBeenCalledOnce();
    expect(client.privacyDataInventoryVersion.findFirst).toHaveBeenCalledTimes(2);
    expect(client.processingApproval.findFirst).toHaveBeenCalledTimes(2);
  });

  it("fails a mutation closed when its approved evidence cannot be locked", async () => {
    const client = database({ locked: [] });
    await expect(lockTalentRadarRuntimeGate(client as never, {
      scope: "TALENT_RADAR",
      environment: {
        APP_ENV: "preview",
        LEGAL_PUBLICATION_PRIVACY: true,
      },
      now: NOW,
    })).resolves.toEqual({
      allowed: false,
      mode: "BLOCKED",
      scope: "TALENT_RADAR",
      code: "GATE_UNAVAILABLE",
    });
  });

  it.each([
    ["missing AVG", { avgDecisionRef: null }, "AVG_DECISION_UNAVAILABLE"],
    ["missing DSFA", { dsfaDecisionRef: null }, "DSFA_UNAVAILABLE"],
    [
      "wrong document type",
      {
        legalPublication: {
          ...approvedGate().legalPublication,
          legalDocument: { type: "TERMS", locale: "de-CH" },
        },
      },
      "PUBLICATION_MISMATCH",
    ],
  ] as const)("blocks %s", async (_label, override, code) => {
    const client = database({ approval: approvedGate(override) });
    await expect(decideTalentRadarRuntimeGate(client as never, {
      scope: "TALENT_RADAR",
      environment: {
        APP_ENV: "production",
        LEGAL_PUBLICATION_PRIVACY: true,
      },
      now: NOW,
    })).resolves.toMatchObject({ allowed: false, code });
  });

  it("requires the reviewed inventory to contain an explicit retention decision", async () => {
    const inventory = approvedInventory();
    const client = database({
      inventory: {
        ...inventory,
        entries: [{ ...inventory.entries[0], retentionDays: null }],
      },
    });
    await expect(decideTalentRadarRuntimeGate(client as never, {
      scope: "TALENT_RADAR",
      environment: {
        APP_ENV: "production",
        LEGAL_PUBLICATION_PRIVACY: true,
      },
      now: NOW,
    })).resolves.toMatchObject({
      allowed: false,
      code: "INVENTORY_NOT_APPROVED",
    });
    expect(client.processingApproval.findFirst).not.toHaveBeenCalled();
  });

  it("uses the separate recruiting-conversation scope and MESSAGE inventory entry", async () => {
    const client = database({
      inventory: {
        ...approvedInventory(),
        entries: [{
          fieldScope: "candidate-authored conversation content",
          legalBasisCode: "COUNSEL_APPROVED_RECRUITING_CONVERSATION",
          holdRuleCode: "COUNSEL_APPROVED_HOLD_V1",
          owner: "Swiss Privacy Owner",
          processorKey: "postgres-primary",
          retentionDays: 400,
          storageRegion: "ch-zurich-1",
        }],
      },
      approval: approvedGate({
        scope: "RECRUITING_CONVERSATION",
        version: "conversation-v1",
        legalBasisRef: "counsel:recruiting-conversation:v1",
        avgDecisionRef: "seco:avg:recruiting-conversation:v1",
        dsfaDecisionRef: "dsfa:recruiting-conversation:not-required:v1",
      }),
    });
    await expect(decideTalentRadarRuntimeGate(client as never, {
      scope: "RECRUITING_CONVERSATION",
      environment: {
        APP_ENV: "preview",
        LEGAL_PUBLICATION_PRIVACY: true,
      },
      now: NOW,
    })).resolves.toMatchObject({ allowed: true, scope: "RECRUITING_CONVERSATION" });
    expect(client.processingApproval.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope: "RECRUITING_CONVERSATION",
          processorKey: "postgres-primary",
          region: "ch-zurich-1",
        }),
      }),
    );
  });
});
