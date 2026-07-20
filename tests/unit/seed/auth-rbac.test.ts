import { describe, expect, it } from "vitest";

import { buildAuthRbacSeedBlockDigest } from "@/prisma/seed/blocks/auth-rbac";
import {
  AUTH_RBAC_SEED_IDENTITIES,
  SUSPENDED_AUTH_ACTOR_EMAIL,
  buildAuthRbacSeedFixtures,
} from "@/prisma/seed/fixtures/auth-rbac";
import {
  DEMO_ACCOUNT_FIXTURES,
  DEMO_COMPANY_SLUG,
  DEMO_LOGIN_PASSWORD,
  RADAR_DEMO_COMPANY_SLUG,
} from "@/prisma/seed/fixtures/companies-jobs";
import { assertSeedIdentityIntegrity, stableSeedId } from "@/prisma/seed/ids";

const ANCHOR = new Date("2026-07-20T10:00:00.000Z");
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

describe("Phase-06 auth and RBAC seed fixtures", () => {
  it("keeps the four official demo identities and login contract unchanged", () => {
    expect(DEMO_ACCOUNT_FIXTURES).toEqual([
      expect.objectContaining({
        email: "candidate@demo.ch",
        id: "b05d30e2-ade6-57f2-b376-12cef27a86e4",
        role: "CANDIDATE",
      }),
      expect.objectContaining({ email: "employer@demo.ch", role: "EMPLOYER" }),
      expect.objectContaining({
        email: "recruiter@demo.ch",
        role: "RECRUITER",
      }),
      expect.objectContaining({ email: "admin@demo.ch", role: "ADMIN" }),
    ]);
    expect(DEMO_LOGIN_PASSWORD).toBe("Demo12345!");
  });

  it("adds a deterministic suspended actor and the recruiter's second company", () => {
    const first = buildAuthRbacSeedFixtures(ANCHOR);
    const second = buildAuthRbacSeedFixtures(new Date(ANCHOR));

    expect(first).toEqual(second);
    expect(first.suspendedActor).toMatchObject({
      email: SUSPENDED_AUTH_ACTOR_EMAIL,
      role: "CANDIDATE",
      status: "SUSPENDED",
    });
    expect(first.suspendedActor.id).not.toBe(
      stableSeedId("user", "candidate@demo.ch"),
    );
    expect(first.recruiterMembership).toMatchObject({
      companySlug: RADAR_DEMO_COMPANY_SLUG,
      role: "RECRUITER",
      status: "ACTIVE",
      userId: stableSeedId("user", "recruiter@demo.ch"),
    });
    expect(first.recruiterMembership.companyId).not.toBe(
      stableSeedId("company", DEMO_COMPANY_SLUG),
    );
    expect(first.recruiterMembership.event).toMatchObject({
      kind: "CREATED",
      reasonCode: "PHASE_06_MULTI_COMPANY_DEMO",
    });
  });

  it("contains only hashed, already-inert authentication lifecycle evidence", () => {
    const fixtures = buildAuthRbacSeedFixtures(ANCHOR);
    const evidence = [
      fixtures.expiredSession,
      fixtures.expiredReset,
      fixtures.usedReset,
    ];

    expect(evidence.map(({ tokenHash }) => tokenHash)).toEqual([
      expect.stringMatching(SHA256_PATTERN),
      expect.stringMatching(SHA256_PATTERN),
      expect.stringMatching(SHA256_PATTERN),
    ]);
    expect(new Set(evidence.map(({ tokenHash }) => tokenHash))).toHaveLength(3);
    expect(fixtures.expiredSession.expiresAt.getTime()).toBeLessThan(
      ANCHOR.getTime(),
    );
    expect(fixtures.expiredSession.absoluteExpiresAt.getTime()).toBeLessThan(
      ANCHOR.getTime(),
    );
    expect(fixtures.expiredReset.expiresAt.getTime()).toBeLessThan(
      ANCHOR.getTime(),
    );
    expect(fixtures.expiredReset.usedAt).toBeNull();
    expect(fixtures.usedReset.usedAt?.getTime()).toBeLessThan(ANCHOR.getTime());

    const serialized = JSON.stringify(fixtures);
    expect(serialized).not.toContain(DEMO_LOGIN_PASSWORD);
    expect(serialized).not.toMatch(/raw.?token|session.?secret|reset.?secret/iu);
  });

  it("publishes a closed seven-identity block without hashes or secrets", () => {
    const fixtures = buildAuthRbacSeedFixtures(ANCHOR);
    const identities = assertSeedIdentityIntegrity(AUTH_RBAC_SEED_IDENTITIES);
    const digest = buildAuthRbacSeedBlockDigest();
    const serializedDigest = JSON.stringify(digest);

    expect(identities).toHaveLength(7);
    expect(digest).toEqual({
      digestSha256: expect.stringMatching(SHA256_PATTERN),
      name: "auth-rbac",
      recordCount: 7,
    });
    expect(serializedDigest).not.toContain(DEMO_LOGIN_PASSWORD);
    expect(serializedDigest).not.toContain(fixtures.expiredSession.tokenHash);
    expect(serializedDigest).not.toContain(fixtures.expiredReset.tokenHash);
    expect(serializedDigest).not.toContain(fixtures.usedReset.tokenHash);
  });
});
