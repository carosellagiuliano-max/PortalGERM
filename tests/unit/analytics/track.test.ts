// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  expireRawAnalyticsV1,
  trackAnalyticsEventV1,
  type AnalyticsWriteRecord,
  type AnalyticsWriter,
} from "@/lib/analytics/track";

const OCCURRED_AT = new Date("2026-07-19T00:00:00.000Z");

function writer(result: "CREATED" | "DUPLICATE" = "CREATED") {
  return {
    create: vi.fn<(record: AnalyticsWriteRecord) => Promise<"CREATED" | "DUPLICATE">>(async () => result),
    expire: vi.fn<(at: Date) => Promise<number>>(async () => 3),
  } satisfies AnalyticsWriter;
}

describe("internal analytics writer", () => {
  it("skips optional product analytics when privacy setting is off", async () => {
    const target = writer();
    const result = await trackAnalyticsEventV1({
      schemaVersion: "1", producerEventId: "view-1", occurredAt: OCCURRED_AT,
      kind: "JOB_DETAIL_VIEWED",
      properties: { surface: "JOB_DETAIL", locale: "de-CH" },
    }, { producer: "public-web", productAnalyticsEnabled: false }, target);
    expect(result).toEqual({ recorded: false, duplicate: false, skippedForPrivacy: true });
    expect(target.create).not.toHaveBeenCalled();
  });

  it("derives essential purpose/retention and stores references outside properties", async () => {
    const target = writer();
    const companyId = "11111111-1111-4111-8111-111111111111";
    const result = await trackAnalyticsEventV1({
      schemaVersion: "1", producerEventId: "application-1", occurredAt: OCCURRED_AT,
      kind: "APPLICATION_SUBMITTED", companyId,
      properties: { fromStatus: "DRAFT", toStatus: "SUBMITTED", applicationEffort: "SIMPLE" },
    }, {
      producer: "application-domain", productAnalyticsEnabled: false,
      provenance: { company: "LIVE", actor: "LIVE" },
    }, target);
    expect(result).toEqual({ recorded: true, duplicate: false, skippedForPrivacy: false });
    expect(target.create).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "ESSENTIAL_OPERATIONAL", companyId, companyProvenanceSnapshot: "LIVE",
      retainUntil: new Date("2027-08-23T00:00:00.000Z"),
    }));
    expect(target.create.mock.calls[0]?.[0].properties).not.toHaveProperty("companyId");
  });

  it("maps storage uniqueness to an idempotent duplicate result", async () => {
    const target = writer("DUPLICATE");
    const result = await trackAnalyticsEventV1({
      schemaVersion: "1", producerEventId: "verified-1", occurredAt: OCCURRED_AT,
      kind: "COMPANY_VERIFIED", properties: {},
    }, { producer: "trust-safety", productAnalyticsEnabled: false }, target);
    expect(result).toMatchObject({ recorded: false, duplicate: true });
  });

  it("expires only raw projections through an idempotent writer command", async () => {
    const target = writer();
    await expect(expireRawAnalyticsV1(OCCURRED_AT, target)).resolves.toBe(3);
    expect(target.expire).toHaveBeenCalledWith(OCCURRED_AT);
  });
});
