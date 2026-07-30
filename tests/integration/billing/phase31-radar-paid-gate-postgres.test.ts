import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DatabaseClient } from "@/lib/db/factory";
import {
  createPhase31Fixture,
  PHASE31_ADMIN_OPS,
  PHASE31_ADMIN_PRODUCT,
  PHASE31_COMPANY_ONE,
  PHASE31_NOW,
  phase31Digest,
  seedApprovedCommercialModels,
  seedPublicCommercialCluster,
  type Phase31Fixture,
} from "@/tests/fixtures/phase31-commercial";

describe.sequential("Phase 31 paid Radar PostgreSQL gate", () => {
  let fixture: Phase31Fixture | undefined;
  let database: DatabaseClient;
  let clusterDecisionId = "";
  let capacityId = "";
  let cashflowId = "";
  let radarServiceId = "";
  let radarHypothesisId = "";

  beforeAll(async () => {
    fixture = await createPhase31Fixture("phase31_radar_paid_gate");
    database = fixture.database;
    clusterDecisionId = (await seedPublicCommercialCluster(database)).id;
    const models = await seedApprovedCommercialModels(database);
    capacityId = models.capacity.id;
    cashflowId = models.cashflow.id;
    radarServiceId = (
      await database.servicePolicyRelease.create({
        data: {
          id: randomUUID(),
          versionCode: "phase31-radar-recovery-test",
          status: "APPROVED",
          policyDigest: phase31Digest("radar-recovery-policy"),
          customerCopyDigest: phase31Digest("radar-recovery-copy"),
          supportedOfferKinds: ["PAID_RADAR"],
          responseSlaMinutes: 240,
          remedyCodes: ["EXTENSION", "CREDIT", "REFUND"],
          escalationOwner: "Phase 31 Radar test owner",
          approvedByUserId: PHASE31_ADMIN_OPS,
          approvedAt: PHASE31_NOW,
        },
      })
    ).id;
    await seedApprovedCoreRelease(models.service.id);
    radarHypothesisId = (
      await createHypothesis("PAID_RADAR", "PAID_RADAR_ZG_PFLEGE")
    ).id;
    await createWtp(radarHypothesisId, "radar-paid-buyer");
  }, 600_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("blocks paid Radar when funnel and privacy evidence are absent", async () => {
    await expect(createRadarRelease()).rejects.toThrow(
      "Phase 31 commercial release evidence is incomplete",
    );
  });

  it("requires both live funnel and privacy-review evidence", async () => {
    await createObservation("RADAR_FUNNEL", "radar-funnel");
    await expect(createRadarRelease()).rejects.toThrow(
      "Phase 31 commercial release evidence is incomplete",
    );
    await createObservation("PRIVACY_REVIEW", "radar-privacy");
    await expect(createRadarRelease()).resolves.toMatchObject({
      status: "APPROVED",
      offerKind: "PAID_RADAR",
      allowsPublic: false,
      allowsSelfService: false,
    });
  });

  it("does not let a generic service policy cover Radar", async () => {
    const secondHypothesis = await createHypothesis(
      "PAID_RADAR",
      "PAID_RADAR_WRONG_SERVICE",
      2,
    );
    await createWtp(secondHypothesis.id, "wrong-service-wtp");
    for (const kind of ["RADAR_FUNNEL", "PRIVACY_REVIEW"] as const) {
      await database.commercialEvidence.create({
        data: {
          id: randomUUID(),
          hypothesisId: secondHypothesis.id,
          kind,
          environment: "LIVE_RESEARCH",
          evidenceDigest: phase31Digest(`${kind}:wrong-service`),
          occurredAt: PHASE31_NOW,
          recordedByUserId: PHASE31_ADMIN_PRODUCT,
        },
      });
    }
    const genericService = await database.servicePolicyRelease.findFirstOrThrow({
      where: { supportedOfferKinds: { has: "HIRING_SPRINT" } },
      select: { id: true },
    });
    await expect(
      createRadarRelease(secondHypothesis.id, genericService.id),
    ).rejects.toThrow("Phase 31 commercial release evidence is incomplete");
  });

  async function seedApprovedCoreRelease(servicePolicyReleaseId: string) {
    const hypothesis = await createHypothesis(
      "HIRING_SPRINT",
      "CORE_BEFORE_RADAR",
    );
    await createWtp(hypothesis.id, "core-paid-buyer");
    await database.commercialOfferRelease.create({
      data: releaseData(
        hypothesis.id,
        "HIRING_SPRINT",
        servicePolicyReleaseId,
      ),
    });
  }

  function createHypothesis(
    offerKind: "HIRING_SPRINT" | "PAID_RADAR",
    code: string,
    version = 1,
  ) {
    return database.commercialHypothesis.create({
      data: {
        id: randomUUID(),
        code,
        version,
        offerKind,
        clusterCode: "ZG_PFLEGE",
        status: "APPROVED",
        minimumIndependentBuyers: 1,
        minimumNetPaidRappen: 10_000,
        measurementWindowStart: new Date("2026-07-01T00:00:00.000Z"),
        measurementWindowEnd: new Date("2026-07-31T23:59:59.000Z"),
        offerDigest: phase31Digest(`hypothesis:${code}:${version}`),
        ownerUserId: PHASE31_ADMIN_PRODUCT,
        preRegisteredAt: new Date("2026-06-30T12:00:00.000Z"),
      },
    });
  }

  function createWtp(hypothesisId: string, suffix: string) {
    return database.commercialEvidence.create({
      data: {
        id: randomUUID(),
        hypothesisId,
        companyId: PHASE31_COMPANY_ONE,
        manualReconciliationReference: `TEST-ONLY-${suffix}`,
        kind: "NET_PAID_WTP",
        environment: "MANUAL_RECONCILED",
        independentBuyer: true,
        grossPaidRappen: 10_000,
        netPaidRappen: 10_000,
        deliveryStatus: "STARTED",
        evidenceDigest: phase31Digest(`wtp:${suffix}`),
        occurredAt: PHASE31_NOW,
        recordedByUserId: PHASE31_ADMIN_PRODUCT,
      },
    });
  }

  function createObservation(
    kind: "RADAR_FUNNEL" | "PRIVACY_REVIEW",
    suffix: string,
  ) {
    return database.commercialEvidence.create({
      data: {
        id: randomUUID(),
        hypothesisId: radarHypothesisId,
        kind,
        environment: "LIVE_RESEARCH",
        evidenceDigest: phase31Digest(suffix),
        occurredAt: PHASE31_NOW,
        recordedByUserId: PHASE31_ADMIN_PRODUCT,
      },
    });
  }

  function createRadarRelease(
    hypothesisId = radarHypothesisId,
    servicePolicyReleaseId = radarServiceId,
  ) {
    return database.commercialOfferRelease.create({
      data: releaseData(hypothesisId, "PAID_RADAR", servicePolicyReleaseId),
    });
  }

  function releaseData(
    hypothesisId: string,
    offerKind: "HIRING_SPRINT" | "PAID_RADAR",
    servicePolicyReleaseId: string,
  ) {
    return {
      id: randomUUID(),
      hypothesisId,
      clusterDecisionId,
      capacityModelReleaseId: capacityId,
      cashflowModelReleaseId: cashflowId,
      servicePolicyReleaseId,
      offerKind,
      status: "APPROVED" as const,
      serverPriceRappen: 149_00,
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
    };
  }
});
