import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  recordAnalyticsConsentV1,
  trackAnalyticsEventWithLiveConsentV1,
} from "@/lib/analytics/live-consent-policy";
import {
  createPhase22Harness,
  PHASE22_NOW,
  seedPhase22Actors,
  seedProcessingApproval,
  seedPublishedPrivacyNotice,
  type Phase22Actors,
  type Phase22Harness,
} from "@/tests/fixtures/phase22-privacy";

let harness: Phase22Harness | undefined;
let actors: Phase22Actors | undefined;

beforeAll(async () => {
  harness = await createPhase22Harness("phase22_live_analytics_consent");
  actors = await seedPhase22Actors(harness.client, "analytics");
});

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-22 optional LIVE analytics consent", () => {
  it("records exact publication-bound consent, revokes immediately and keeps evidence append-only", async () => {
    const { client, users } = requireFixture();
    const legal = await seedPublishedPrivacyNotice(client, users, "analytics");
    const approval = await seedProcessingApproval(
      client,
      legal.publication.id,
      {
        suffix: "analytics-navigation",
        scope: "OPTIONAL_ANALYTICS_NAVIGATION",
        processorKey: "analytics-store",
      },
    );
    const consentInput = {
      userId: users.requester.id,
      eventFamily: "NAVIGATION",
      granted: true,
      policyVersion: "analytics-v1",
      noticeHash: legal.publication.publicationHash,
      legalPublicationId: legal.publication.id,
      processingApprovalId: approval.id,
      pseudonymEpoch: 1,
      actorUserId: users.requester.id,
      reasonCode: "USER_OPT_IN",
      effectiveAt: PHASE22_NOW,
    } as const;
    const consent = await recordAnalyticsConsentV1(consentInput, {
      database: client,
      region: "ch-sandbox",
      familyEnabled: true,
      now: PHASE22_NOW,
    });
    expect(consent).toMatchObject({ ok: true });
    if (!consent.ok) throw new Error("Analytics consent was not recorded.");

    const event = {
      schemaVersion: "1",
      producerEventId: "phase22-live-navigation-1",
      occurredAt: PHASE22_NOW,
      pseudonymousActorId: "phase22-user-epoch-1",
      kind: "PUBLIC_VALUE_VIEWED",
      properties: { surface: "HOMEPAGE", locale: "de-CH" },
    } as const;
    const context = {
      database: client,
      producer: "phase22-consent-test",
      userId: users.requester.id,
      requiredPolicyVersion: "analytics-v1",
      region: "ch-sandbox",
      familyFlags: { NAVIGATION: true, CONVERSION: false },
      searchLearningCollection: false,
      provenance: { actor: "LIVE" as const },
      now: PHASE22_NOW,
    };
    await expect(
      trackAnalyticsEventWithLiveConsentV1(event, context),
    ).resolves.toEqual({
      recorded: true,
      duplicate: false,
      skippedForPrivacy: false,
    });

    await expect(
      client.analyticsConsentEvent.update({
        where: { id: consent.consentEventId },
        data: { granted: false },
      }),
    ).rejects.toThrow(/append-only/iu);

    const revokedAt = new Date(PHASE22_NOW.getTime() + 1_000);
    const revoked = await recordAnalyticsConsentV1(
      {
        ...consentInput,
        granted: false,
        pseudonymEpoch: 2,
        reasonCode: "USER_OPT_OUT",
        effectiveAt: revokedAt,
      },
      {
        database: client,
        region: "ch-sandbox",
        familyEnabled: true,
        now: revokedAt,
      },
    );
    expect(revoked).toMatchObject({ ok: true });

    await expect(
      trackAnalyticsEventWithLiveConsentV1(
        { ...event, producerEventId: "phase22-live-navigation-2" },
        { ...context, now: revokedAt },
      ),
    ).resolves.toEqual({
      recorded: false,
      duplicate: false,
      skippedForPrivacy: true,
    });
    await expect(
      client.analyticsEvent.count({
        where: { purpose: "PRODUCT_ANALYTICS" },
      }),
    ).resolves.toBe(1);

    await expect(
      trackAnalyticsEventWithLiveConsentV1(
        {
          schemaVersion: "1",
          producerEventId: "phase22-essential-1",
          occurredAt: revokedAt,
          kind: "APPLICATION_SUBMITTED",
          properties: { fromStatus: "DRAFT", toStatus: "SUBMITTED" },
        },
        { ...context, now: revokedAt },
      ),
    ).resolves.toMatchObject({
      recorded: true,
      skippedForPrivacy: false,
    });
  });
});

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-22 analytics fixture is unavailable.");
  }
  return { client: harness.client, users: actors };
}
