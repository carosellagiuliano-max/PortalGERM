import {
  gateDecision,
  isSha256,
  isValidDate,
  type GateDecision,
} from "@/lib/commercial/contracts";

export type SalaryReleaseDecision = Readonly<{
  gate: GateDecision;
  indexable: boolean;
  publicAvailable: boolean;
  sitemapEligible: boolean;
}>;

export function evaluateSalaryRelease(
  input: Readonly<{
    approvedByLegal: boolean;
    approvedByMethodOwner: boolean;
    datasetDigest: string;
    datasetSource: "BFS_LSE" | "OTHER_APPROVED" | "MOCK" | "SYNTHETIC" | "NONE";
    disclosurePublished: boolean;
    grossRegionMapped: boolean;
    iscoMapped: boolean;
    nextReviewAt: Date | null;
    now: Date;
    salaryReleaseFlag: boolean;
    sourceRightsApproved: boolean;
  }>,
): SalaryReleaseDecision {
  const missing: string[] = [];
  if (!input.salaryReleaseFlag) missing.push("SALARY_RELEASE_FLAG");
  if (!["BFS_LSE", "OTHER_APPROVED"].includes(input.datasetSource)) {
    missing.push("REAL_APPROVED_DATASET");
  }
  if (!isSha256(input.datasetDigest)) missing.push("DATASET_DIGEST");
  if (!input.sourceRightsApproved) missing.push("SOURCE_RIGHTS");
  if (!input.approvedByLegal) missing.push("LEGAL_APPROVAL");
  if (!input.approvedByMethodOwner) missing.push("METHOD_APPROVAL");
  if (!input.iscoMapped || !input.grossRegionMapped) {
    missing.push("ISCO_AND_GROSSREGION_MAPPING");
  }
  if (!input.disclosurePublished) missing.push("PUBLIC_METHODOLOGY_DISCLOSURE");
  if (
    !isValidDate(input.now) ||
    input.nextReviewAt === null ||
    !isValidDate(input.nextReviewAt) ||
    input.nextReviewAt <= input.now
  ) {
    missing.push("CURRENT_REFRESH_OWNER");
  }
  const gate = gateDecision(missing);
  return Object.freeze({
    gate,
    indexable: gate.allowed,
    publicAvailable: gate.allowed,
    sitemapEligible: gate.allowed,
  });
}
