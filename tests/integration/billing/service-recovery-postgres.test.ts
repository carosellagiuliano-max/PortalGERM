import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { confirmMockPayment, createCheckoutOrder } from "@/lib/billing/orders";
import {
  applyServiceDeliveryRemedy,
  assessServiceDelivery,
  serviceDeliveryEvidenceDigest,
} from "@/lib/billing/service-delivery-policy";
import { MockPaymentProvider } from "@/lib/providers/payments";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  PHASE24_NOW,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

const DAY = 86_400_000;

describe("Phase 24 service-delivery recovery", () => {
  let fixture: Phase24BillingFixture;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase24-service-recovery");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("extends a paid Boost once only for evidence-backed platform failure", async () => {
    const planCheckout = await createPhase24StarterCheckout(fixture);
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(planCheckout),
    );
    const jobId = await seedPublishedJobAndBoostProduct(fixture);
    const serviceNow = new Date(PHASE24_NOW.getTime() + 10 * 60_000);
    const mockDependencies = fixture.dependencies({
      now: serviceNow,
      paymentProvider: new MockPaymentProvider(),
      realPayment: undefined,
    });
    const checkout = await createCheckoutOrder(
      {
        kind: "PRODUCT",
        productSlug: "boost-7d",
        quantity: 1,
        targetJobId: jobId,
        idempotencyKey: `service-boost-${randomUUID()}`,
      },
      mockDependencies,
    );
    expect(checkout, JSON.stringify(checkout)).toMatchObject({ ok: true });
    if (!checkout.ok) throw new Error("Expected Boost checkout.");
    const paid = await confirmMockPayment(
      {
        orderId: checkout.value.orderId,
        idempotencyKey: `service-confirm-${randomUUID()}`,
      },
      mockDependencies,
    );
    expect(paid).toMatchObject({ ok: true });
    if (!paid.ok || paid.value.jobBoostId === null) {
      throw new Error("Expected paid Boost fulfillment.");
    }
    const boost = await fixture.database.jobBoost.findUniqueOrThrow({
      where: { id: paid.value.jobBoostId },
    });
    if (boost.orderLineId === null) throw new Error("Expected paid OrderLine.");

    const evidenceDigest = serviceDeliveryEvidenceDigest({
      incident: "phase24-platform-delivery-gap",
      boostId: boost.id,
    });
    const assessment = await assessServiceDelivery(
      {
        actorUserId: fixture.actor.userId,
        classification: "PLATFORM_FAILURE",
        companyId: fixture.companyId,
        correlationId: randomUUID(),
        deliveryStillPossible: true,
        evidenceDigest,
        idempotencyKey: `service-assessment-${randomUUID()}`,
        orderLineId: boost.orderLineId,
        reasonCode: "PLATFORM_DELIVERY_GAP",
        serviceInstanceId: boost.id,
        serviceKind: "JOB_BOOST",
      },
      { database: fixture.database, now: serviceNow },
    );
    expect(assessment).toMatchObject({
      ok: true,
      remedyKind: "SERVICE_EXTENSION",
      status: "APPROVED",
    });
    if (!assessment.ok) throw new Error("Expected approved assessment.");

    await expect(
      applyServiceDeliveryRemedy(
        {
          actorUserId: fixture.actor.userId,
          assessmentId: assessment.assessmentId,
          correlationId: randomUUID(),
          recoveryEnabled: false,
        },
        { database: fixture.database, now: serviceNow },
      ),
    ).resolves.toEqual({ ok: false, code: "DISABLED" });
    const applied = await applyServiceDeliveryRemedy(
      {
        actorUserId: fixture.actor.userId,
        assessmentId: assessment.assessmentId,
        correlationId: randomUUID(),
        recoveryEnabled: true,
      },
      { database: fixture.database, now: serviceNow },
    );
    const replay = await applyServiceDeliveryRemedy(
      {
        actorUserId: fixture.actor.userId,
        assessmentId: assessment.assessmentId,
        correlationId: randomUUID(),
        recoveryEnabled: true,
      },
      { database: fixture.database, now: serviceNow },
    );
    expect(applied).toMatchObject({
      ok: true,
      replay: false,
      status: "APPLIED",
    });
    expect(replay).toMatchObject({ ok: true, replay: true, status: "APPLIED" });
    await expect(
      fixture.database.jobBoost.findUniqueOrThrow({
        where: { id: boost.id },
        select: { endsAt: true },
      }),
    ).resolves.toEqual({
      endsAt: new Date(boost.endsAt.getTime() + 7 * DAY),
    });
    expect(
      await fixture.database.serviceDeliveryEvent.count({
        where: {
          serviceDeliveryAssessmentId: assessment.assessmentId,
          kind: "REMEDY_APPLIED",
        },
      }),
    ).toBe(1);
  });
});

async function seedPublishedJobAndBoostProduct(fixture: Phase24BillingFixture) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const category = await fixture.database.category.create({
    data: {
      name: `Phase24 Engineering ${suffix}`,
      slug: `phase24-engineering-${suffix}`,
      isActive: true,
    },
  });
  const location = await fixture.database.companyLocation.findFirstOrThrow({
    where: { companyId: fixture.companyId, isPrimary: true },
  });
  const job = await fixture.database.job.create({
    data: {
      companyId: fixture.companyId,
      slug: `phase24-service-job-${suffix}`,
      status: "DRAFT",
      origin: "MANUAL",
      sourceReference: `phase24-service:${suffix}`,
      dataProvenance: "TEST",
      createdByUserId: fixture.actor.userId,
    },
  });
  const publishedAt = new Date(PHASE24_NOW.getTime() - DAY);
  const revision = await fixture.database.jobRevision.create({
    data: {
      jobId: job.id,
      revisionNumber: 1,
      title: "Phase 24 Service Engineer",
      description: "Evidenzfähige Teststelle für Service-Recovery.",
      tasks: ["Plattform betreiben"],
      requirements: ["PostgreSQL"],
      applicationProcessSteps: ["Bewerben"],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "ONSITE",
      categoryId: category.id,
      cantonId: location.cantonId,
      cityId: location.cityId,
      locationLabel: "Zürich",
      workloadMin: 80,
      workloadMax: 100,
      salaryPeriod: "YEARLY",
      salaryMin: 100_000,
      salaryMax: 130_000,
      startByArrangement: true,
      validThrough: new Date(PHASE24_NOW.getTime() + 60 * DAY),
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: fixture.actor.email,
      authoredByUserId: fixture.actor.userId,
      contentChecksum: "d".repeat(64),
      submittedAt: new Date(publishedAt.getTime() - DAY),
      approvedAt: publishedAt,
    },
  });
  await fixture.database.job.update({
    where: { id: job.id },
    data: {
      status: "PUBLISHED",
      currentRevisionId: revision.id,
      publishedRevisionId: revision.id,
      publishedAt,
      expiresAt: new Date(PHASE24_NOW.getTime() + 60 * DAY),
      publishedCategoryId: category.id,
      publishedCantonId: location.cantonId,
      publishedCityId: location.cityId,
      publishedSalaryPeriod: "YEARLY",
      publishedSalaryMin: 100_000,
      publishedSalaryMax: 130_000,
    },
  });
  const product = await fixture.database.product.create({
    data: {
      code: "boost-7d",
      name: "Job Boost 7 Tage",
      type: "JOB_BOOST",
    },
  });
  const version = await fixture.database.productVersion.create({
    data: {
      productId: product.id,
      version: 1,
      status: "DRAFT",
      netPriceRappen: 7_900,
      currency: "CHF",
      durationDays: 7,
      creditType: null,
      creditAmount: null,
      isPublic: true,
      isSelfService: true,
      requiresLegalReview: false,
      validFrom: new Date(PHASE24_NOW.getTime() - DAY),
    },
  });
  await fixture.database.productVersion.update({
    where: { id: version.id },
    data: { status: "ACTIVE" },
  });
  return job.id;
}
