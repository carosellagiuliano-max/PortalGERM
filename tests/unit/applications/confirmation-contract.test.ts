// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applicationSubmissionPayloadHash,
  buildApplicationConfirmationProjection,
  isSupportedRequiredDocumentContract,
  sha256Utf8,
} from "@/lib/applications/confirmation";
import {
  APPLICATION_CONFIRMATION_NOTICE_V1,
  APPLICATION_CONFIRMATION_NOTICE_VERSION_V1,
} from "@/lib/applications/contracts";

describe("application confirmation contract", () => {
  it("hashes the exact identity, recipient, job and notice projection", () => {
    const projection = buildProjection();
    expect(projection.confirmationVersion).toBe(APPLICATION_CONFIRMATION_NOTICE_VERSION_V1);
    expect(projection.confirmationNotice).toBe(APPLICATION_CONFIRMATION_NOTICE_V1);
    expect(projection.confirmationNoticeHash).toBe(sha256Utf8(APPLICATION_CONFIRMATION_NOTICE_V1));
    expect(projection.confirmationSnapshotHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(buildProjection().confirmationSnapshotHash).toBe(projection.confirmationSnapshotHash);
  });

  it("changes the confirmation hash if an authority-relevant displayed field changes", () => {
    const original = buildProjection();
    const changedRecipient = buildApplicationConfirmationProjection({
      ...baseInput(),
      recipient: {
        ...baseInput().recipient,
        companyName: "Andere AG",
      },
    });
    const changedRevision = buildApplicationConfirmationProjection({
      ...baseInput(),
      job: { ...baseInput().job, revisionId: "10000000-0000-4000-8000-000000000099" },
    });
    expect(changedRecipient.confirmationSnapshotHash).not.toBe(original.confirmationSnapshotHash);
    expect(changedRevision.confirmationSnapshotHash).not.toBe(original.confirmationSnapshotHash);
  });

  it("binds the exact persisted snapshot values required by the database guard", () => {
    const projection = buildApplicationConfirmationProjection({
      ...baseInput(),
      candidate: {
        firstName: "<b>Giulia</b>",
        lastName: "Muster &amp; Co",
        email: "GIULIA@example.ch",
      },
      recipient: {
        companyName: "<i>Muster AG</i>",
        contactKind: "EMAIL",
        contactValue: " jobs@muster.example ",
      },
      job: { ...baseInput().job, title: "<b>Pflegefachperson</b>" },
    });
    expect(projection.candidate).toEqual({
      firstName: "<b>Giulia</b>",
      lastName: "Muster &amp; Co",
      email: "GIULIA@example.ch",
    });
    expect(projection.recipient).toEqual({
      companyName: "<i>Muster AG</i>",
      contactKind: "EMAIL",
      contactValue: " jobs@muster.example ",
    });
    expect(projection.job.title).toBe("<b>Pflegefachperson</b>");
  });

  it("supports the strict P0 document contract and fails closed otherwise", () => {
    expect(isSupportedRequiredDocumentContract(["NONE"])).toBe(true);
    expect(isSupportedRequiredDocumentContract(["CV"])).toBe(true);
    expect(isSupportedRequiredDocumentContract(["CV", "COVER_LETTER"])).toBe(true);
    expect(isSupportedRequiredDocumentContract([])).toBe(false);
    expect(isSupportedRequiredDocumentContract(["NONE", "CV"])).toBe(false);
    expect(isSupportedRequiredDocumentContract(["CV", "CV"])).toBe(false);
    expect(isSupportedRequiredDocumentContract(["CERTIFICATES"])).toBe(false);
  });

  it("canonicalizes document order but binds cover letter and confirmation", () => {
    const first = applicationSubmissionPayloadHash({
      confirmationSnapshotHash: "a".repeat(64),
      coverLetter: "Guten Tag",
      selectedDocumentIds: [
        "10000000-0000-4000-8000-000000000002",
        "10000000-0000-4000-8000-000000000001",
      ],
    });
    const reordered = applicationSubmissionPayloadHash({
      confirmationSnapshotHash: "a".repeat(64),
      coverLetter: "Guten Tag",
      selectedDocumentIds: [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ],
    });
    expect(reordered).toBe(first);
    expect(
      applicationSubmissionPayloadHash({
        confirmationSnapshotHash: "b".repeat(64),
        coverLetter: "Guten Tag",
        selectedDocumentIds: ["10000000-0000-4000-8000-000000000001"],
      }),
    ).not.toBe(first);
  });
});

function buildProjection() {
  return buildApplicationConfirmationProjection(baseInput());
}

function baseInput() {
  return {
    candidate: {
      firstName: "Giulia",
      lastName: "Muster",
      email: "GIULIA@example.ch",
    },
    recipient: {
      companyName: "Muster AG",
      contactKind: "EMAIL" as const,
      contactValue: "jobs@muster.example",
    },
    job: {
      revisionId: "10000000-0000-4000-8000-000000000001",
      slug: "pflegefachperson-zuerich",
      title: "Pflegefachperson",
      responseTargetDays: 5,
      applicationEffort: "SIMPLE" as const,
      requiredDocumentKinds: ["CV"] as const,
    },
  };
}
