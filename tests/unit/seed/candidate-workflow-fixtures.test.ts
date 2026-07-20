import { describe, expect, it } from "vitest";

import { buildJobFixtures } from "@/prisma/seed/fixtures/companies-jobs";
import {
  APPLICATION_FIXTURES,
  CANDIDATE_FIXTURES,
  CANDIDATE_WORKFLOW_BLOCK_DIGEST,
  CANDIDATE_WORKFLOW_SEED_IDENTITIES,
  CONTACT_REQUEST_FIXTURES,
  JOB_ALERT_FIXTURES,
  RADAR_COMPANY_SLOTS,
  SAVED_JOB_FIXTURES,
} from "@/prisma/seed/fixtures/candidate-workflows";

describe("Phase 05 candidate-workflow fixtures", () => {
  it("contains the exact candidate, skill and language cardinalities", () => {
    expect(CANDIDATE_FIXTURES).toHaveLength(30);
    expect(
      CANDIDATE_FIXTURES.reduce(
        (total, candidate) => total + candidate.skillSlugs.length,
        0,
      ),
    ).toBe(165);
    expect(
      CANDIDATE_FIXTURES.reduce(
        (total, candidate) => total + candidate.languages.length,
        0,
      ),
    ).toBe(75);
    expect(
      CANDIDATE_FIXTURES.every(
        (candidate) =>
          candidate.skillSlugs.length >= 3 && candidate.skillSlugs.length <= 8,
      ),
    ).toBe(true);
    expect(
      CANDIDATE_FIXTURES.every(
        (candidate) =>
          candidate.languages.length >= 2 && candidate.languages.length <= 3,
      ),
    ).toBe(true);
  });

  it("keeps Radar opt-in explicit and excludes both negative controls", () => {
    expect(
      CANDIDATE_FIXTURES.filter(
        (candidate) => candidate.radarConsent === "GRANTED",
      ),
    ).toHaveLength(11);
    expect(
      CANDIDATE_FIXTURES.filter((candidate) => candidate.radarPublished),
    ).toHaveLength(10);

    const consentedIncomplete = CANDIDATE_FIXTURES[10];
    const completeOptedOut = CANDIDATE_FIXTURES[11];
    expect(consentedIncomplete).toMatchObject({
      finalOnboardingStatus: "DRAFT",
      radarConsent: "GRANTED",
      radarPublished: false,
    });
    expect(completeOptedOut).toMatchObject({
      finalOnboardingStatus: "COMPLETE",
      radarConsent: "DENIED",
      radarPublished: false,
    });
  });

  it("contains exact application, save, alert, request and conversation inputs", () => {
    expect(APPLICATION_FIXTURES).toHaveLength(80);
    expect(APPLICATION_FIXTURES.filter((item) => item.hasDetailedHistory)).toHaveLength(
      20,
    );
    expect(new Set(APPLICATION_FIXTURES.map((item) => item.jobIndex)).size).toBe(80);
    expect(APPLICATION_FIXTURES.some((item) => item.status === "INTERVIEW")).toBe(
      true,
    );
    expect(APPLICATION_FIXTURES.some((item) => item.status === "OFFER")).toBe(true);
    expect(SAVED_JOB_FIXTURES).toHaveLength(40);
    expect(JOB_ALERT_FIXTURES).toHaveLength(15);
    expect(new Set(JOB_ALERT_FIXTURES.map((alert) => alert.status))).toEqual(
      new Set(["ACTIVE", "PAUSED", "UNSUBSCRIBED", "DELETED"]),
    );
    expect(CONTACT_REQUEST_FIXTURES).toHaveLength(6);
    expect(
      CONTACT_REQUEST_FIXTURES.filter((request) => request.status === "ACCEPTED"),
    ).toHaveLength(2);
    expect(
      CONTACT_REQUEST_FIXTURES.filter((request) => request.status === "PENDING"),
    ).toHaveLength(2);
    expect(
      CONTACT_REQUEST_FIXTURES.filter((request) => request.status === "DECLINED"),
    ).toHaveLength(2);
    expect(RADAR_COMPANY_SLOTS).toHaveLength(2);
  });

  it("links every document required by a submitted application", () => {
    const publishedJobs = buildJobFixtures(new Date("2026-07-20T12:00:00.000Z"))
      .filter((job) => job.status === "PUBLISHED");

    expect(publishedJobs).toHaveLength(100);
    for (const application of APPLICATION_FIXTURES) {
      const job = publishedJobs[application.jobIndex];
      expect(job).toBeDefined();
      expect(job?.requiredDocumentKinds.includes("CV")).toBe(application.linksCv);
      expect(job?.requiredDocumentKinds.includes("COVER_LETTER")).toBe(false);
      expect(job?.requiredDocumentKinds).toEqual(
        application.linksCv ? ["CV"] : ["NONE"],
      );
    }
  });

  it("exports a complete collision-free stable identity contract", () => {
    const ids = CANDIDATE_WORKFLOW_SEED_IDENTITIES.map((identity) => identity.id);
    const semanticKeys = CANDIDATE_WORKFLOW_SEED_IDENTITIES.map(
      (identity) => `${identity.entity}:${identity.naturalKey}`,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(semanticKeys).size).toBe(semanticKeys.length);
    expect(CANDIDATE_WORKFLOW_BLOCK_DIGEST.recordCount).toBe(ids.length);
    expect(CANDIDATE_WORKFLOW_BLOCK_DIGEST.digestSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
