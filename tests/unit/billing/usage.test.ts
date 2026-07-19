import type { EntitlementResolutionResult } from "@/lib/billing/entitlements";
import {
  COMPANY_QUOTA_ADVISORY_LOCK_NAMESPACE,
  computeCreditsRemaining,
  countActiveJobs,
  countUsedContacts,
  isQuotaConsumingJob,
  publishWithQuota,
  type CreditLedgerUsageEntry,
  type PublishQuotaPort,
  type PublishQuotaTransaction,
  type QuotaJob,
} from "@/lib/billing/usage";
import { describe, expect, it, vi } from "vitest";

import {
  AT,
  COMPANY_ID,
  PRO_RIGHTS,
  effectiveEntitlements,
} from "./fixtures";

const DAY = 24 * 60 * 60 * 1_000;

function job(overrides: Partial<QuotaJob> = {}): QuotaJob {
  return {
    id: "job-1",
    status: "PUBLISHED",
    publishedAt: new Date(AT.getTime() - DAY),
    expiresAt: new Date(AT.getTime() + DAY),
    ...overrides,
  };
}

function ledgerEntry(
  overrides: Partial<CreditLedgerUsageEntry> = {},
): CreditLedgerUsageEntry {
  return {
    creditType: "TALENT_CONTACT",
    fundingSource: "PLAN_ALLOWANCE",
    kind: "GRANT",
    amount: 10,
    validFrom: new Date(AT.getTime() - DAY),
    validTo: new Date(AT.getTime() + DAY),
    createdAt: new Date(AT.getTime() - DAY),
    ...overrides,
  };
}

describe("canonical quota usage", () => {
  it.each([
    [job(), true],
    [job({ publishedAt: new Date(AT) }), true],
    [job({ publishedAt: new Date(AT.getTime() + 1) }), false],
    [job({ expiresAt: new Date(AT) }), false],
    [job({ status: "PAUSED" }), false],
    [job({ status: "EXPIRED" }), false],
    [job({ status: "APPROVED" }), false],
    [job({ publishedAt: null }), false],
    [job({ expiresAt: null }), false],
  ] as const)("evaluates the exact identity/time predicate", (candidate, expected) => {
    expect(isQuotaConsumingJob(candidate, AT)).toBe(expected);
  });

  it("counts only PUBLISHED jobs in the half-open interval", () => {
    expect(
      countActiveJobs(
        [
          job({ id: "one" }),
          job({ id: "two", status: "PAUSED" }),
          job({ id: "three", expiresAt: new Date(AT) }),
          job({ id: "four", publishedAt: new Date(AT) }),
        ],
        AT,
      ),
    ).toBe(2);
  });
});

describe("read-only credit usage", () => {
  it("computes source-separated current balances at half-open boundaries", () => {
    const balances = computeCreditsRemaining(
      [
        ledgerEntry(),
        ledgerEntry({ kind: "CONSUME", amount: -3 }),
        ledgerEntry({
          fundingSource: "PURCHASED_PACK",
          kind: "GRANT",
          amount: 5,
          validFrom: new Date(AT),
        }),
        ledgerEntry({
          fundingSource: "ADMIN_GRANT",
          kind: "GRANT",
          amount: 99,
          validTo: new Date(AT),
        }),
      ],
      AT,
    );

    expect(balances.PLAN_ALLOWANCE.TALENT_CONTACT).toBe(7);
    expect(balances.PURCHASED_PACK.TALENT_CONTACT).toBe(5);
    expect(balances.ADMIN_GRANT.TALENT_CONTACT).toBe(0);
  });

  it("fails closed on malformed or negative balances", () => {
    expect(() =>
      computeCreditsRemaining(
        [ledgerEntry({ kind: "CONSUME", amount: -11 })],
        AT,
      ),
    ).toThrow("negative");
    expect(() =>
      computeCreditsRemaining([ledgerEntry({ amount: 1.5 })], AT),
    ).toThrow("Malformed");
  });

  it("counts TALENT_CONTACT consumption in a half-open period", () => {
    const start = new Date("2026-07-01T00:00:00.000Z");
    const end = new Date("2026-08-01T00:00:00.000Z");
    const entries = [
      ledgerEntry({ kind: "CONSUME", amount: -1, createdAt: start }),
      ledgerEntry({
        kind: "CONSUME",
        amount: -2,
        createdAt: new Date(end.getTime() - 1),
      }),
      ledgerEntry({ kind: "CONSUME", amount: -4, createdAt: end }),
      ledgerEntry({
        creditType: "JOB_BOOST",
        kind: "CONSUME",
        amount: -1,
        createdAt: start,
      }),
    ];
    expect(countUsedContacts(entries, { start, end })).toBe(3);
  });
});

describe("publishWithQuota transaction algorithm", () => {
  function makePort(options: {
    activeCount?: number;
    resolution?: EntitlementResolutionResult;
    permit?: Awaited<
      ReturnType<PublishQuotaTransaction<unknown>["findCurrentAdditionalJobPermit"]>
    >;
  } = {}) {
    const events: string[] = [];
    const resolution =
      options.resolution ??
      ({ ok: true, value: effectiveEntitlements() } satisfies EntitlementResolutionResult);
    const transaction: PublishQuotaTransaction<{ status: string }> = {
      acquireCompanyQuotaAdvisoryLock: vi.fn(async () => {
        events.push("lock");
      }),
      countQuotaConsumingJobs: vi.fn(async () => {
        events.push("count");
        return options.activeCount ?? 0;
      }),
      resolveEffectiveEntitlements: vi.fn(async () => {
        events.push("entitlements");
        return resolution;
      }),
      findCurrentAdditionalJobPermit: vi.fn(async () => {
        events.push("permit");
        return options.permit ?? null;
      }),
      commitPublication: vi.fn(async () => {
        events.push("commit");
        return { status: "PUBLISHED" };
      }),
    };
    const port: PublishQuotaPort<{ status: string }> = {
      transaction: vi.fn(async (callback) => {
        events.push("transaction:start");
        const result = await callback(transaction);
        events.push("transaction:end");
        return result;
      }),
    };
    return { events, port, transaction };
  }

  const command = {
    companyId: COMPANY_ID,
    jobId: "job-1",
    revisionId: "revision-1",
    revisionValidThrough: new Date(AT.getTime() + 30 * DAY),
    now: AT,
  } as const;

  it("locks, recounts, resolves, and writes status/event/audit in one callback", async () => {
    const { events, port, transaction } = makePort();
    const result = await publishWithQuota(command, port);

    expect(result).toEqual({ ok: true, value: { status: "PUBLISHED" } });
    expect(events).toEqual([
      "transaction:start",
      "lock",
      "count",
      "entitlements",
      "commit",
      "transaction:end",
    ]);
    expect(transaction.acquireCompanyQuotaAdvisoryLock).toHaveBeenCalledWith(
      COMPANY_QUOTA_ADVISORY_LOCK_NAMESPACE,
      COMPANY_ID,
    );
    expect(transaction.countQuotaConsumingJobs).toHaveBeenCalledWith(COMPANY_ID, AT);
    expect(transaction.commitPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        jobId: "job-1",
        revisionId: "revision-1",
        now: AT,
      }),
    );
  });

  it("does not write when the resolver fails closed", async () => {
    const { port, transaction } = makePort({
      resolution: { ok: false, error: { code: "AMBIGUOUS_SUBSCRIPTION" } },
    });
    expect(await publishWithQuota(command, port)).toEqual({
      ok: false,
      reason: "ENTITLEMENT_RESOLUTION_FAILED",
    });
    expect(transaction.commitPublication).not.toHaveBeenCalled();
  });

  it("loads a targeted permit only when the canonical recount reaches the limit", async () => {
    const oneJobRights = { ...PRO_RIGHTS, ACTIVE_JOB_LIMIT: 1 };
    const resolution: EntitlementResolutionResult = {
      ok: true,
      value: effectiveEntitlements({
        planRights: oneJobRights,
        rights: oneJobRights,
      }),
    };
    const { port, transaction } = makePort({ activeCount: 1, resolution });
    const result = await publishWithQuota(command, port);

    expect(result).toMatchObject({ ok: false, reason: "ACTIVE_JOB_LIMIT_REACHED" });
    expect(transaction.findCurrentAdditionalJobPermit).toHaveBeenCalledWith(
      COMPANY_ID,
      "job-1",
      AT,
    );
    expect(transaction.commitPublication).not.toHaveBeenCalled();
  });

  it("commits an exact permit-authorized publication under the same lock", async () => {
    const oneJobRights = { ...PRO_RIGHTS, ACTIVE_JOB_LIMIT: 1 };
    const resolution: EntitlementResolutionResult = {
      ok: true,
      value: effectiveEntitlements({
        planRights: oneJobRights,
        rights: oneJobRights,
      }),
    };
    const { events, port } = makePort({
      activeCount: 1,
      resolution,
      permit: {
        companyId: COMPANY_ID,
        targetJobId: "job-1",
        status: "ACTIVE",
        validFrom: new Date(AT.getTime() - DAY),
        validTo: new Date(AT.getTime() + 30 * DAY),
        revokedAt: null,
      },
    });
    expect(await publishWithQuota(command, port)).toMatchObject({ ok: true });
    expect(events).toEqual([
      "transaction:start",
      "lock",
      "count",
      "entitlements",
      "permit",
      "commit",
      "transaction:end",
    ]);
  });
});
