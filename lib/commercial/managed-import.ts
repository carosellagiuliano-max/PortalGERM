import {
  gateDecision,
  isSha256,
  isValidDate,
  type GateDecision,
} from "@/lib/commercial/contracts";

export type ManagedImportDecision = Readonly<{
  commitMode: "DISABLED" | "DRAFT_ONLY";
  gate: GateDecision;
  recurringSyncAllowed: false;
}>;

/**
 * The existing licensed-import pipeline owns parsing and Job creation. This
 * policy is its Phase-31 packaging boundary: rights, mapping and the exact
 * preview must be current, an explicit commit is required, and output may only
 * be DRAFT. Recurring sync remains out of scope.
 */
export function evaluateManagedImportCommit(
  input: Readonly<{
    actorCanCommitForCompany: boolean;
    commitFlag: boolean;
    explicitCommitConfirmed: boolean;
    mappingDigest: string;
    previewDigest: string;
    previewStatus: "PREVIEW_READY" | "FAILED" | "PENDING";
    rightsEvidenceDigest: string;
    rightsValidFrom: Date;
    rightsValidTo: Date | null;
    sourceActive: boolean;
    targetStatus: "DRAFT" | "SUBMITTED" | "PUBLISHED";
    tenantMatches: boolean;
    now: Date;
  }>,
): ManagedImportDecision {
  const missing: string[] = [];
  if (!input.commitFlag) missing.push("MANAGED_IMPORT_COMMIT_FLAG");
  if (!input.actorCanCommitForCompany || !input.tenantMatches) {
    missing.push("TENANT_AUTHORIZATION");
  }
  if (!input.sourceActive) missing.push("ACTIVE_SOURCE");
  if (
    !isValidDate(input.now) ||
    !isValidDate(input.rightsValidFrom) ||
    input.rightsValidFrom > input.now ||
    (input.rightsValidTo !== null &&
      (!isValidDate(input.rightsValidTo) || input.rightsValidTo <= input.now))
  ) {
    missing.push("CURRENT_SOURCE_RIGHTS");
  }
  if (!isSha256(input.rightsEvidenceDigest)) {
    missing.push("RIGHTS_EVIDENCE_DIGEST");
  }
  if (!isSha256(input.mappingDigest)) missing.push("MAPPING_DIGEST");
  if (
    input.previewStatus !== "PREVIEW_READY" ||
    !isSha256(input.previewDigest)
  ) {
    missing.push("BOUND_PREVIEW");
  }
  if (!input.explicitCommitConfirmed) missing.push("EXPLICIT_COMMIT");
  if (input.targetStatus !== "DRAFT") missing.push("DRAFT_ONLY");
  const gate = gateDecision(missing);
  return Object.freeze({
    commitMode: gate.allowed ? "DRAFT_ONLY" : "DISABLED",
    gate,
    recurringSyncAllowed: false,
  });
}
