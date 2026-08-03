// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
}));

vi.mock("@/app/(public)/jobs/actions", () => ({
  recordPublicJobAnalyticsAction: mocks.record,
}));

import { POST } from "@/app/api/analytics/public-jobs/route";

const payload = Object.freeze({
  kind: "JOB_DETAIL_VIEWED",
  eventId: "10000000-0000-4000-8000-000000000001",
  analyticsSessionId: "20000000-0000-4000-8000-000000000001",
  jobSlug: "zh-engineering-demo-001",
});

describe("public job analytics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue(undefined);
  });

  it("forwards bounded JSON and returns a generic no-store response", async () => {
    const response = await POST(request(JSON.stringify(payload)));

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.record).toHaveBeenCalledWith(payload);
  });

  it.each([
    [
      "wrong media type",
      request(JSON.stringify(payload), { contentType: "text/plain" }),
      400,
    ],
    ["invalid JSON", request("{"), 400],
    [
      "declared oversized body",
      request(JSON.stringify(payload), { declaredLength: "4097" }),
      413,
    ],
    [
      "streamed oversized body",
      request(JSON.stringify({ payload: "x".repeat(4_097) })),
      400,
    ],
    [
      "invalid length",
      request(JSON.stringify(payload), { declaredLength: "NaN" }),
      400,
    ],
  ] as const)(
    "rejects %s before analytics processing",
    async (_label, input, status) => {
      const response = await POST(input);

      expect(response.status).toBe(status);
      expect(mocks.record).not.toHaveBeenCalled();
    },
  );

  it("keeps analytics processing failures best-effort and opaque", async () => {
    mocks.record.mockRejectedValue(new Error("sensitive provider failure"));

    const response = await POST(request(JSON.stringify(payload)));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});

function request(
  body: string,
  options: Readonly<{
    contentType?: string;
    declaredLength?: string;
  }> = {},
) {
  return new Request("https://example.test/api/analytics/public-jobs", {
    method: "POST",
    headers: {
      "Content-Type": options.contentType ?? "application/json",
      ...(options.declaredLength === undefined
        ? {}
        : { "Content-Length": options.declaredLength }),
      Origin: "https://example.test",
    },
    body,
  });
}
