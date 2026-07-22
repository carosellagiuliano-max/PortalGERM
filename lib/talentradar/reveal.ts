import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit } from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type { RevealField } from "@/lib/generated/prisma/enums";
import { buildNotificationPersistenceRecord } from "@/lib/notifications/writer";
import { createPostgresRevealConfirmationPort } from "@/lib/privacy/postgres-adapters";
import {
  authorizeAndRecheckRevealConfirmation,
  buildRevealPreview,
  decryptRevealValue,
  encryptRevealValues,
  REVEAL_SNAPSHOT_POLICY_V1,
  type EncryptedRevealField,
  type RevealKey,
  type RevealPreviewEvidence,
  type RevealValue,
} from "@/lib/privacy/reveal-dto";
import { canSeeRadarIdentity } from "@/lib/talentradar/can-see-identity";

const AUDIT_RETENTION_MS = 10 * 365 * 24 * 60 * 60 * 1_000;
const TOKEN_CONTEXT = "swisstalenthub:talent-radar:reveal-preview:v1";
const UUID = z.uuid();
const revealFieldsSchema = z
  .array(z.enum(["DISPLAY_NAME", "EMAIL", "PHONE", "CV_METADATA"]))
  .min(1)
  .max(4)
  .refine((fields) => new Set(fields).size === fields.length, {
    message: "Reveal fields must be unique.",
  });
const previewCommandSchema = z.strictObject({
  actorUserId: UUID,
  contactRequestId: UUID,
  fields: revealFieldsSchema,
  now: z.date(),
});
const grantCommandSchema = z.strictObject({
  actorUserId: UUID,
  contactRequestId: UUID,
  confirmationToken: z.string().min(40).max(4_096),
  idempotencyKey: z.string().trim().min(8).max(128),
  now: z.date(),
});
const revokeCommandSchema = z.strictObject({
  actorUserId: UUID,
  grantId: UUID,
  reasonCode: z.enum(["PRIVACY_CHOICE", "TRUST_CONCERN", "OTHER"]),
  confirmationVersion: z.literal("identity-reveal-revoke-v1"),
  idempotencyKey: z.string().trim().min(8).max(128),
  now: z.date(),
});
const tokenPayloadSchema = z.strictObject({
  version: z.literal("v1"),
  tokenId: UUID,
  keyVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u),
  contactRequestId: UUID,
  conversationId: UUID,
  candidateProfileId: UUID,
  companyId: UUID,
  fields: revealFieldsSchema,
  noticeVersion: z.literal(REVEAL_SNAPSHOT_POLICY_V1.noticeVersion),
  previewHmac: z.string().regex(/^[a-f0-9]{64}$/u),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

type RevealFieldName = RevealField;

export type CandidateRevealPreviewResult =
  | Readonly<{
      ok: true;
      values: readonly RevealValue[];
      confirmationToken: string;
      expiresAt: Date;
      recipientCompanyName: string;
      noticeVersion: typeof REVEAL_SNAPSHOT_POLICY_V1.noticeVersion;
    }>
  | Readonly<{
      ok: false;
      code: "UNAVAILABLE" | "FIELD_UNAVAILABLE" | "ALREADY_REVEALED";
    }>;

export type RevealGrantResult =
  | Readonly<{
      ok: true;
      grantId: string;
      newlyAddedFields: readonly RevealFieldName[];
      completeFieldSet: readonly RevealFieldName[];
      replay: boolean;
    }>
  | Readonly<{
      ok: false;
      code:
        | "UNAVAILABLE"
        | "INVALID_CONFIRMATION"
        | "STALE_REVEAL_PREVIEW"
        | "FIELD_UNAVAILABLE"
        | "ALREADY_REVEALED";
    }>;

export type EmployerRadarRequestView = Readonly<{
  requestId: string;
  subject: string;
  messagePreview: string;
  status: string;
  anonymousLabel: string;
  createdAt: Date;
  identity: readonly RevealValue[];
  revealStatus: "NONE" | "ACTIVE" | "REVOKED" | "TRUST_BLOCKED";
}>;

export async function buildCandidateRevealPreview(
  database: DatabaseClient,
  raw: unknown,
  confirmationKeys: readonly RevealKey[],
): Promise<CandidateRevealPreviewResult> {
  const parsed = previewCommandSchema.safeParse(raw);
  if (!parsed.success || !validDate(parsed.data.now)) return unavailable();
  const command = parsed.data;
  const request = await database.employerContactRequest.findFirst({
    where: {
      id: command.contactRequestId,
      status: "ACCEPTED",
      candidateProfile: { userId: command.actorUserId },
    },
    select: {
      id: true,
      companyId: true,
      candidateProfileId: true,
      company: {
        select: {
          name: true,
          status: true,
          verificationRequests: {
            where: { status: "VERIFIED", supersededBy: null },
            take: 2,
            select: { id: true },
          },
        },
      },
      candidateProfile: { select: { user: { select: { status: true } } } },
      conversation: { select: { id: true, kind: true } },
      revealGrant: {
        select: {
          revokedAt: true,
          fields: { select: { field: true } },
        },
      },
    },
  });
  if (
    request === null ||
    request.conversation?.kind !== "TALENT_RADAR" ||
    request.company.status !== "ACTIVE" ||
    request.company.verificationRequests.length !== 1 ||
    request.candidateProfile.user.status !== "ACTIVE" ||
    request.revealGrant?.revokedAt != null
  ) {
    return unavailable();
  }
  const existing = new Set(
    request.revealGrant?.fields.map(({ field }) => field) ?? [],
  );
  if (command.fields.some((field) => existing.has(field))) {
    return Object.freeze({ ok: false, code: "ALREADY_REVEALED" });
  }
  const values = await loadCurrentRevealValues(
    database,
    request.candidateProfileId,
    command.fields,
  );
  if (values === null) {
    return Object.freeze({ ok: false, code: "FIELD_UNAVAILABLE" });
  }
  const preview = buildRevealPreview(
    values,
    {
      contactRequestId: request.id,
      conversationId: request.conversation.id,
      candidateProfileId: request.candidateProfileId,
      companyId: request.companyId,
    },
    confirmationKeys,
    command.now,
  );
  return Object.freeze({
    ok: true,
    values: preview.values,
    confirmationToken: signPreviewToken(preview.evidence, command.now, confirmationKeys),
    expiresAt: new Date(preview.evidence.expiresAt),
    recipientCompanyName: request.company.name,
    noticeVersion: REVEAL_SNAPSHOT_POLICY_V1.noticeVersion,
  });
}

export async function grantRevealFields(
  database: DatabaseClient,
  raw: unknown,
  keys: Readonly<{
    confirmation: readonly RevealKey[];
    pii: readonly RevealKey[];
  }>,
): Promise<RevealGrantResult> {
  const parsed = grantCommandSchema.safeParse(raw);
  if (!parsed.success || !validDate(parsed.data.now)) return unavailable();
  const command = parsed.data;
  const token = verifyPreviewToken(
    command.confirmationToken,
    keys.confirmation,
    command.now,
  );
  if (token === null || token.contactRequestId !== command.contactRequestId) {
    return Object.freeze({ ok: false, code: "INVALID_CONFIRMATION" });
  }
  const tokenDigest = digestToken(command.confirmationToken);
  const port = createPostgresRevealConfirmationPort(database);
  const result = await port.withLockedAuthorization(
    {
      actorUserId: command.actorUserId,
      contactRequestId: command.contactRequestId,
      conversationId: token.conversationId,
    },
    async (authorization, transaction) => {
      const replay = await transaction.identityRevealConfirmation.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
        select: {
          grantId: true,
          contactRequestId: true,
          confirmationTokenDigest: true,
          newlyAddedFields: true,
          completeFieldSet: true,
        },
      });
      if (replay !== null) {
        return replay.contactRequestId === command.contactRequestId &&
          replay.confirmationTokenDigest === tokenDigest
          ? Object.freeze({
              ok: true as const,
              grantId: replay.grantId,
              newlyAddedFields: Object.freeze([...replay.newlyAddedFields]),
              completeFieldSet: Object.freeze([...replay.completeFieldSet]),
              replay: true,
            })
          : Object.freeze({
              ok: false as const,
              code: "INVALID_CONFIRMATION" as const,
            });
      }
      const consumed = await transaction.identityRevealConfirmation.findUnique({
        where: { confirmationTokenDigest: tokenDigest },
        select: { id: true },
      });
      if (consumed !== null) {
        return Object.freeze({
          ok: false as const,
          code: "INVALID_CONFIRMATION" as const,
        });
      }
      if (
        token.candidateProfileId !== authorization.candidateProfileId ||
        token.companyId !== authorization.companyId ||
        token.conversationId !== authorization.requestConversationId
      ) {
        return Object.freeze({
          ok: false as const,
          code: "INVALID_CONFIRMATION" as const,
        });
      }
      const currentValues = await loadCurrentRevealValues(
        transaction,
        authorization.candidateProfileId,
        token.fields,
      );
      if (currentValues === null) {
        return Object.freeze({
          ok: false as const,
          code: "FIELD_UNAVAILABLE" as const,
        });
      }
      const evidence = tokenToEvidence(token);
      const checked = authorizeAndRecheckRevealConfirmation(
        {
          contactRequestId: token.contactRequestId,
          conversationId: token.conversationId,
          fields: token.fields,
          noticeVersion: token.noticeVersion,
          previewHmac: token.previewHmac,
          idempotencyKey: command.idempotencyKey,
        },
        currentValues,
        evidence,
        keys.confirmation,
        authorization,
        command.now,
      );
      if (!checked.ok) {
        return Object.freeze({
          ok: false as const,
          code:
            checked.code === "STALE_REVEAL_PREVIEW"
              ? ("STALE_REVEAL_PREVIEW" as const)
              : ("INVALID_CONFIRMATION" as const),
        });
      }
      const existingGrant = await transaction.identityRevealGrant.findUnique({
        where: { contactRequestId: command.contactRequestId },
        select: {
          id: true,
          revokedAt: true,
          fields: { select: { field: true } },
        },
      });
      if (existingGrant?.revokedAt != null) return unavailable();
      const existingFields = existingGrant?.fields.map(({ field }) => field) ?? [];
      if (token.fields.some((field) => existingFields.includes(field))) {
        return Object.freeze({
          ok: false as const,
          code: "ALREADY_REVEALED" as const,
        });
      }
      const grantId = existingGrant?.id ?? randomUUID();
      if (existingGrant === null) {
        await transaction.identityRevealGrant.create({
          data: {
            id: grantId,
            candidateProfileId: authorization.candidateProfileId,
            companyId: authorization.companyId,
            contactRequestId: authorization.requestId,
            conversationId: authorization.requestConversationId,
            noticeVersion: token.noticeVersion,
            confirmationSnapshotHash: token.previewHmac,
            revealedAt: command.now,
          },
        });
      }
      const encrypted = encryptRevealValues(
        checked.values,
        keys.pii,
        {
          grantId,
          candidateProfileId: authorization.candidateProfileId,
          companyId: authorization.companyId,
          contactRequestId: authorization.requestId,
        },
      );
      for (const field of encrypted) {
        await transaction.identityRevealGrantField.create({
          data: {
            grantId,
            field: field.field,
            ciphertext: Uint8Array.from(field.ciphertext),
            nonce: Uint8Array.from(field.nonce),
            authTag: Uint8Array.from(field.authTag),
            encryptionKeyVersion: field.encryptionKeyVersion,
            schemaVersion: field.schemaVersion,
            integrityHmac: field.integrityHmac,
            createdAt: command.now,
          },
        });
      }
      const completeFieldSet = Object.freeze(
        [...existingFields, ...token.fields].sort() as RevealFieldName[],
      );
      await transaction.identityRevealConfirmation.create({
        data: {
          grantId,
          actorUserId: command.actorUserId,
          contactRequestId: command.contactRequestId,
          conversationId: token.conversationId,
          completeFieldSet: [...completeFieldSet],
          newlyAddedFields: [...token.fields],
          noticeVersion: token.noticeVersion,
          previewHmac: token.previewHmac,
          confirmationKeyVersion: token.keyVersion,
          confirmationTokenDigest: tokenDigest,
          idempotencyKey: command.idempotencyKey,
          createdAt: command.now,
        },
      });
      await transaction.contactRequestEvent.create({
        data: {
          contactRequestId: command.contactRequestId,
          kind: "REVEAL_GRANTED",
          actorUserId: command.actorUserId,
          reasonCode: "CANDIDATE_CONFIRMED_FIELDS",
          correlationId: token.tokenId,
          idempotencyKey: `reveal:${command.idempotencyKey}`,
          createdAt: command.now,
        },
      });
      const request = await transaction.employerContactRequest.findUniqueOrThrow({
        where: { id: command.contactRequestId },
        select: { requestingUserId: true },
      });
      const notification = buildNotificationPersistenceRecord({
        recipientUserId: request.requestingUserId,
        kind: "IDENTITY_REVEAL_GRANTED",
        dedupeKey: `reveal-granted:${command.idempotencyKey}`,
        payload: {
          contactRequestId: command.contactRequestId,
          grantId,
          status: "GRANTED",
        },
      });
      await transaction.notification.upsert({
        where: {
          recipientUserId_kind_dedupeKey: {
            recipientUserId: notification.recipientUserId,
            kind: notification.kind,
            dedupeKey: notification.dedupeKey,
          },
        },
        update: {},
        create: {
          ...notification,
          payload: notification.payload as Prisma.InputJsonObject,
        },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "IDENTITY_REVEALED",
        actorKind: "USER",
        actorUserId: command.actorUserId,
        capability: "CANDIDATE_IDENTITY_REVEAL",
        companyId: authorization.companyId,
        correlationId: token.tokenId,
        reasonCode: "CANDIDATE_CONFIRMED_FIELDS",
        result: "SUCCEEDED",
        retainUntil: new Date(command.now.getTime() + AUDIT_RETENTION_MS),
        targetId: grantId,
        targetType: "IDENTITY_REVEAL_GRANT",
      });
      return Object.freeze({
        ok: true as const,
        grantId,
        newlyAddedFields: Object.freeze([...token.fields]),
        completeFieldSet,
        replay: false,
      });
    },
  );
  return result.authorized ? result.value : unavailable();
}

export async function revokeIdentityReveal(
  database: DatabaseClient,
  raw: unknown,
): Promise<Readonly<{ ok: true; revoked: boolean }> | Readonly<{ ok: false; code: "UNAVAILABLE" }>> {
  const parsed = revokeCommandSchema.safeParse(raw);
  if (!parsed.success || !validDate(parsed.data.now)) return unavailable();
  const command = parsed.data;
  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "IdentityRevealGrant"
      WHERE "id" = ${command.grantId}::uuid FOR UPDATE
    `;
    const grant = await transaction.identityRevealGrant.findFirst({
      where: {
        id: command.grantId,
        candidateProfile: { userId: command.actorUserId },
      },
      select: {
        id: true,
        revokedAt: true,
        companyId: true,
        contactRequestId: true,
        contactRequest: { select: { requestingUserId: true } },
      },
    });
    if (grant === null) return unavailable();
    if (grant.revokedAt !== null) {
      return Object.freeze({ ok: true as const, revoked: false });
    }
    const changed = await transaction.identityRevealGrant.updateMany({
      where: { id: grant.id, revokedAt: null },
      data: {
        revokedAt: command.now,
        revokedByUserId: command.actorUserId,
        revokeReason: command.reasonCode,
      },
    });
    if (changed.count !== 1) return unavailable();
    const notification = buildNotificationPersistenceRecord({
      recipientUserId: grant.contactRequest.requestingUserId,
      kind: "IDENTITY_REVEAL_REVOKED",
      dedupeKey: `reveal-revoked:${command.idempotencyKey}`,
      payload: {
        contactRequestId: grant.contactRequestId,
        grantId: grant.id,
        status: "REVOKED",
      },
    });
    await transaction.notification.upsert({
      where: {
        recipientUserId_kind_dedupeKey: {
          recipientUserId: notification.recipientUserId,
          kind: notification.kind,
          dedupeKey: notification.dedupeKey,
        },
      },
      update: {},
      create: {
        ...notification,
        payload: notification.payload as Prisma.InputJsonObject,
      },
    });
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "IDENTITY_REVEAL_REVOKED",
      actorKind: "USER",
      actorUserId: command.actorUserId,
      capability: "CANDIDATE_IDENTITY_REVOKE",
      companyId: grant.companyId,
      correlationId: randomUUID(),
      reasonCode: command.reasonCode,
      result: "SUCCEEDED",
      retainUntil: new Date(command.now.getTime() + AUDIT_RETENTION_MS),
      targetId: grant.id,
      targetType: "IDENTITY_REVEAL_GRANT",
    });
    return Object.freeze({ ok: true as const, revoked: true });
  });
}

/** Loads encrypted snapshots only; live Candidate identity is never selected. */
export async function getEmployerRadarRequestView(
  database: DatabaseClient,
  input: Readonly<{
    actorUserId: string;
    companyId: string;
    requestId: string;
    piiKeys: readonly RevealKey[];
  }>,
): Promise<EmployerRadarRequestView | null> {
  if (![input.actorUserId, input.companyId, input.requestId].every((id) => UUID.safeParse(id).success)) {
    return null;
  }
  const membership = await database.companyMembership.findFirst({
    where: {
      companyId: input.companyId,
      userId: input.actorUserId,
      status: "ACTIVE",
      role: { in: ["OWNER", "ADMIN", "RECRUITER"] },
      user: { status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (membership === null) return null;
  const request = await database.employerContactRequest.findFirst({
    where: { id: input.requestId, companyId: input.companyId },
    select: {
      id: true,
      subject: true,
      messagePreview: true,
      status: true,
      categoryBucketSnapshot: true,
      cantonBucketSnapshot: true,
      createdAt: true,
      companyId: true,
      candidateProfileId: true,
      company: {
        select: {
          status: true,
          verificationRequests: {
            where: { status: "VERIFIED", supersededBy: null },
            take: 2,
            select: { id: true },
          },
        },
      },
      candidateProfile: { select: { user: { select: { status: true } } } },
      conversation: { select: { id: true, kind: true } },
      revealGrant: {
        select: {
          id: true,
          contactRequestId: true,
          companyId: true,
          candidateProfileId: true,
          conversationId: true,
          revokedAt: true,
          fields: {
            orderBy: { field: "asc" },
            select: {
              field: true,
              ciphertext: true,
              nonce: true,
              authTag: true,
              encryptionKeyVersion: true,
              schemaVersion: true,
              integrityHmac: true,
            },
          },
        },
      },
    },
  });
  if (request === null) return null;
  const grant = request.revealGrant;
  const conversationId = request.conversation?.id ?? null;
  const guard =
    grant !== null &&
    canSeeRadarIdentity({
      candidateUserStatus: request.candidateProfile.user.status,
      companyStatus: request.company.status,
      companyVerificationCount: request.company.verificationRequests.length,
      conversationKind: request.conversation?.kind ?? "NONE",
      requestId: request.id,
      requestStatus: request.status,
      requestCompanyId: request.companyId,
      requestCandidateProfileId: request.candidateProfileId,
      requestConversationId: conversationId,
      grantRequestId: grant.contactRequestId,
      grantCompanyId: grant.companyId,
      grantCandidateProfileId: grant.candidateProfileId,
      grantConversationId: grant.conversationId,
      viewerCompanyId: input.companyId,
      revokedAt: grant.revokedAt,
    });
  let identity: readonly RevealValue[] = Object.freeze([]);
  if (guard && grant !== null) {
    identity = Object.freeze(
      grant.fields.map((field) =>
        decryptRevealValue(
          {
            field: field.field,
            ciphertext: Uint8Array.from(field.ciphertext),
            nonce: Uint8Array.from(field.nonce),
            authTag: Uint8Array.from(field.authTag),
            encryptionKeyVersion: field.encryptionKeyVersion,
            schemaVersion: field.schemaVersion as "v1",
            integrityHmac: field.integrityHmac,
          } satisfies EncryptedRevealField,
          input.piiKeys,
          {
            grantId: grant.id,
            candidateProfileId: request.candidateProfileId,
            companyId: request.companyId,
            contactRequestId: request.id,
          },
        ),
      ),
    );
  }
  return Object.freeze({
    requestId: request.id,
    subject: request.subject,
    messagePreview: request.messagePreview,
    status: request.status,
    anonymousLabel: `${request.categoryBucketSnapshot} · ${request.cantonBucketSnapshot}`,
    createdAt: new Date(request.createdAt),
    identity,
    revealStatus:
      grant === null
        ? "NONE"
        : grant.revokedAt !== null
          ? "REVOKED"
          : guard
            ? "ACTIVE"
            : "TRUST_BLOCKED",
  });
}

async function loadCurrentRevealValues(
  database: Prisma.TransactionClient | DatabaseClient,
  candidateProfileId: string,
  fields: readonly RevealFieldName[],
): Promise<readonly RevealValue[] | null> {
  const profile = await database.candidateProfile.findUnique({
    where: { id: candidateProfileId },
    select: {
      firstName: true,
      lastName: true,
      publicDisplayName: true,
      phone: true,
      user: { select: { emailNormalized: true } },
      documents: {
        where: { purpose: "CV", status: "ACTIVE" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { safeFilename: true, mimeType: true, sizeBytes: true },
      },
    },
  });
  if (profile === null) return null;
  const values: RevealValue[] = [];
  for (const field of fields) {
    switch (field) {
      case "DISPLAY_NAME": {
        const value =
          profile.publicDisplayName?.trim() ||
          [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
        if (!value) return null;
        values.push({ field, value });
        break;
      }
      case "EMAIL":
        if (!profile.user.emailNormalized) return null;
        values.push({ field, value: profile.user.emailNormalized });
        break;
      case "PHONE": {
        const value = profile.phone?.replace(/[^+\d]/gu, "") ?? "";
        if (!/^\+[1-9]\d{6,14}$/u.test(value)) return null;
        values.push({ field, value });
        break;
      }
      case "CV_METADATA": {
        const document = profile.documents[0];
        if (
          document === undefined ||
          ![
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/webp",
          ].includes(document.mimeType)
        ) {
          return null;
        }
        values.push({
          field,
          value: {
            fileName: document.safeFilename,
            mimeType: document.mimeType as
              | "application/pdf"
              | "image/png"
              | "image/jpeg"
              | "image/webp",
            sizeBytes: document.sizeBytes,
          },
        });
        break;
      }
    }
  }
  return Object.freeze(values);
}

function signPreviewToken(
  evidence: RevealPreviewEvidence,
  now: Date,
  keyring: readonly RevealKey[],
): string {
  const key = keyring.find(({ version }) => version === evidence.confirmationKeyVersion);
  if (key === undefined) throw new TypeError("Reveal confirmation writer is missing.");
  const payload = tokenPayloadSchema.parse({
    version: "v1",
    tokenId: randomUUID(),
    keyVersion: key.version,
    contactRequestId: evidence.contactRequestId,
    conversationId: evidence.conversationId,
    candidateProfileId: evidence.candidateProfileId,
    companyId: evidence.companyId,
    fields: evidence.fields,
    noticeVersion: evidence.noticeVersion,
    previewHmac: evidence.previewHmac,
    issuedAt: now.getTime(),
    expiresAt: evidence.expiresAt.getTime(),
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${tokenSignature(encoded, key).toString("base64url")}`;
}

function verifyPreviewToken(
  token: string,
  keyring: readonly RevealKey[],
  now: Date,
): z.infer<typeof tokenPayloadSchema> | null {
  try {
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra !== undefined) return null;
    const supplied = Buffer.from(signature, "base64url");
    const payload = tokenPayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    const key = keyring.find(({ version }) => version === payload.keyVersion);
    if (key === undefined) return null;
    const expected = tokenSignature(encoded, key);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return null;
    }
    if (
      payload.expiresAt !==
        payload.issuedAt + REVEAL_SNAPSHOT_POLICY_V1.previewLifetimeMinutes * 60_000 ||
      payload.issuedAt > now.getTime() + 30_000 ||
      now.getTime() >= payload.expiresAt
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function tokenToEvidence(
  token: z.infer<typeof tokenPayloadSchema>,
): RevealPreviewEvidence {
  return Object.freeze({
    contactRequestId: token.contactRequestId,
    conversationId: token.conversationId,
    candidateProfileId: token.candidateProfileId,
    companyId: token.companyId,
    fields: Object.freeze([...token.fields]),
    noticeVersion: token.noticeVersion,
    confirmationKeyVersion: token.keyVersion,
    previewHmac: token.previewHmac,
    expiresAt: new Date(token.expiresAt),
    usedAt: null,
  });
}

function tokenSignature(encoded: string, key: RevealKey): Buffer {
  const secret = Buffer.from(key.secret, "base64");
  if (secret.length !== 32 || secret.toString("base64") !== key.secret) {
    throw new TypeError("Reveal confirmation key is invalid.");
  }
  return createHmac("sha256", secret)
    .update(`${TOKEN_CONTEXT}\0${key.version}\0${encoded}`, "utf8")
    .digest();
}

function digestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function unavailable(): Readonly<{ ok: false; code: "UNAVAILABLE" }> {
  return Object.freeze({ ok: false, code: "UNAVAILABLE" });
}
