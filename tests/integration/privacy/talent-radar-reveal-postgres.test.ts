import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import type { RevealKey } from "@/lib/privacy/reveal-dto";
import { acceptContactRequest } from "@/lib/talentradar/contact-requests";
import {
  buildCandidateRevealPreview,
  getEmployerRadarRequestView,
  grantRevealFields,
  revokeIdentityReveal,
} from "@/lib/talentradar/reveal";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const DAY = 86_400_000;
const NOW = new Date("2026-07-22T10:00:00.000Z");
const CONFIRMATION_KEYS = Object.freeze([
  Object.freeze({
    version: "reveal-confirm-v1",
    secret: Buffer.alloc(32, 0x11).toString("base64"),
  }),
]) satisfies readonly RevealKey[];
const PII_KEYS = Object.freeze([
  Object.freeze({
    version: "reveal-pii-v1",
    secret: Buffer.alloc(32, 0x22).toString("base64"),
  }),
]) satisfies readonly RevealKey[];

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let fixtureSequence = 0;

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase14_talent_radar_reveal");
  database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
}, 120_000);

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential("Phase 14 Talent Radar identity Reveal", () => {
  it("keeps Accept separate from Reveal: one Conversation, zero Grants and zero identity", async () => {
    const fixture = await createPendingContactFixture("accept-only");
    const accepted = await acceptFixture(fixture, "accept-only-transition");

    expect(accepted).toEqual({
      ok: true,
      value: {
        requestId: fixture.contactRequestId,
        status: "ACCEPTED",
        conversationId: expect.any(String),
      },
    });
    await expect(
      db().conversation.count({
        where: { contactRequestId: fixture.contactRequestId, kind: "TALENT_RADAR" },
      }),
    ).resolves.toBe(1);
    await expect(
      db().conversationParticipant.count({
        where: { conversation: { contactRequestId: fixture.contactRequestId } },
      }),
    ).resolves.toBe(2);
    await expect(
      db().identityRevealGrant.count({
        where: { contactRequestId: fixture.contactRequestId },
      }),
    ).resolves.toBe(0);
    await expect(
      getEmployerRadarRequestView(db(), employerViewInput(fixture)),
    ).resolves.toMatchObject({ identity: [], revealStatus: "NONE" });
    await expect(
      db().auditLog.findFirstOrThrow({
        where: {
          action: "CONTACT_REQUEST_ACCEPTED",
          targetId: fixture.contactRequestId,
        },
        select: { targetType: true, result: true },
      }),
    ).resolves.toEqual({
      targetType: "CONTACT_REQUEST",
      result: "SUCCEEDED",
    });
  });

  it("persists exactly one encrypted snapshot and never follows later live-profile edits", async () => {
    const fixture = await createPendingContactFixture("snapshot");
    await acceptFixture(fixture, "snapshot-accept");
    const revealPreview = await preview(fixture, ["DISPLAY_NAME", "EMAIL"]);

    expect(revealPreview.values).toEqual([
      { field: "DISPLAY_NAME", value: fixture.displayName },
      { field: "EMAIL", value: fixture.email },
    ]);
    const granted = await grantRevealFields(
      db(),
      {
        actorUserId: fixture.candidateUserId,
        contactRequestId: fixture.contactRequestId,
        confirmationToken: revealPreview.confirmationToken,
        idempotencyKey: "snapshot-confirmation-v1",
        now: NOW,
      },
      { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
    );
    expect(granted).toMatchObject({
      ok: true,
      newlyAddedFields: ["DISPLAY_NAME", "EMAIL"],
      replay: false,
    });

    const grants = await db().identityRevealGrant.findMany({
      where: { contactRequestId: fixture.contactRequestId },
      include: { fields: { orderBy: { field: "asc" } }, confirmations: true },
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]?.fields).toHaveLength(2);
    expect(grants[0]?.confirmations).toHaveLength(1);
    for (const field of grants[0]?.fields ?? []) {
      expect(field.encryptionKeyVersion).toBe("reveal-pii-v1");
      expect(field.schemaVersion).toBe("v1");
      expect(field.nonce).toHaveLength(12);
      expect(field.authTag).toHaveLength(16);
      expect(field.ciphertext.length).toBeGreaterThan(0);
      expect(field.integrityHmac).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(JSON.stringify(grants)).not.toContain(fixture.displayName);
    expect(JSON.stringify(grants)).not.toContain(fixture.email);

    await expect(
      getEmployerRadarRequestView(db(), employerViewInput(fixture)),
    ).resolves.toMatchObject({
      identity: [
        { field: "DISPLAY_NAME", value: fixture.displayName },
        { field: "EMAIL", value: fixture.email },
      ],
      revealStatus: "ACTIVE",
    });

    await db().candidateProfile.update({
      where: { id: fixture.candidateProfileId },
      data: { publicDisplayName: "Changed Live Name" },
    });
    await db().user.update({
      where: { id: fixture.candidateUserId },
      data: {
        email: "changed-live-email@example.test",
        emailNormalized: "changed-live-email@example.test",
      },
    });
    await expect(
      getEmployerRadarRequestView(db(), employerViewInput(fixture)),
    ).resolves.toMatchObject({
      identity: [
        { field: "DISPLAY_NAME", value: fixture.displayName },
        { field: "EMAIL", value: fixture.email },
      ],
      revealStatus: "ACTIVE",
    });
  });

  it("supports add-only field confirmation and rejects token tamper and replay", async () => {
    const fixture = await createPendingContactFixture("add-only");
    await acceptFixture(fixture, "add-only-accept");
    const displayPreview = await preview(fixture, ["DISPLAY_NAME"]);
    const tamperedToken = tamper(displayPreview.confirmationToken);

    await expect(
      grantRevealFields(
        db(),
        {
          actorUserId: fixture.candidateUserId,
          contactRequestId: fixture.contactRequestId,
          confirmationToken: tamperedToken,
          idempotencyKey: "tampered-confirmation-v1",
          now: NOW,
        },
        { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_CONFIRMATION" });

    const first = await grantRevealFields(
      db(),
      {
        actorUserId: fixture.candidateUserId,
        contactRequestId: fixture.contactRequestId,
        confirmationToken: displayPreview.confirmationToken,
        idempotencyKey: "display-confirmation-v1",
        now: NOW,
      },
      { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
    );
    expect(first).toMatchObject({
      ok: true,
      newlyAddedFields: ["DISPLAY_NAME"],
      completeFieldSet: ["DISPLAY_NAME"],
      replay: false,
    });
    if (!first.ok) throw new Error("The first Reveal confirmation failed.");

    await expect(
      grantRevealFields(
        db(),
        {
          actorUserId: fixture.candidateUserId,
          contactRequestId: fixture.contactRequestId,
          confirmationToken: displayPreview.confirmationToken,
          idempotencyKey: "display-confirmation-v1",
          now: new Date(NOW.getTime() + 1_000),
        },
        { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
      ),
    ).resolves.toMatchObject({ ok: true, grantId: first.grantId, replay: true });
    await expect(
      grantRevealFields(
        db(),
        {
          actorUserId: fixture.candidateUserId,
          contactRequestId: fixture.contactRequestId,
          confirmationToken: displayPreview.confirmationToken,
          idempotencyKey: "display-replay-new-key-v1",
          now: new Date(NOW.getTime() + 2_000),
        },
        { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_CONFIRMATION" });

    const emailPreview = await preview(
      fixture,
      ["EMAIL"],
      new Date(NOW.getTime() + 3_000),
    );
    const second = await grantRevealFields(
      db(),
      {
        actorUserId: fixture.candidateUserId,
        contactRequestId: fixture.contactRequestId,
        confirmationToken: emailPreview.confirmationToken,
        idempotencyKey: "email-confirmation-v1",
        now: new Date(NOW.getTime() + 3_000),
      },
      { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
    );
    expect(second).toEqual({
      ok: true,
      grantId: first.grantId,
      newlyAddedFields: ["EMAIL"],
      completeFieldSet: ["DISPLAY_NAME", "EMAIL"],
      replay: false,
    });
    await expect(
      db().identityRevealGrant.count({
        where: { contactRequestId: fixture.contactRequestId },
      }),
    ).resolves.toBe(1);
    await expect(
      db().identityRevealGrantField.count({ where: { grantId: first.grantId } }),
    ).resolves.toBe(2);
    await expect(
      db().identityRevealConfirmation.count({ where: { grantId: first.grantId } }),
    ).resolves.toBe(2);
  });

  it("rejects a stale preview and writes no partial Reveal state", async () => {
    const fixture = await createPendingContactFixture("stale");
    await acceptFixture(fixture, "stale-accept");
    const emailPreview = await preview(fixture, ["EMAIL"]);

    await db().user.update({
      where: { id: fixture.candidateUserId },
      data: {
        email: "stale-preview-changed@example.test",
        emailNormalized: "stale-preview-changed@example.test",
      },
    });
    await expect(
      grantRevealFields(
        db(),
        {
          actorUserId: fixture.candidateUserId,
          contactRequestId: fixture.contactRequestId,
          confirmationToken: emailPreview.confirmationToken,
          idempotencyKey: "stale-confirmation-v1",
          now: new Date(NOW.getTime() + 1_000),
        },
        { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
      ),
    ).resolves.toEqual({ ok: false, code: "STALE_REVEAL_PREVIEW" });
    await expect(
      db().identityRevealGrant.count({
        where: { contactRequestId: fixture.contactRequestId },
      }),
    ).resolves.toBe(0);
    await expect(
      db().identityRevealConfirmation.count({
        where: { contactRequestId: fixture.contactRequestId },
      }),
    ).resolves.toBe(0);
  });

  it("enforces current trust, tenant scope, candidate ownership and idempotent revocation", async () => {
    const fixture = await createPendingContactFixture("scope-a");
    const other = await createPendingContactFixture("scope-b");
    await acceptFixture(fixture, "scope-a-accept");
    const emailPreview = await preview(fixture, ["EMAIL"]);

    await expect(
      buildCandidateRevealPreview(
        db(),
        {
          actorUserId: other.candidateUserId,
          contactRequestId: fixture.contactRequestId,
          fields: ["EMAIL"],
          now: NOW,
        },
        CONFIRMATION_KEYS,
      ),
    ).resolves.toEqual({ ok: false, code: "UNAVAILABLE" });
    await expect(
      grantRevealFields(
        db(),
        {
          actorUserId: other.candidateUserId,
          contactRequestId: fixture.contactRequestId,
          confirmationToken: emailPreview.confirmationToken,
          idempotencyKey: "cross-candidate-grant-v1",
          now: NOW,
        },
        { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
      ),
    ).resolves.toEqual({ ok: false, code: "UNAVAILABLE" });

    const granted = await grantRevealFields(
      db(),
      {
        actorUserId: fixture.candidateUserId,
        contactRequestId: fixture.contactRequestId,
        confirmationToken: emailPreview.confirmationToken,
        idempotencyKey: "scope-a-confirmation-v1",
        now: NOW,
      },
      { confirmation: CONFIRMATION_KEYS, pii: PII_KEYS },
    );
    if (!granted.ok) throw new Error("The scoped Reveal confirmation failed.");
    await expect(
      getEmployerRadarRequestView(db(), employerViewInput(fixture)),
    ).resolves.toMatchObject({
      identity: [{ field: "EMAIL", value: fixture.email }],
      revealStatus: "ACTIVE",
    });
    await expect(
      getEmployerRadarRequestView(db(), {
        actorUserId: other.employerUserId,
        companyId: other.companyId,
        requestId: fixture.contactRequestId,
        piiKeys: PII_KEYS,
      }),
    ).resolves.toBeNull();
    await expect(
      getEmployerRadarRequestView(db(), {
        actorUserId: other.employerUserId,
        companyId: fixture.companyId,
        requestId: fixture.contactRequestId,
        piiKeys: PII_KEYS,
      }),
    ).resolves.toBeNull();

    await db().company.update({
      where: { id: fixture.companyId },
      data: { status: "SUSPENDED" },
    });
    await expect(
      getEmployerRadarRequestView(db(), employerViewInput(fixture)),
    ).resolves.toMatchObject({ identity: [], revealStatus: "TRUST_BLOCKED" });
    await db().company.update({
      where: { id: fixture.companyId },
      data: { status: "ACTIVE" },
    });

    await expect(
      revokeIdentityReveal(db(), {
        actorUserId: other.candidateUserId,
        grantId: granted.grantId,
        reasonCode: "PRIVACY_CHOICE",
        confirmationVersion: "identity-reveal-revoke-v1",
        idempotencyKey: "cross-candidate-revoke-v1",
        now: new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toEqual({ ok: false, code: "UNAVAILABLE" });
    await expect(
      revokeIdentityReveal(db(), {
        actorUserId: fixture.candidateUserId,
        grantId: granted.grantId,
        reasonCode: "PRIVACY_CHOICE",
        confirmationVersion: "identity-reveal-revoke-v1",
        idempotencyKey: "candidate-revoke-v1",
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).resolves.toEqual({ ok: true, revoked: true });
    await expect(
      revokeIdentityReveal(db(), {
        actorUserId: fixture.candidateUserId,
        grantId: granted.grantId,
        reasonCode: "PRIVACY_CHOICE",
        confirmationVersion: "identity-reveal-revoke-v1",
        idempotencyKey: "candidate-revoke-v1",
        now: new Date(NOW.getTime() + 3_000),
      }),
    ).resolves.toEqual({ ok: true, revoked: false });
    await expect(
      getEmployerRadarRequestView(db(), employerViewInput(fixture)),
    ).resolves.toMatchObject({ identity: [], revealStatus: "REVOKED" });
    await expect(
      db().auditLog.findMany({
        where: {
          targetId: granted.grantId,
          action: { in: ["IDENTITY_REVEALED", "IDENTITY_REVEAL_REVOKED"] },
        },
        orderBy: { createdAt: "asc" },
        select: { action: true, targetType: true },
      }),
    ).resolves.toEqual([
      {
        action: "IDENTITY_REVEALED",
        targetType: "IDENTITY_REVEAL_GRANT",
      },
      {
        action: "IDENTITY_REVEAL_REVOKED",
        targetType: "IDENTITY_REVEAL_GRANT",
      },
    ]);
  });
});

type ContactFixture = Readonly<{
  candidateUserId: string;
  candidateProfileId: string;
  employerUserId: string;
  companyId: string;
  contactRequestId: string;
  displayName: string;
  email: string;
}>;

async function createPendingContactFixture(suffix: string): Promise<ContactFixture> {
  fixtureSequence += 1;
  const email = `phase14-reveal-${suffix}@example.test`;
  const displayName = `Reveal ${suffix} Candidate`;
  const candidate = await db().user.create({
    data: {
      email,
      emailNormalized: email,
      role: "CANDIDATE",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
  const employerEmail = `phase14-employer-${suffix}@example.test`;
  const employer = await db().user.create({
    data: {
      email: employerEmail,
      emailNormalized: employerEmail,
      role: "EMPLOYER",
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: NOW,
    },
  });
  const candidateProfile = await db().candidateProfile.create({
    data: {
      userId: candidate.id,
      firstName: "Reveal",
      lastName: "Candidate",
      publicDisplayName: displayName,
      phone: "+41791234567",
    },
  });
  const company = await db().company.create({
    data: {
      name: `Phase 14 ${suffix} AG`,
      slug: `phase-14-${suffix}-ag`,
      industry: "Technology",
      size: "11-50",
      website: `https://phase-14-${suffix}.example.test`,
      about: "Isolated Talent Radar Reveal integration fixture.",
      values: [],
      benefits: [],
      dataProvenance: "TEST",
    },
  });
  const canton = await db().canton.create({
    data: {
      code: `R${fixtureSequence}`,
      name: `Reveal Canton ${fixtureSequence}`,
      slug: `reveal-canton-${fixtureSequence}`,
      language: "DE",
    },
  });
  const city = await db().city.create({
    data: {
      cantonId: canton.id,
      name: `Reveal City ${fixtureSequence}`,
      slug: `reveal-city-${fixtureSequence}`,
    },
  });
  await db().companyLocation.create({
    data: {
      companyId: company.id,
      cantonId: canton.id,
      cityId: city.id,
      address: "Teststrasse 14",
      postalCode: "8000",
      isPrimary: true,
    },
  });
  const membership = await db().companyMembership.create({
    data: {
      companyId: company.id,
      userId: employer.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  await db().company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
  await db().companyVerificationRequest.create({
    data: {
      companyId: company.id,
      requestedByUserId: employer.id,
      status: "VERIFIED",
    },
  });
  const account = await db().creditAccount.create({
    data: {
      companyId: company.id,
      creditType: "TALENT_CONTACT",
      fundingSource: "ADMIN_GRANT",
      periodStart: new Date(NOW.getTime() - DAY),
      periodEnd: new Date(NOW.getTime() + 30 * DAY),
    },
  });
  const creditGrant = await db().creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "ADMIN_GRANT",
      kind: "GRANT",
      amount: 1,
      validFrom: new Date(NOW.getTime() - DAY),
      validTo: new Date(NOW.getTime() + 30 * DAY),
      idempotencyKey: `phase14-${suffix}-credit-grant`,
      actorUserId: employer.id,
    },
  });
  const creditConsumption = await db().creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "ADMIN_GRANT",
      kind: "CONSUME",
      amount: -1,
      consumedGrantEntryId: creditGrant.id,
      validFrom: new Date(NOW.getTime() - DAY),
      validTo: new Date(NOW.getTime() + 30 * DAY),
      idempotencyKey: `phase14-${suffix}-credit-consume`,
      reasonCode: "CONTACT_REQUEST",
      actorUserId: employer.id,
    },
  });
  const filterHash = createHash("sha256")
    .update(`phase14-reveal-${suffix}`, "utf8")
    .digest("hex");
  const searchSession = await db().radarSearchSession.create({
    data: {
      companyId: company.id,
      membershipId: membership.id,
      requestingUserId: employer.id,
      filterHash,
      calendarDate: new Date("2026-07-22T00:00:00.000Z"),
      policyVersion: "radar-privacy-v1",
      normalizedFilters: {},
      resultCount: 1,
      expiresAt: new Date(NOW.getTime() + 15 * 60_000),
      createdAt: NOW,
    },
  });
  await db().radarSearchSessionCandidate.create({
    data: {
      radarSearchSessionId: searchSession.id,
      candidateProfileId: candidateProfile.id,
      position: 0,
    },
  });
  const contactRequest = await db().employerContactRequest.create({
    data: {
      companyId: company.id,
      candidateProfileId: candidateProfile.id,
      radarSearchSessionId: searchSession.id,
      requestingUserId: employer.id,
      creditLedgerEntryId: creditConsumption.id,
      subject: `Contact ${suffix}`,
      messagePreview: "Privacy-safe employer contact request.",
      idempotencyKey: `phase14-${suffix}-contact-request`,
      commandFingerprint: "b".repeat(64),
      status: "PENDING",
      fundingSource: "ADMIN_GRANT",
      clusterPolicyVersion: "radar-privacy-v1",
      cantonBucketSnapshot: "ZH",
      categoryBucketSnapshot: "software-engineering",
      expiresAt: new Date(NOW.getTime() + 14 * DAY),
      terminalAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  return Object.freeze({
    candidateUserId: candidate.id,
    candidateProfileId: candidateProfile.id,
    employerUserId: employer.id,
    companyId: company.id,
    contactRequestId: contactRequest.id,
    displayName,
    email,
  });
}

async function acceptFixture(fixture: ContactFixture, idempotencyKey: string) {
  return acceptContactRequest(
    { requestId: fixture.contactRequestId, idempotencyKey },
    { userId: fixture.candidateUserId },
    { database: db(), correlationId: randomUUID(), now: NOW },
  );
}

async function preview(
  fixture: ContactFixture,
  fields: readonly ("DISPLAY_NAME" | "EMAIL" | "PHONE" | "CV_METADATA")[],
  now = NOW,
) {
  const result = await buildCandidateRevealPreview(
    db(),
    {
      actorUserId: fixture.candidateUserId,
      contactRequestId: fixture.contactRequestId,
      fields,
      now,
    },
    CONFIRMATION_KEYS,
  );
  if (!result.ok) throw new Error(`Reveal preview failed: ${result.code}`);
  return result;
}

function employerViewInput(fixture: ContactFixture) {
  return {
    actorUserId: fixture.employerUserId,
    companyId: fixture.companyId,
    requestId: fixture.contactRequestId,
    piiKeys: PII_KEYS,
  } as const;
}

function tamper(token: string) {
  const separator = token.indexOf(".");
  if (separator < 0 || separator + 4 >= token.length) {
    throw new Error("Reveal token fixture is malformed.");
  }
  const index = separator + 3;
  const replacement = token[index] === "A" ? "B" : "A";
  return `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`;
}

function db(): DatabaseClient {
  if (!database) throw new Error("Reveal integration database is unavailable.");
  return database;
}
