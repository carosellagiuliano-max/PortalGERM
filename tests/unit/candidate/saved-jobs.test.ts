// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  filterPubliclyEligibleJobsInTransaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/public-eligibility", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/jobs/public-eligibility")
  >();
  return {
    ...actual,
    filterPubliclyEligibleJobsInTransaction:
      mocks.filterPubliclyEligibleJobsInTransaction,
  };
});

import { signJobIntent, type SignedJobIntentKey } from "@/lib/auth/signed-intent";
import {
  listCandidateSavedJobs,
  removeSavedJob,
  saveJobFromSignedIntent,
} from "@/lib/candidate/saved-jobs";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const CANDIDATE_USER_ID = "10000000-0000-4000-8000-000000000001";
const SAVED_JOB_ID = "10000000-0000-4000-8000-000000000002";
const KEY = signingKey(Buffer.alloc(32, 42));

describe("candidate saved-job transaction contract", () => {
  it("retries a Serializable conflict up to a successful third attempt", async () => {
    const serializationError = Object.assign(new Error("serialization"), { code: "P2034" });
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(serializationError)
      .mockRejectedValueOnce(serializationError)
      .mockResolvedValueOnce({
        kind: "SAVED",
        id: SAVED_JOB_ID,
        duplicate: false,
        jobSlug: "pflege-zuerich",
      });
    const intent = signJobIntent(
      { action: "SAVE", jobSlug: "pflege-zuerich", now: NOW },
      KEY,
    );

    await expect(
      saveJobFromSignedIntent(
        { signedIntent: intent, candidateUserId: CANDIDATE_USER_ID },
        {
          database: { $transaction: transaction } as never,
          environment: { APP_ENV: "local" } as never,
          signingKey: KEY,
          now: NOW,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      savedJobId: SAVED_JOB_ID,
      duplicate: false,
      jobSlug: "pflege-zuerich",
    });
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(transaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it("uses a candidate-owned deleteMany predicate and hides foreign ids", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(
      removeSavedJob(
        { savedJobId: SAVED_JOB_ID, candidateUserId: CANDIDATE_USER_ID },
        { savedJob: { deleteMany } } as never,
      ),
    ).resolves.toEqual({ ok: true, removed: false });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: SAVED_JOB_ID,
        candidateProfile: { userId: CANDIDATE_USER_ID },
      },
    });
  });

  it("loads 100 saved jobs through one transaction and one eligibility batch", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => {
      const suffix = String(index + 1).padStart(12, "0");
      return {
        id: `20000000-0000-4000-8000-${suffix}`,
        createdAt: new Date(NOW.getTime() - index * 1_000),
        job: {
          id: `30000000-0000-4000-8000-${suffix}`,
          slug: `saved-job-${index + 1}`,
          status: "PUBLISHED",
          expiresAt: new Date("2026-08-20T12:00:00.000Z"),
          company: { name: `Company ${index + 1}` },
          publishedCategory: { id: "40000000-0000-4000-8000-000000000001" },
          publishedRevision: { title: `Job ${index + 1}` },
        },
      };
    });
    const transactionClient = {
      savedJob: { findMany: vi.fn().mockResolvedValue(rows) },
      $queryRaw: vi.fn(),
    };
    const transaction = vi.fn(async (operation: (client: unknown) => unknown) =>
      operation(transactionClient),
    );
    mocks.filterPubliclyEligibleJobsInTransaction.mockReset();
    mocks.filterPubliclyEligibleJobsInTransaction.mockImplementation(
      async (jobIds: readonly string[]) =>
        jobIds.map((id, index) => ({
          id,
          slug: rows[index]!.job.slug,
          companyId: "50000000-0000-4000-8000-000000000001",
          companyName: rows[index]!.job.company.name,
          title: rows[index]!.job.publishedRevision.title,
          description: "Test",
          publishedAt: NOW,
          expiresAt: new Date("2026-08-20T12:00:00.000Z"),
          fairScore: null,
          responseTargetDays: 7,
          salaryMin: null,
          salaryMax: null,
          salaryPeriod: null,
          categoryId: rows[index]!.job.publishedCategory.id,
          cantonId: null,
          cityId: null,
          remoteType: "HYBRID",
          jobType: "PERMANENT",
          workloadMin: 80,
          workloadMax: 100,
        })),
    );

    const result = await listCandidateSavedJobs(
      CANDIDATE_USER_ID,
      { $transaction: transaction } as never,
      { now: NOW, environment: "non-production" },
    );

    expect(result).toHaveLength(100);
    expect(result.every((item) => item.current)).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      timeout: 30_000,
    });
    expect(transactionClient.savedJob.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.filterPubliclyEligibleJobsInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.filterPubliclyEligibleJobsInTransaction).toHaveBeenCalledWith(
      rows.map((row) => row.job.id),
      NOW,
      "non-production",
      transactionClient,
    );
    expect(transactionClient.$queryRaw).not.toHaveBeenCalled();
  });
});

function signingKey(bytes: Buffer): SignedJobIntentKey {
  return Object.freeze({
    withValue<TResult>(consumer: (value: string) => TResult): TResult {
      return consumer(bytes.toString("base64"));
    },
  });
}
