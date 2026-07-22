import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { DatabaseClient } from "@/lib/db/factory";
import type {
  DataProvenance,
  RequiredDocumentKind,
} from "@/lib/generated/prisma/enums";
import {
  buildApplicationConfirmationProjection,
  sha256Utf8,
  type ApplicationConfirmationProjection,
} from "@/lib/applications/integrity";
import { publicApplicationHref } from "@/lib/jobs/job-json-ld";
import {
  isJobPubliclyEligibleInTransaction,
  type PublicEligibilityEnvironment,
} from "@/lib/jobs/public-eligibility";

export {
  applicationSubmissionPayloadHash,
  buildApplicationConfirmationProjection,
  sha256Utf8,
} from "@/lib/applications/integrity";
export type { ApplicationConfirmationProjection } from "@/lib/applications/integrity";

export const P0_APPLICATION_DOCUMENT_KINDS = Object.freeze([
  "NONE",
  "CV",
  "COVER_LETTER",
] as const);

export type ApplicationConfirmationView = Readonly<{
  profileId: string;
  userId: string;
  candidateProvenance: DataProvenance;
  jobId: string;
  companyId: string;
  companyProvenance: DataProvenance;
  jobProvenance: DataProvenance;
  projection: ApplicationConfirmationProjection;
  documents: readonly Readonly<{
    id: string;
    safeFilename: string;
    mimeType: string;
    sizeBytes: number;
    storageKeyHash: string;
  }>[];
  externalApplyHref: string | null;
  identityComplete: boolean;
}>;

export type LoadApplicationConfirmationResult =
  | Readonly<{ ok: true; value: ApplicationConfirmationView }>
  | Readonly<{
      ok: false;
      code:
        | "NOT_ELIGIBLE"
        | "PROFILE_MISSING"
        | "UNSUPPORTED_REQUIREMENTS"
        | "UNSAFE_CONTACT";
    }>;

export async function getApplicationConfirmationView(
  input: Readonly<{
    candidateUserId: string;
    jobSlug: string;
    now: Date;
    environment: PublicEligibilityEnvironment;
  }>,
  database: DatabaseClient,
): Promise<LoadApplicationConfirmationResult> {
  return database.$transaction(
    (transaction) => loadApplicationConfirmationInTransaction(input, transaction),
    { isolationLevel: "RepeatableRead" },
  );
}

export async function loadApplicationConfirmationInTransaction(
  input: Readonly<{
    candidateUserId: string;
    jobSlug: string;
    now: Date;
    environment: PublicEligibilityEnvironment;
  }>,
  transaction: Prisma.TransactionClient,
): Promise<LoadApplicationConfirmationResult> {
  const profile = await transaction.candidateProfile.findUnique({
      where: { userId: input.candidateUserId },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        user: {
          select: { email: true, status: true, dataProvenance: true },
        },
        documents: {
          where: { status: "ACTIVE", purpose: "CV" },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            storageKey: true,
            safeFilename: true,
            mimeType: true,
            sizeBytes: true,
          },
        },
      },
    });
  const job = await transaction.job.findUnique({
      where: { slug: input.jobSlug },
      select: {
        id: true,
        slug: true,
        companyId: true,
        dataProvenance: true,
        company: {
          select: { name: true, dataProvenance: true },
        },
        publishedRevision: {
          select: {
            id: true,
            title: true,
            requiredDocumentKinds: true,
            responseTargetDays: true,
            applicationEffort: true,
            applicationContactKind: true,
            applicationContactValue: true,
          },
        },
      },
    });
  if (profile === null || profile.user.status !== "ACTIVE") {
    return Object.freeze({ ok: false, code: "PROFILE_MISSING" });
  }
  if (job === null || job.publishedRevision === null) {
    return Object.freeze({ ok: false, code: "NOT_ELIGIBLE" });
  }
  const eligibility = await isJobPubliclyEligibleInTransaction(
    job.id,
    input.now,
    input.environment,
    transaction,
  );
  if (!eligibility.eligible) {
    return Object.freeze({ ok: false, code: "NOT_ELIGIBLE" });
  }
  if (!isSupportedRequiredDocumentContract(job.publishedRevision.requiredDocumentKinds)) {
    return Object.freeze({ ok: false, code: "UNSUPPORTED_REQUIREMENTS" });
  }
  const contactHref = publicApplicationHref(job.publishedRevision);
  if (contactHref === null) {
    return Object.freeze({ ok: false, code: "UNSAFE_CONTACT" });
  }
  const firstName = snapshotIdentity(profile.firstName);
  const lastName = snapshotIdentity(profile.lastName);
  const projection = buildApplicationConfirmationProjection({
    candidate: {
      firstName,
      lastName,
      email: profile.user.email,
    },
    recipient: {
      companyName: job.company.name,
      contactKind: job.publishedRevision.applicationContactKind,
      contactValue: job.publishedRevision.applicationContactValue,
    },
    job: {
      revisionId: job.publishedRevision.id,
      slug: job.slug,
      title: job.publishedRevision.title,
      responseTargetDays: job.publishedRevision.responseTargetDays,
      applicationEffort: job.publishedRevision.applicationEffort,
      requiredDocumentKinds: job.publishedRevision.requiredDocumentKinds,
    },
  });
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      profileId: profile.id,
      userId: profile.userId,
      candidateProvenance: profile.user.dataProvenance,
      jobId: job.id,
      companyId: job.companyId,
      companyProvenance: job.company.dataProvenance,
      jobProvenance: job.dataProvenance,
      projection,
      documents: Object.freeze(
        profile.documents.map((document) =>
          Object.freeze({
            id: document.id,
            safeFilename: document.safeFilename,
            mimeType: document.mimeType,
            sizeBytes: document.sizeBytes,
            storageKeyHash: sha256Utf8(document.storageKey),
          }),
        ),
      ),
      externalApplyHref:
        job.publishedRevision.applicationContactKind === "APPLY_URL"
          ? contactHref
          : null,
      identityComplete: firstName.length > 0 && lastName.length > 0,
    }),
  });
}

export function isSupportedRequiredDocumentContract(
  kinds: readonly RequiredDocumentKind[],
): boolean {
  if (kinds.length === 0 || new Set(kinds).size !== kinds.length) return false;
  if (kinds.some((kind) => !P0_APPLICATION_DOCUMENT_KINDS.includes(kind as never))) {
    return false;
  }
  return kinds.includes("NONE") ? kinds.length === 1 : true;
}

function snapshotIdentity(value: string | null): string {
  return value ?? "";
}
