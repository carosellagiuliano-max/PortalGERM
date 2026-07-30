import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DatabaseClient } from "@/lib/db/factory";
import {
  createPhase31Fixture,
  PHASE31_ADMIN_PRODUCT,
  PHASE31_COMPANY_ONE,
  PHASE31_COMPANY_TWO,
  PHASE31_NOW,
  phase31Digest,
  seedApprovedCommercialModels,
  seedPublicCommercialCluster,
  type Phase31Fixture,
} from "@/tests/fixtures/phase31-commercial";

describe.sequential("Phase 31 commercial Product Release PostgreSQL boundary", () => {
  let fixture: Phase31Fixture | undefined;
  let database: DatabaseClient;
  let hypothesisId = "";
  let releaseId = "";
  let clusterDecisionId = "";
  let models: Awaited<ReturnType<typeof seedApprovedCommercialModels>>;

  beforeAll(async () => {
    fixture = await createPhase31Fixture("phase31_product_release");
    database = fixture.database;
    clusterDecisionId = (await seedPublicCommercialCluster(database)).id;
    models = await seedApprovedCommercialModels(database);
    const hypothesis = await database.commercialHypothesis.create({
      data: {
        id: randomUUID(),
        code: "HIRING_SPRINT_ZG_PFLEGE",
        version: 1,
        offerKind: "HIRING_SPRINT",
        clusterCode: "ZG_PFLEGE",
        status: "APPROVED",
        minimumIndependentBuyers: 2,
        minimumNetPaidRappen: 100_000,
        measurementWindowStart: new Date("2026-07-01T00:00:00.000Z"),
        measurementWindowEnd: new Date("2026-07-31T23:59:59.000Z"),
        offerDigest: phase31Digest("hiring-sprint-v1"),
        ownerUserId: PHASE31_ADMIN_PRODUCT,
        preRegisteredAt: new Date("2026-06-30T12:00:00.000Z"),
      },
    });
    hypothesisId = hypothesis.id;
  }, 600_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("rejects Mock/Test/Free evidence as NET_PAID_WTP", async () => {
    await expect(
      database.commercialEvidence.create({
        data: {
          id: randomUUID(),
          hypothesisId,
          companyId: PHASE31_COMPANY_ONE,
          kind: "NET_PAID_WTP",
          environment: "TEST",
          independentBuyer: true,
          sellerControlledBuyer: false,
          grossPaidRappen: 50_000,
          netPaidRappen: 50_000,
          currency: "CHF",
          deliveryStatus: "STARTED",
          evidenceDigest: phase31Digest("test-payment-does-not-count"),
          occurredAt: PHASE31_NOW,
          recordedByUserId: PHASE31_ADMIN_PRODUCT,
        },
      }),
    ).rejects.toThrow();
  });

  it("blocks release below buyer and net-paid thresholds", async () => {
    await createManualWtp(PHASE31_COMPANY_ONE, 50_000, "buyer-one");
    await expect(createRelease()).rejects.toThrow(
      "Phase 31 commercial release evidence is incomplete",
    );
  });

  it("records an approved technical release after two independent net-paid deliveries", async () => {
    await createManualWtp(PHASE31_COMPANY_TWO, 60_000, "buyer-two");
    const release = await createRelease();
    releaseId = release.id;
    expect(release).toMatchObject({
      status: "APPROVED",
      offerKind: "HIRING_SPRINT",
      serverPriceRappen: 149_00,
      allowsPublic: false,
      allowsSelfService: false,
    });
  });

  it("keeps WTP and release evidence immutable", async () => {
    await expect(
      database.commercialOfferRelease.update({
        where: { id: releaseId },
        data: { serverPriceRappen: 1 },
      }),
    ).rejects.toThrow("append-only");
    const evidence = await database.commercialEvidence.findFirstOrThrow({
      where: { hypothesisId },
      select: { id: true },
    });
    await expect(
      database.commercialEvidence.update({
        where: { id: evidence.id },
        data: { netPaidRappen: 999_999 },
      }),
    ).rejects.toThrow("append-only");
  });

  async function createManualWtp(
    companyId: string,
    grossPaidRappen: number,
    suffix: string,
  ) {
    return database.commercialEvidence.create({
      data: {
        id: randomUUID(),
        hypothesisId,
        companyId,
        manualReconciliationReference: `TEST-ONLY-MANUAL-RECON-${suffix}`,
        kind: "NET_PAID_WTP",
        environment: "MANUAL_RECONCILED",
        independentBuyer: true,
        sellerControlledBuyer: false,
        grossPaidRappen,
        refundRappen: 0,
        reversalRappen: 0,
        netPaidRappen: grossPaidRappen,
        currency: "CHF",
        deliveryStatus: "STARTED",
        evidenceDigest: phase31Digest(`wtp:${suffix}`),
        occurredAt: PHASE31_NOW,
        recordedByUserId: PHASE31_ADMIN_PRODUCT,
      },
    });
  }

  function createRelease() {
    return database.commercialOfferRelease.create({
      data: {
        id: randomUUID(),
        hypothesisId,
        clusterDecisionId,
        capacityModelReleaseId: models.capacity.id,
        cashflowModelReleaseId: models.cashflow.id,
        servicePolicyReleaseId: models.service.id,
        offerKind: "HIRING_SPRINT",
        status: "APPROVED",
        serverPriceRappen: 149_00,
        currency: "CHF",
        allowsPublic: false,
        allowsSelfService: false,
        legalApprovalReference: "TEST-ONLY-LEGAL",
        taxApprovalReference: "TEST-ONLY-TAX",
        avgApprovalReference: "TEST-ONLY-AVG",
        privacyApprovalReference: "TEST-ONLY-PRIVACY",
        accountingApprovalReference: "TEST-ONLY-ACCOUNTING",
        releaseDigest: phase31Digest(`release:${randomUUID()}`),
        approvedByUserId: PHASE31_ADMIN_PRODUCT,
        approvedAt: PHASE31_NOW,
      },
    });
  }
});
