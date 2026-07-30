import { z } from "zod";

import { PHASE32_REQUIRED_REPORT_KINDS } from "@/lib/release/phase32-g4-manifest";

export const PHASE32_REPORT_EVIDENCE_VERSION =
  "phase32-report-evidence-v1" as const;

const gitObjectIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeRelativePosixPathSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, context) => {
    if (
      value.startsWith("/") ||
      value.endsWith("/") ||
      value.includes("\\") ||
      value.includes("//")
    ) {
      context.addIssue({
        code: "custom",
        message: "must be a relative canonical POSIX path",
      });
      return;
    }
    const segments = value.split("/");
    if (
      segments.some(
        (segment) =>
          segment === "." ||
          segment === ".." ||
          !/^[A-Za-z0-9._@()+[\]-]+$/u.test(segment),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "contains an unsafe path segment",
      });
    }
  });

const primaryLogSchema = z.strictObject({
  path: safeRelativePosixPathSchema,
  sha256: sha256Schema,
});

const attachmentDirectorySchema = z.strictObject({
  path: safeRelativePosixPathSchema,
  sha256: sha256Schema,
  fileCount: z.int().positive(),
  sizeBytes: z.int().nonnegative(),
});

export const phase32ReportEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(PHASE32_REPORT_EVIDENCE_VERSION),
    reportKind: z.enum(PHASE32_REQUIRED_REPORT_KINDS),
    commitSha: gitObjectIdSchema,
    artifactSha256: sha256Schema,
    primaryLog: primaryLogSchema,
    attachments: z.array(attachmentDirectorySchema),
  })
  .superRefine((descriptor, context) => {
    const observedPaths = new Set([descriptor.primaryLog.path]);
    for (const [index, attachment] of descriptor.attachments.entries()) {
      if (observedPaths.has(attachment.path)) {
        context.addIssue({
          code: "custom",
          message: `duplicate evidence path: ${attachment.path}`,
          path: ["attachments", index, "path"],
        });
      }
      observedPaths.add(attachment.path);

      const previous = descriptor.attachments[index - 1];
      if (previous !== undefined && previous.path >= attachment.path) {
        context.addIssue({
          code: "custom",
          message: "attachment paths must be unique and sorted",
          path: ["attachments", index, "path"],
        });
      }

      if (
        descriptor.primaryLog.path.startsWith(`${attachment.path}/`) ||
        attachment.path.startsWith(`${descriptor.primaryLog.path}/`) ||
        descriptor.attachments.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            (other.path.startsWith(`${attachment.path}/`) ||
              attachment.path.startsWith(`${other.path}/`)),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: `overlapping evidence directory: ${attachment.path}`,
          path: ["attachments", index, "path"],
        });
      }
    }
  });

export type Phase32ReportEvidence = z.infer<typeof phase32ReportEvidenceSchema>;
export type Phase32ReportEvidenceExpectation = Omit<
  Phase32ReportEvidence,
  "schemaVersion"
>;

/**
 * Schema validation alone proves only that digest fields are well formed.
 * Passing an expectation produced from freshly hashed evidence additionally
 * makes every identity, path, digest and directory count an exact binding.
 */
export function validatePhase32ReportEvidence(
  raw: unknown,
  expected?: Phase32ReportEvidenceExpectation,
): Phase32ReportEvidence {
  const descriptor = phase32ReportEvidenceSchema.parse(raw);
  if (expected !== undefined) {
    const expectedDescriptor = phase32ReportEvidenceSchema.parse({
      schemaVersion: PHASE32_REPORT_EVIDENCE_VERSION,
      ...expected,
    });
    if (!sameDescriptor(descriptor, expectedDescriptor)) {
      throw new Error("PHASE32_REPORT_EVIDENCE_BINDING_MISMATCH");
    }
  }
  return freezeDescriptor(descriptor);
}

function sameDescriptor(
  left: Phase32ReportEvidence,
  right: Phase32ReportEvidence,
) {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.reportKind === right.reportKind &&
    left.commitSha === right.commitSha &&
    left.artifactSha256 === right.artifactSha256 &&
    left.primaryLog.path === right.primaryLog.path &&
    left.primaryLog.sha256 === right.primaryLog.sha256 &&
    left.attachments.length === right.attachments.length &&
    left.attachments.every((attachment, index) => {
      const expected = right.attachments[index];
      return (
        expected !== undefined &&
        attachment.path === expected.path &&
        attachment.sha256 === expected.sha256 &&
        attachment.fileCount === expected.fileCount &&
        attachment.sizeBytes === expected.sizeBytes
      );
    })
  );
}

function freezeDescriptor(
  descriptor: Phase32ReportEvidence,
): Phase32ReportEvidence {
  const attachments = descriptor.attachments.map((attachment) =>
    Object.freeze({ ...attachment }),
  );
  Object.freeze(attachments);
  return Object.freeze({
    ...descriptor,
    primaryLog: Object.freeze({ ...descriptor.primaryLog }),
    attachments,
  });
}
