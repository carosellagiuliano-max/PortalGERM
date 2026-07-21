import { describe, expect, it } from "vitest";

import { buildEmployerCoreSeedBlockDigest } from "@/prisma/seed/blocks/employer-core";
import {
  EMPLOYER_CORE_ADMIN_EMAIL,
  EMPLOYER_CORE_INVITEE_EMAIL,
  EMPLOYER_CORE_SEED_IDENTITIES,
  EMPLOYER_CORE_VIEWER_EMAIL,
  buildEmployerCoreSeedFixtures,
} from "@/prisma/seed/fixtures/employer-core";
import { assertSeedIdentityIntegrity } from "@/prisma/seed/ids";

const ANCHOR = new Date("2026-07-20T10:00:00.000Z");
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

describe("Phase-10 employer-core seed fixtures", () => {
  it("publishes the audited stable identities for every Company role", () => {
    const fixtures = buildEmployerCoreSeedFixtures(ANCHOR);

    expect(fixtures.principals).toEqual([
      expect.objectContaining({
        id: "497ce4be-0959-56a6-9cfb-6e3f55cbdaea",
        profileId: "bf601828-9891-52ab-a142-a07f46e8a698",
        email: EMPLOYER_CORE_ADMIN_EMAIL,
        role: "EMPLOYER",
      }),
      expect.objectContaining({
        id: "647356f1-4f62-5c52-8c84-0291dc4665eb",
        profileId: "ebaf98fd-fdb9-5511-ba32-bd5ecca16c0a",
        email: EMPLOYER_CORE_VIEWER_EMAIL,
        role: "EMPLOYER",
      }),
    ]);
    expect(fixtures.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "6a9b06cf-018d-5a26-8fb3-1726328205df",
          role: "ADMIN",
          status: "ACTIVE",
        }),
        expect.objectContaining({
          id: "f8c83561-0a2f-5298-95f8-984b9535160f",
          role: "VIEWER",
          status: "ACTIVE",
        }),
      ]),
    );
  });

  it("defines one inert pending reservation and the exact assignment matrix", () => {
    const fixtures = buildEmployerCoreSeedFixtures(ANCHOR);

    expect(fixtures.invitation).toMatchObject({
      id: "9ec873b8-d3a8-5f16-8828-dd32de1f36cd",
      inviteeEmailNormalized: EMPLOYER_CORE_INVITEE_EMAIL,
      intendedRole: "RECRUITER",
      status: "PENDING",
      tokenVersion: 1,
    });
    expect(fixtures.invitation.tokenHash).toMatch(SHA256_PATTERN);
    expect(fixtures.invitation.expiresAt.getTime()).toBeGreaterThan(
      ANCHOR.getTime(),
    );
    expect(
      fixtures.assignments.map(({ id, jobSlug, role }) => ({
        id,
        jobSlug,
        role,
      })),
    ).toEqual([
      {
        id: "bb41ca16-c1e5-5a9f-8bde-4a1e6eed5983",
        jobSlug: "zh-engineering-demo-024",
        role: "PIPELINE",
      },
      {
        id: "c25b0796-d963-5169-acaa-6b6ebb178e84",
        jobSlug: "zh-engineering-demo-025",
        role: "REVIEWER",
      },
      {
        id: "9658b2c9-d9f3-595b-b3c7-d853cdc2b199",
        jobSlug: "kv-administration-demo-054",
        role: "EDITOR",
      },
    ]);
  });

  it("reuses the scheduled downgrade as a coherent over-limit fixture", () => {
    expect(buildEmployerCoreSeedFixtures(ANCHOR).overLimitScenario).toEqual({
      companyId: "4ee6e64f-fa0a-5337-af9d-e385ad45a949",
      companySlug: "bieler-kreislauf-logistik",
      scheduleId: "b1930f69-5eb2-59d4-b9e1-38b31cdf19d6",
      successorSubscriptionId: "11fa3d60-e7a5-5f76-90e6-d844c5585da5",
      targetPlanCode: "STARTER",
      targetActiveJobLimit: 3,
      publishedJobCount: 5,
    });
  });

  it("seals a collision-free, credential-free block contract", () => {
    const fixtures = buildEmployerCoreSeedFixtures(ANCHOR);
    const identities = assertSeedIdentityIntegrity(
      EMPLOYER_CORE_SEED_IDENTITIES,
    );
    const digest = buildEmployerCoreSeedBlockDigest();
    const serializedDigest = JSON.stringify(digest);

    expect(identities).toHaveLength(16);
    expect(digest).toEqual({
      digestSha256: expect.stringMatching(SHA256_PATTERN),
      name: "employer-core",
      recordCount: 16,
    });
    expect(serializedDigest).not.toContain(fixtures.invitation.tokenHash);
    expect(serializedDigest).not.toMatch(/invitationUrl|raw.?token/iu);
  });
});
