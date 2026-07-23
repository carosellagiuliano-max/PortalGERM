import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  TALENT_CONTACT_POLICY_V1,
  contactRequestExpiresAt,
  createPrismaRadarContactProofPort,
  fingerprintRadarContactCommand,
  isAuthorizedRadarContactProofForSession,
  radarCandidateReportTargetInputSchema,
  recontactAvailableAt,
  resolveEmployerRadarCandidateReportTarget,
  sendContactRequestInputSchema,
  signRadarContactSearchSessionProof,
  verifyRadarContactSearchSessionProof,
  type AuthorizedRadarContactProof,
  type EmployerRadarContactActor,
  type StoredSearchSessionProof,
} from "@/lib/talentradar/request-contact";
import { mintRadarOpaqueIdForAuthorizedDto } from "@/lib/talentradar/opaque-id";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  company: "00000000-0000-4000-8000-000000000002",
  membership: "00000000-0000-4000-8000-000000000003",
  session: "00000000-0000-4000-8000-000000000004",
  candidate: "00000000-0000-4000-8000-000000000005",
} as const;

const validInput = Object.freeze({
  opaqueCandidateId: "abcdefghijklmnopqrstuv",
  signedSearchSession: "signed.session.proof_abcdefghijklmnopqrstuvwxyz",
  subject: "  Gespräch über eine passende Rolle  ",
  messagePreview: "  Guten Tag, wir möchten Sie gern kennenlernen.  ",
  idempotencyKey: "contact-attempt-0001",
});

const actor: EmployerRadarContactActor = Object.freeze({
  userId: ids.actor,
  companyId: ids.company,
  membershipId: ids.membership,
});

const proof: AuthorizedRadarContactProof = Object.freeze({
  radarSearchSessionId: ids.session,
  candidateProfileId: ids.candidate,
  filterHash: "a".repeat(64),
  cohortSize: 10,
  cantonBucketSnapshot: "ZH",
  categoryBucketSnapshot: "software-development",
});

const session: StoredSearchSessionProof = Object.freeze({
  id: ids.session,
  companyId: ids.company,
  membershipId: ids.membership,
  requestingUserId: ids.actor,
  filterHash: "a".repeat(64),
  policyVersion: "v1",
  resultCount: 10,
  normalizedFilters: {
    skillId: null,
    cantonCode: null,
    salaryBudgetCeilingChf: null,
    workloadMinimumPercent: null,
    languageCode: null,
    languageMinimumLevel: null,
    remotePreference: null,
  },
  expiresAt: new Date("2026-07-22T12:15:00.000Z"),
  candidateProfileId: ids.candidate,
});

describe("Talent Radar contact draft contract", () => {
  it("normalizes bounded plain text and keeps only anonymous proof fields", () => {
    expect(sendContactRequestInputSchema.parse(validInput)).toEqual({
      ...validInput,
      subject: "Gespräch über eine passende Rolle",
      messagePreview: "Guten Tag, wir möchten Sie gern kennenlernen.",
    });
    expect(
      sendContactRequestInputSchema.safeParse({
        ...validInput,
        candidateProfileId: ids.candidate,
      }).success,
    ).toBe(false);
  });

  it.each([
    { subject: "<b>Vertraulich</b>" },
    { subject: "Zeile 1\nZeile 2" },
    { messagePreview: "Hallo\u0000Welt" },
    { subject: "x".repeat(201) },
    { messagePreview: "🙂".repeat(501) },
  ])("rejects markup, controls and Unicode overflow: %#", (override) => {
    expect(
      sendContactRequestInputSchema.safeParse({
        ...validInput,
        ...override,
      }).success,
    ).toBe(false);
  });

  it("counts Unicode code points rather than UTF-16 units", () => {
    expect(
      sendContactRequestInputSchema.safeParse({
        ...validInput,
        messagePreview: "🙂".repeat(500),
      }).success,
    ).toBe(true);
  });

  it("binds idempotency evidence to actor, opaque target and search proof", () => {
    const normalized = sendContactRequestInputSchema.parse(validInput);
    const first = fingerprintRadarContactCommand({ actor, input: normalized });
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(fingerprintRadarContactCommand({ actor, input: normalized })).toBe(first);
    expect(fingerprintRadarContactCommand({
      actor,
      input: { ...normalized, opaqueCandidateId: "zyxwvutsrqponmlkjihgfe" },
    })).not.toBe(first);
    expect(fingerprintRadarContactCommand({
      actor,
      input: {
        ...normalized,
        signedSearchSession: `${normalized.signedSearchSession}x`,
      },
    })).not.toBe(first);
  });
});

describe("Talent Radar contact time policy", () => {
  it("uses the locked 14-day request and 30-day recontact windows", () => {
    const at = new Date("2026-07-22T12:00:00.000Z");
    expect(contactRequestExpiresAt(at).toISOString()).toBe(
      "2026-08-05T12:00:00.000Z",
    );
    expect(recontactAvailableAt(at).toISOString()).toBe(
      "2026-08-21T12:00:00.000Z",
    );
    expect(TALENT_CONTACT_POLICY_V1.suggestedProductSlug).toBe(
      "contact-pack-10",
    );
  });

  it("rejects invalid clock values", () => {
    expect(() => contactRequestExpiresAt(new Date(Number.NaN))).toThrow();
    expect(() => recontactAvailableAt(new Date(Number.NaN))).toThrow();
  });
});

describe("signed search proof database recheck", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");

  it("accepts only an unexpired exact member/company/candidate/cohort binding", () => {
    expect(
      isAuthorizedRadarContactProofForSession(proof, session, actor, now),
    ).toBe(true);
  });

  it.each([
    ["cross-company", { ...session, companyId: ids.candidate }],
    ["cross-member", { ...session, membershipId: ids.company }],
    ["cross-user", { ...session, requestingUserId: ids.membership }],
    ["cross-candidate", { ...session, candidateProfileId: ids.company }],
    ["filter drift", { ...session, filterHash: "b".repeat(64) }],
    ["cohort drift", { ...session, resultCount: 11 }],
    ["suppressed cohort", { ...session, resultCount: 9 }],
    ["policy drift", { ...session, policyVersion: "v2" }],
    ["half-open expiry", { ...session, expiresAt: now }],
  ])("fails closed on %s", (_name, changedSession) => {
    expect(
      isAuthorizedRadarContactProofForSession(
        proof,
        changedSession as StoredSearchSessionProof,
        actor,
        now,
      ),
    ).toBe(false);
  });

  it("fails closed when the port returns an invalid safe bucket", () => {
    expect(
      isAuthorizedRadarContactProofForSession(
        { ...proof, categoryBucketSnapshot: "<identity>" },
        session,
        actor,
        now,
      ),
    ).toBe(false);
  });
});

describe("Talent Radar abuse target resolution", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const input = {
    opaqueCandidateId: validInput.opaqueCandidateId,
    signedSearchSession: validInput.signedSearchSession,
  };

  it("accepts only opaque proof fields from the browser", () => {
    expect(radarCandidateReportTargetInputSchema.parse(input)).toEqual(input);
    expect(
      radarCandidateReportTargetInputSchema.safeParse({
        ...input,
        userId: ids.candidate,
      }).success,
    ).toBe(false);
  });

  it("resolves the user id only after the stored member/company/session recheck", async () => {
    const transaction = reportTransaction();
    const database = {
      $transaction: vi.fn(
        async (operation: (value: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };
    const proofPort = {
      authorizeForContact: vi.fn().mockResolvedValue({
        ok: true,
        value: proof,
      }),
    };

    await expect(
      resolveEmployerRadarCandidateReportTarget(input, {
        actor,
        database: database as never,
        proofPort,
        now,
      }),
    ).resolves.toEqual({
      userId: "00000000-0000-4000-8000-000000000006",
      companyId: ids.company,
    });
    expect(proofPort.authorizeForContact).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ids.actor,
        companyId: ids.company,
        membershipId: ids.membership,
        opaqueCandidateId: validInput.opaqueCandidateId,
      }),
      transaction,
    );
    expect(transaction.candidateProfile.findUnique).toHaveBeenCalledWith({
      where: { id: ids.candidate },
      select: { userId: true },
    });
  });

  it("fails closed before reading the user id when the stored tenant scope drifts", async () => {
    const transaction = reportTransaction();
    transaction.radarSearchSession.findFirst.mockResolvedValueOnce({
      ...storedReportSession(),
      companyId: "00000000-0000-4000-8000-000000000099",
    });
    const database = {
      $transaction: vi.fn(
        async (operation: (value: typeof transaction) => unknown) =>
          operation(transaction),
      ),
    };

    await expect(
      resolveEmployerRadarCandidateReportTarget(input, {
        actor,
        database: database as never,
        proofPort: {
          authorizeForContact: vi.fn().mockResolvedValue({
            ok: true,
            value: proof,
          }),
        },
        now,
      }),
    ).resolves.toBeNull();
    expect(transaction.candidateProfile.findUnique).not.toHaveBeenCalled();
  });
});

describe("production contact search proof", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const sessionExpiresAt = new Date(now.getTime() + 15 * 60_000);
  const sessionSecret = Buffer.alloc(32, 11).toString("base64");
  const signingKey = Object.freeze({
    withValue<TResult>(consumer: (secret: string) => TResult): TResult {
      return consumer(sessionSecret);
    },
  });
  const lookupKeyring = Object.freeze([
    { version: "lookup-v1", secret: Buffer.alloc(32, 12).toString("base64") },
  ]);
  const encryptionKeyring = Object.freeze([
    { version: "encrypt-v1", secret: Buffer.alloc(32, 13).toString("base64") },
  ]);

  function signedSearchSession() {
    return signRadarContactSearchSessionProof(
      {
        searchSessionId: ids.session,
        actorUserId: ids.actor,
        companyId: ids.company,
        membershipId: ids.membership,
        filterHash: "a".repeat(64),
        sessionExpiresAt,
        now,
      },
      signingKey,
    );
  }

  it("signs a short-lived exact actor/member/company/session binding", () => {
    const token = signedSearchSession();
    expect(
      verifyRadarContactSearchSessionProof(
        token,
        {
          actorUserId: ids.actor,
          companyId: ids.company,
          membershipId: ids.membership,
          now,
        },
        signingKey,
      ),
    ).toEqual(
      expect.objectContaining({
        searchSessionId: ids.session,
        filterHash: "a".repeat(64),
        expiresAt: sessionExpiresAt.getTime(),
      }),
    );
    expect(
      verifyRadarContactSearchSessionProof(
        token,
        {
          actorUserId: ids.actor,
          companyId: ids.candidate,
          membershipId: ids.membership,
          now,
        },
        signingKey,
      ),
    ).toBeNull();
    expect(
      verifyRadarContactSearchSessionProof(
        `${token.slice(0, -1)}x`,
        {
          actorUserId: ids.actor,
          companyId: ids.company,
          membershipId: ids.membership,
          now,
        },
        signingKey,
      ),
    ).toBeNull();
    expect(
      verifyRadarContactSearchSessionProof(
        token,
        {
          actorUserId: ids.actor,
          companyId: ids.company,
          membershipId: ids.membership,
          now: sessionExpiresAt,
        },
        signingKey,
      ),
    ).toBeNull();
  });

  it("resolves the opaque id through the Prisma port and rechecks its session row", async () => {
    const issued = mintRadarOpaqueIdForAuthorizedDto({
      candidateProfileId: ids.candidate,
      companyId: ids.company,
      now,
      lookupKeyring,
      encryptionKeyring,
    });
    const transaction = {
      radarOpaqueMapping: {
        findMany: vi.fn().mockResolvedValue([issued.mapping]),
      },
      radarSearchSessionCandidate: {
        findUnique: vi.fn().mockResolvedValue({
          candidateProfile: {
            radarProfile: {
              cantonBucket: "ZH",
              categoryBucket: "software-development",
            },
          },
          radarSearchSession: {
            id: ids.session,
            companyId: ids.company,
            membershipId: ids.membership,
            requestingUserId: ids.actor,
            filterHash: "a".repeat(64),
            policyVersion: "v1",
            resultCount: 10,
            expiresAt: sessionExpiresAt,
          },
        }),
      },
    };
    const port = createPrismaRadarContactProofPort({
      sessionSigningKey: signingKey,
      opaqueLookupKeyring: lookupKeyring,
      opaqueEncryptionKeyring: encryptionKeyring,
    });
    await expect(
      port.authorizeForContact(
        {
          actorUserId: ids.actor,
          companyId: ids.company,
          membershipId: ids.membership,
          opaqueCandidateId: issued.opaqueId,
          signedSearchSession: signedSearchSession(),
          now,
        },
        transaction as never,
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        radarSearchSessionId: ids.session,
        candidateProfileId: ids.candidate,
        filterHash: "a".repeat(64),
        cohortSize: 10,
        cantonBucketSnapshot: "ZH",
        categoryBucketSnapshot: "software-development",
      },
    });
    expect(transaction.radarOpaqueMapping.findMany).toHaveBeenCalledOnce();
    expect(
      transaction.radarSearchSessionCandidate.findUnique,
    ).toHaveBeenCalledOnce();
  });
});

function storedReportSession() {
  return {
    id: ids.session,
    companyId: ids.company,
    membershipId: ids.membership,
    requestingUserId: ids.actor,
    filterHash: proof.filterHash,
    policyVersion: "v1",
    resultCount: proof.cohortSize,
    normalizedFilters: {},
    expiresAt: new Date("2026-07-22T12:15:00.000Z"),
    candidates: [{ candidateProfileId: ids.candidate }],
  };
}

function reportTransaction() {
  return {
    radarSearchSession: {
      findFirst: vi.fn().mockResolvedValue(storedReportSession()),
    },
    candidateProfile: {
      findUnique: vi.fn().mockResolvedValue({
        userId: "00000000-0000-4000-8000-000000000006",
      }),
    },
  };
}
