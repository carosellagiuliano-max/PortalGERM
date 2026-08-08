import "server-only";

import { z } from "zod";

import { isIsolatedSandboxEnvironment } from "@/lib/config/application-environment";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  ABUSE_REPORT_PRIVACY_NOTICE_V1,
  PUBLIC_INTAKE_PRIVACY_FORM_FIELDS,
  PUBLIC_INTAKE_PRIVACY_PURPOSES,
  type PublicIntakePrivacyBinding,
  type PublicIntakePrivacyExpectedBinding,
  type PublicIntakePrivacyGateDecision,
  type PublicIntakePrivacyPurpose,
} from "@/lib/privacy/public-intake-privacy-contract";
import {
  SALES_LEAD_INTAKE_POLICY_V1,
  SALES_LEAD_NOTICE_HASH_V1,
} from "@/lib/sales/lead-policy";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

type PublicIntakePrivacyEnvironment = Pick<
  ServerEnvironment,
  "APP_ENV" | "LEGAL_PUBLICATION_PRIVACY"
>;

type PublicIntakePrivacyDatabase = DatabaseClient | Prisma.TransactionClient;

/**
 * Resolves the exact privacy notice that may be shown for a public intake.
 * Local and CI are deliberately synthetic. Every public deployment class
 * requires the enabled, current and internally consistent de-CH publication.
 */
export async function resolvePublicIntakePrivacyGate(
  purpose: PublicIntakePrivacyPurpose,
  dependencies: Readonly<{
    database: PublicIntakePrivacyDatabase;
    environment: PublicIntakePrivacyEnvironment;
    now?: Date;
  }>,
): Promise<PublicIntakePrivacyGateDecision> {
  const notice = noticeFor(purpose);
  if (isIsolatedSandboxEnvironment(dependencies.environment.APP_ENV)) {
    return allowed({
      purpose,
      evidenceMode: "LOCAL_SYNTHETIC",
      legalPublicationId: null,
      publicationHash: null,
      publicationVersion: null,
      noticeVersion: notice.version,
      noticeHash: notice.hash,
      noticeText: notice.text,
    });
  }

  const now = dependencies.now ?? new Date();
  if (!dependencies.environment.LEGAL_PUBLICATION_PRIVACY) {
    return denied("FEATURE_DISABLED");
  }
  if (!Number.isFinite(now.getTime())) return denied("PUBLICATION_INVALID");

  try {
    const publications = await dependencies.database.legalPublication.findMany({
      where: {
        status: "CURRENT",
        revokedAt: null,
        effectiveAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        legalDocument: {
          type: "PRIVACY",
          locale: "de-CH",
          slug: "privacy",
        },
      },
      orderBy: { id: "asc" },
      take: 2,
      select: {
        id: true,
        publicationHash: true,
        legalDocument: {
          select: { type: true, locale: true, slug: true },
        },
        legalRevision: {
          select: {
            status: true,
            versionLabel: true,
            contentHash: true,
          },
        },
      },
    });
    const publication = publications[0];
    if (publications.length !== 1 || publication === undefined) {
      return denied("PUBLICATION_UNAVAILABLE");
    }
    if (
      publication.legalDocument.type !== "PRIVACY" ||
      publication.legalDocument.locale !== "de-CH" ||
      publication.legalDocument.slug !== "privacy" ||
      publication.legalRevision.status !== "APPROVED" ||
      !SHA256_HEX.test(publication.publicationHash) ||
      publication.publicationHash !== publication.legalRevision.contentHash
    ) {
      return denied("PUBLICATION_INVALID");
    }

    return allowed({
      purpose,
      evidenceMode: "PUBLISHED_LEGAL",
      legalPublicationId: publication.id,
      publicationHash: publication.publicationHash,
      publicationVersion: publication.legalRevision.versionLabel,
      noticeVersion: notice.version,
      noticeHash: notice.hash,
      noticeText: notice.text,
    });
  } catch {
    return denied("GATE_UNAVAILABLE");
  }
}

/** Read-only direct-action guard. It deliberately performs no rate-limit write. */
export async function preflightPublicIntakePrivacyGate(
  expected: PublicIntakePrivacyExpectedBinding,
  dependencies: Readonly<{
    database: PublicIntakePrivacyDatabase;
    environment: PublicIntakePrivacyEnvironment;
    now?: Date;
  }>,
): Promise<PublicIntakePrivacyGateDecision> {
  const current = await resolvePublicIntakePrivacyGate(expected.purpose, dependencies);
  if (!current.allowed) return current;
  return sameBinding(expected, current.binding)
    ? current
    : denied("STALE_OR_TAMPERED_BINDING");
}

/**
 * Locks and revalidates the exact publication in the mutation transaction.
 * A publication rotation or revocation therefore cannot race the evidence
 * write. Hidden form fields are only an expected value, never authority.
 */
export async function lockPublicIntakePrivacyGate(
  transaction: Prisma.TransactionClient,
  expected: PublicIntakePrivacyExpectedBinding,
  dependencies: Readonly<{
    environment: PublicIntakePrivacyEnvironment;
    now?: Date;
  }>,
): Promise<PublicIntakePrivacyGateDecision> {
  const now = dependencies.now ?? new Date();
  const first = await preflightPublicIntakePrivacyGate(expected, {
    database: transaction,
    environment: dependencies.environment,
    now,
  });
  if (!first.allowed || first.binding.evidenceMode === "LOCAL_SYNTHETIC") {
    return first;
  }

  const publicationId = first.binding.legalPublicationId;
  if (publicationId === null) return denied("PUBLICATION_INVALID");
  const locked = await transaction.$queryRaw<
    readonly Readonly<{
      publicationId: string;
      publicationHash: string;
      versionLabel: string;
      contentHash: string;
      revisionStatus: string;
      documentType: string;
      locale: string;
      slug: string;
    }>[]
  >`
    SELECT
      publication."id" AS "publicationId",
      publication."publicationHash" AS "publicationHash",
      revision."versionLabel" AS "versionLabel",
      revision."contentHash" AS "contentHash",
      revision."status"::text AS "revisionStatus",
      document."type"::text AS "documentType",
      document."locale" AS "locale",
      document."slug" AS "slug"
    FROM "LegalPublication" publication
    JOIN "LegalRevision" revision
      ON revision."id" = publication."legalRevisionId"
    JOIN "LegalDocument" document
      ON document."id" = publication."legalDocumentId"
    WHERE publication."id" = ${publicationId}::uuid
      AND publication."status" = 'CURRENT'::"LegalPublicationStatus"
      AND publication."revokedAt" IS NULL
      AND publication."effectiveAt" <= ${now}
      AND (publication."expiresAt" IS NULL OR publication."expiresAt" > ${now})
    FOR SHARE OF publication, revision, document
  `;
  const row = locked[0];
  if (
    locked.length !== 1 ||
    row === undefined ||
    row.publicationId !== first.binding.legalPublicationId ||
    row.publicationHash !== first.binding.publicationHash ||
    row.versionLabel !== first.binding.publicationVersion ||
    row.contentHash !== row.publicationHash ||
    row.revisionStatus !== "APPROVED" ||
    row.documentType !== "PRIVACY" ||
    row.locale !== "de-CH" ||
    row.slug !== "privacy"
  ) {
    return denied("STALE_OR_TAMPERED_BINDING");
  }

  const current = await resolvePublicIntakePrivacyGate(expected.purpose, {
    database: transaction,
    environment: dependencies.environment,
    now,
  });
  return current.allowed && sameBinding(first.binding, current.binding)
    ? current
    : denied("STALE_OR_TAMPERED_BINDING");
}

export function readPublicIntakePrivacyExpectedBinding(
  formData: Pick<FormData, "getAll">,
  expectedPurpose: PublicIntakePrivacyPurpose,
): PublicIntakePrivacyExpectedBinding | null {
  const raw = Object.fromEntries(
    Object.entries(PUBLIC_INTAKE_PRIVACY_FORM_FIELDS).map(([key, field]) => [
      key,
      singleString(formData, field),
    ]),
  );
  if (Object.values(raw).some((value) => value === null)) return null;

  const parsed = z
    .strictObject({
      purpose: z.enum(PUBLIC_INTAKE_PRIVACY_PURPOSES),
      evidenceMode: z.enum(["LOCAL_SYNTHETIC", "PUBLISHED_LEGAL"]),
      legalPublicationId: z.union([z.literal(""), z.uuid()]),
      publicationHash: z.union([z.literal(""), z.string().regex(SHA256_HEX)]),
      publicationVersion: z.union([
        z.literal(""),
        z.string().trim().min(1).max(32),
      ]),
      noticeVersion: z.string().trim().min(1).max(32),
      noticeHash: z.string().regex(SHA256_HEX),
    })
    .safeParse(raw);
  if (!parsed.success || parsed.data.purpose !== expectedPurpose) return null;

  const publicationFields = [
    parsed.data.legalPublicationId,
    parsed.data.publicationHash,
    parsed.data.publicationVersion,
  ];
  if (
    (parsed.data.evidenceMode === "LOCAL_SYNTHETIC" &&
      publicationFields.some((value) => value !== "")) ||
    (parsed.data.evidenceMode === "PUBLISHED_LEGAL" &&
      publicationFields.some((value) => value === ""))
  ) {
    return null;
  }

  return Object.freeze({
    purpose: parsed.data.purpose,
    evidenceMode: parsed.data.evidenceMode,
    legalPublicationId: parsed.data.legalPublicationId || null,
    publicationHash: parsed.data.publicationHash || null,
    publicationVersion: parsed.data.publicationVersion || null,
    noticeVersion: parsed.data.noticeVersion,
    noticeHash: parsed.data.noticeHash,
  });
}

export function toPublicIntakePrivacyExpectedBinding(
  binding: PublicIntakePrivacyBinding,
): PublicIntakePrivacyExpectedBinding {
  const { noticeText: _noticeText, ...expected } = binding;
  return Object.freeze(expected);
}

function noticeFor(purpose: PublicIntakePrivacyPurpose) {
  switch (purpose) {
    case "EMPLOYER_DEMO":
      return Object.freeze({
        version: SALES_LEAD_INTAKE_POLICY_V1.notice.version,
        text: SALES_LEAD_INTAKE_POLICY_V1.notice.text,
        hash: SALES_LEAD_NOTICE_HASH_V1,
      });
    case "ABUSE_REPORT":
      return ABUSE_REPORT_PRIVACY_NOTICE_V1;
    default:
      return unsupportedPurpose(purpose);
  }
}

function sameBinding(
  left: PublicIntakePrivacyExpectedBinding,
  right: PublicIntakePrivacyExpectedBinding,
) {
  return (
    left.purpose === right.purpose &&
    left.evidenceMode === right.evidenceMode &&
    left.legalPublicationId === right.legalPublicationId &&
    left.publicationHash === right.publicationHash &&
    left.publicationVersion === right.publicationVersion &&
    left.noticeVersion === right.noticeVersion &&
    left.noticeHash === right.noticeHash
  );
}

function allowed(
  binding: PublicIntakePrivacyBinding,
): Extract<PublicIntakePrivacyGateDecision, { allowed: true }> {
  return Object.freeze({ allowed: true, binding: Object.freeze(binding) });
}

function denied(
  code: Extract<PublicIntakePrivacyGateDecision, { allowed: false }>["code"],
): Extract<PublicIntakePrivacyGateDecision, { allowed: false }> {
  return Object.freeze({ allowed: false, code });
}

function singleString(formData: Pick<FormData, "getAll">, name: string) {
  const values = formData.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

function unsupportedPurpose(purpose: never): never {
  throw new Error(`Unsupported public intake privacy purpose: ${String(purpose)}`);
}
