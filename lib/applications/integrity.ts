import { createHash } from "node:crypto";

import type {
  ApplicationContactKind,
  ApplicationEffort,
  RequiredDocumentKind,
} from "@/lib/generated/prisma/enums";
import {
  APPLICATION_CONFIRMATION_NOTICE_V1,
  APPLICATION_CONFIRMATION_NOTICE_VERSION_V1,
} from "@/lib/applications/contracts";

export type ApplicationConfirmationProjection = Readonly<{
  confirmationVersion: typeof APPLICATION_CONFIRMATION_NOTICE_VERSION_V1;
  confirmationNotice: typeof APPLICATION_CONFIRMATION_NOTICE_V1;
  confirmationNoticeHash: string;
  confirmationSnapshotHash: string;
  candidate: Readonly<{
    firstName: string;
    lastName: string;
    email: string;
  }>;
  recipient: Readonly<{
    companyName: string;
    contactKind: ApplicationContactKind;
    contactValue: string;
  }>;
  job: Readonly<{
    revisionId: string;
    slug: string;
    title: string;
    responseTargetDays: number;
    applicationEffort: ApplicationEffort;
    requiredDocumentKinds: readonly RequiredDocumentKind[];
  }>;
}>;

export function buildApplicationConfirmationProjection(input: Readonly<{
  candidate: Readonly<{ firstName: string; lastName: string; email: string }>;
  recipient: Readonly<{
    companyName: string;
    contactKind: ApplicationContactKind;
    contactValue: string;
  }>;
  job: Readonly<{
    revisionId: string;
    slug: string;
    title: string;
    responseTargetDays: number;
    applicationEffort: ApplicationEffort;
    requiredDocumentKinds: readonly RequiredDocumentKind[];
  }>;
}>): ApplicationConfirmationProjection {
  const noticeHash = sha256Utf8(APPLICATION_CONFIRMATION_NOTICE_V1);
  const canonical = Object.freeze({
    version: APPLICATION_CONFIRMATION_NOTICE_VERSION_V1,
    noticeHash,
    candidate: Object.freeze({
      firstName: input.candidate.firstName,
      lastName: input.candidate.lastName,
      email: input.candidate.email,
    }),
    recipient: Object.freeze({
      companyName: input.recipient.companyName,
      contactKind: input.recipient.contactKind,
      contactValue: input.recipient.contactValue,
    }),
    job: Object.freeze({
      revisionId: input.job.revisionId,
      slug: input.job.slug,
      title: input.job.title,
      responseTargetDays: input.job.responseTargetDays,
      applicationEffort: input.job.applicationEffort,
      requiredDocumentKinds: Object.freeze([...input.job.requiredDocumentKinds]),
    }),
  });
  return Object.freeze({
    confirmationVersion: APPLICATION_CONFIRMATION_NOTICE_VERSION_V1,
    confirmationNotice: APPLICATION_CONFIRMATION_NOTICE_V1,
    confirmationNoticeHash: noticeHash,
    confirmationSnapshotHash: sha256Utf8(JSON.stringify(canonical)),
    candidate: canonical.candidate,
    recipient: canonical.recipient,
    job: canonical.job,
  });
}

export function applicationSubmissionPayloadHash(input: Readonly<{
  confirmationSnapshotHash: string;
  coverLetter: string | null;
  selectedDocumentIds: readonly string[];
}>): string {
  return sha256Utf8(
    JSON.stringify({
      version: "application-submission-payload-v1",
      confirmationSnapshotHash: input.confirmationSnapshotHash,
      coverLetter: input.coverLetter,
      selectedDocumentIds: [...input.selectedDocumentIds].sort(),
    }),
  );
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
