import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  evaluateProviderInboxHealth,
  PROVIDER_INBOX_HEALTH_POLICY_V1,
} from "@/lib/ops/provider-inbox-health";

const NOW = new Date("2026-08-06T12:00:00.000Z");

describe("Phase-34 provider inbox health policy", () => {
  it("keeps an empty or fresh inbox healthy", () => {
    expect(evaluateProviderInboxHealth([], { now: NOW })).toMatchObject({
      processingState: "HEALTHY",
      manualAttention: "NONE",
      reasons: [],
    });
    expect(
      evaluateProviderInboxHealth(
        [row("payment", "RECEIVED", 1, 4 * 60_000 + 59_000)],
        { now: NOW },
      ),
    ).toMatchObject({ processingState: "HEALTHY" });
  });

  it("uses inclusive warning and critical age boundaries", () => {
    const warning = evaluateProviderInboxHealth(
      [
        row(
          "payment",
          "RECEIVED",
          1,
          PROVIDER_INBOX_HEALTH_POLICY_V1.warningAgeMilliseconds,
        ),
      ],
      { now: NOW },
    );
    expect(warning).toMatchObject({
      processingState: "WARNING",
      reasons: ["PAYMENT_INBOX_AGING"],
    });

    const critical = evaluateProviderInboxHealth(
      [
        row(
          "email",
          "RECEIVED",
          1,
          PROVIDER_INBOX_HEALTH_POLICY_V1.criticalAgeMilliseconds,
        ),
      ],
      { now: NOW },
    );
    expect(critical).toMatchObject({
      processingState: "DEGRADED",
      reasons: ["EMAIL_INBOX_STALE"],
    });
  });

  it("separates manual payment holds from broken retry and email failures", () => {
    const held = evaluateProviderInboxHealth(
      [row("payment", "HELD", 2, 60 * 60_000)],
      { now: NOW },
    );
    expect(held).toMatchObject({
      processingState: "HEALTHY",
      manualAttention: "REQUIRED",
      reasons: [],
    });

    const failed = evaluateProviderInboxHealth(
      [
        row("payment", "FAILED", 1, 1_000, 1),
        row("email", "FAILED", 1, 1_000, 1),
      ],
      { now: NOW },
    );
    expect(failed.processingState).toBe("DEGRADED");
    expect(failed.reasons).toEqual([
      "PAYMENT_RETRY_CONTRACT_BROKEN",
      "EMAIL_INBOX_FAILED",
    ]);
  });

  it("fails unknown on duplicate groups, unsafe counts or future timestamps", () => {
    for (const rows of [
      [row("payment", "RECEIVED", 1, 1_000), row("payment", "RECEIVED", 1, 2_000)],
      [
        {
          ...row("payment", "RECEIVED", 1, 1_000),
          count: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        },
      ],
      [
        {
          ...row("payment", "RECEIVED", 1, 1_000),
          oldestReceivedAt: new Date(NOW.getTime() + 1),
        },
      ],
    ]) {
      expect(evaluateProviderInboxHealth(rows, { now: NOW })).toMatchObject({
        processingState: "UNKNOWN",
        reasons: ["PROVIDER_INBOX_QUERY_FAILED"],
      });
    }
  });
});

function row(
  inbox: "payment" | "email",
  status: string,
  count: number,
  ageMilliseconds: number,
  brokenRetryCount = 0,
) {
  return {
    inbox,
    status,
    count: BigInt(count),
    oldestReceivedAt: new Date(NOW.getTime() - ageMilliseconds),
    brokenRetryCount: BigInt(brokenRetryCount),
  } as const;
}
