import { describe, expect, it } from "vitest";

import { verifyFairJobScoreSnapshotHashV2 } from "@/lib/scoring/fair-job-snapshot";
import {
  COMPANY_FIXTURES,
  COMPANY_PLAN_DISTRIBUTION,
  COMPANIES_JOBS_SEED_IDENTITIES,
  DEMO_ACCOUNT_FIXTURES,
  DEMO_COMPANY_SLUG,
  DEMO_LOGIN_PASSWORD,
  JOB_CONTENT_LANGUAGE_DISTRIBUTION,
  JOB_EFFORT_DISTRIBUTION,
  JOB_STATUS_DISTRIBUTION,
  JOB_TYPE_DISTRIBUTION,
  buildJobFixtures,
} from "@/prisma/seed/fixtures/companies-jobs";
import { CATEGORY_FIXTURES } from "@/prisma/seed/fixtures/categories";
import { OCCUPATION_CODES_2026_FIXTURE } from "@/prisma/seed/fixtures/occupation-codes";
import { assertSeedIdentityIntegrity, stableSeedId } from "@/prisma/seed/ids";

const ANCHOR = new Date("2026-07-20T12:00:00.000Z");

describe("Phase-05 companies and jobs fixtures", () => {
  it("defines the four login accounts without putting the password into identity evidence", () => {
    expect(DEMO_ACCOUNT_FIXTURES).toHaveLength(4);
    expect(
      Object.fromEntries(
        DEMO_ACCOUNT_FIXTURES.map((account) => [account.email, account.role]),
      ),
    ).toEqual({
      "candidate@demo.ch": "CANDIDATE",
      "employer@demo.ch": "EMPLOYER",
      "recruiter@demo.ch": "RECRUITER",
      "admin@demo.ch": "ADMIN",
    });
    expect(DEMO_LOGIN_PASSWORD).toBe("Demo12345!");
    expect(JSON.stringify(COMPANIES_JOBS_SEED_IDENTITIES)).not.toContain(
      DEMO_LOGIN_PASSWORD,
    );
    expect(
      DEMO_ACCOUNT_FIXTURES.find(
        (account) => account.email === "candidate@demo.ch",
      )?.profileId,
    ).toBe(stableSeedId("candidate-profile", "candidate@demo.ch"));
  });

  it("defines 25 original fictional companies with the exact downstream plan mix", () => {
    expect(COMPANY_FIXTURES).toHaveLength(25);
    const counts = countBy(COMPANY_FIXTURES.map((company) => company.planCode));
    expect(counts).toEqual(COMPANY_PLAN_DISTRIBUTION);
    expect(new Set(COMPANY_FIXTURES.map((company) => company.slug)).size).toBe(25);
    expect(
      COMPANY_FIXTURES.find((company) => company.slug === DEMO_COMPANY_SLUG),
    ).toMatchObject({
      planCode: "PRO",
      ownerEmail: "employer@demo.ch",
    });
    expect(
      COMPANY_FIXTURES.filter((company) => company.billingProfileId !== null),
    ).toHaveLength(1);
    expect(
      COMPANY_FIXTURES.find((company) => company.billingProfileId !== null)
        ?.planCode,
    ).toBe("FREE_BASIC");
    expect(
      COMPANY_FIXTURES.every((company) =>
        company.id.startsWith(stableSeedId("company", company.slug).slice(0, 8)),
      ),
    ).toBe(true);
    expect(Object.isFrozen(COMPANY_FIXTURES)).toBe(true);
    expect(COMPANY_FIXTURES.every(Object.isFrozen)).toBe(true);
  });

  it("builds all exact job distributions and complete revision requirements", () => {
    const jobs = buildJobFixtures(ANCHOR);
    expect(jobs).toHaveLength(115);
    expect(countBy(jobs.map((job) => job.status))).toEqual(
      JOB_STATUS_DISTRIBUTION,
    );
    expect(countBy(jobs.map((job) => job.jobType))).toEqual(
      JOB_TYPE_DISTRIBUTION,
    );
    expect(countBy(jobs.map((job) => job.contentLanguage))).toEqual(
      JOB_CONTENT_LANGUAGE_DISTRIBUTION,
    );
    expect(countBy(jobs.map((job) => job.applicationEffort))).toEqual(
      JOB_EFFORT_DISTRIBUTION,
    );
    expect(
      jobs.filter((job) => ["REMOTE", "HYBRID"].includes(job.remoteType)),
    ).toHaveLength(29);
    expect(jobs.filter((job) => job.salaryPeriod !== null)).toHaveLength(58);
    expect(jobs.every((job) => job.skillIds.length === 2)).toBe(true);
    expect(jobs.every((job) => job.languageCodes.length >= 1)).toBe(true);
    expect(
      jobs.every(
        (job) =>
          job.statusEvents.at(-1)?.toStatus === job.status &&
          job.statusEvents[0]?.kind === "DRAFT_CREATED" &&
          job.statusEvents.every(
            (event, index) =>
              index === 0 ||
              new Date(event.createdAt) >=
                new Date(job.statusEvents[index - 1]?.createdAt ?? 0),
          ),
      ),
    ).toBe(true);
  });

  it("keeps exactly 50 eligible demo starts in Zürich × Engineering", () => {
    const jobs = buildJobFixtures(ANCHOR);
    const published = jobs.filter((job) => job.status === "PUBLISHED");
    expect(published).toHaveLength(100);
    expect(
      published.filter(
        (job) =>
          job.cantonCode === "ZH" &&
          job.categorySlug === "engineering-technik",
      ),
    ).toHaveLength(50);
    expect(
      published.every(
        (job) =>
          new Date(job.publishedAt ?? 0) <= ANCHOR &&
          new Date(job.validThrough) > ANCHOR,
      ),
    ).toBe(true);
    const pairCounts = new Map<string, number>();
    for (const job of published) {
      const pair = `${job.cantonCode ?? "REMOTE"}:${job.categorySlug}`;
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }
    expect(pairCounts.get("ZH:engineering-technik")).toBe(50);
    expect(
      [...pairCounts.entries()]
        .filter(([pair]) => pair !== "ZH:engineering-technik")
        .every(([, count]) => count < 50),
    ).toBe(true);
  });

  it("covers every category at least twice and uses the reviewed Jobroom fixture", () => {
    const jobs = buildJobFixtures(ANCHOR);
    const counts = countBy(jobs.map((job) => job.categorySlug));
    for (const category of CATEGORY_FIXTURES) {
      expect(counts[category.slug]).toBeGreaterThanOrEqual(2);
    }
    const occupationCodes = new Set(
      OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map((code) => code.code),
    );
    expect(jobs.every((job) => occupationCodes.has(job.occupationCode))).toBe(
      true,
    );
    expect(
      new Set(jobs.map((job) => job.occupationCode)).size,
    ).toBe(OCCUPATION_CODES_2026_FIXTURE.occupationCodes.length);
  });

  it("computes every approved/current Fair-Job snapshot with the frozen helper", () => {
    const jobs = buildJobFixtures(ANCHOR);
    const scored = jobs.filter((job) => job.scoreSnapshot !== null);
    expect(scored).toHaveLength(105);
    for (const job of scored) {
      expect(job.scoreSnapshot?.jobRevisionId).toBe(job.revisionId);
      expect(
        verifyFairJobScoreSnapshotHashV2(job.scoreSnapshot!),
      ).toBe(true);
    }
  });

  it("publishes a collision-free, drift-checkable static identity contract", () => {
    const identities = assertSeedIdentityIntegrity(
      COMPANIES_JOBS_SEED_IDENTITIES,
    );
    expect(identities).toHaveLength(COMPANIES_JOBS_SEED_IDENTITIES.length);
    expect(new Set(identities.map((identity) => identity.id)).size).toBe(
      identities.length,
    );
    expect(
      identities.some(
        (identity) =>
          identity.entity === "job" &&
          identity.naturalKey === "zh-engineering-demo-001",
      ),
    ).toBe(true);
  });
});

function countBy(values: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((entry) => entry === value).length]),
  );
}
