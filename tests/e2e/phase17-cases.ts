export const PHASE17_FIXTURE_VERSION = "phase17-e2e-v1" as const;

export const PHASE17_CASES = Object.freeze([
  Object.freeze({
    id: "E2E-01",
    requirements: Object.freeze([
      "REQ-MKT-001",
      "REQ-MKT-002",
      "REQ-CAN-001",
      "REQ-CAN-003",
      "REQ-CAN-004",
    ]),
    summary:
      "Search, candidate registration, SwissJobPass, apply, employer status and candidate update.",
  }),
  Object.freeze({
    id: "E2E-02",
    requirements: Object.freeze([
      "REQ-EMP-001",
      "REQ-EMP-002",
      "REQ-EMP-003",
      "REQ-EMP-004",
      "REQ-EMP-005",
      "REQ-ADM-001",
    ]),
    summary:
      "Employer onboarding, independent verification and reviewed publication.",
  }),
  Object.freeze({
    id: "E2E-03",
    requirements: Object.freeze([
      "REQ-BIL-001",
      "REQ-BIL-002",
      "REQ-BIL-003",
      "REQ-BIL-004",
      "REQ-BIL-005",
      "REQ-BIL-006",
    ]),
    summary:
      "Free quota, idempotent mock checkout, entitlement and publication.",
  }),
  Object.freeze({
    id: "E2E-04",
    requirements: Object.freeze([
      "REQ-TR-001",
      "REQ-TR-002",
      "REQ-TR-003",
      "REQ-TR-004",
      "REQ-TR-005",
      "REQ-TR-006",
    ]),
    summary:
      "Anonymous Radar contact, decline, logical-clock cooldown, accept and typed reveal.",
  }),
  Object.freeze({
    id: "E2E-05",
    requirements: Object.freeze([
      "REQ-IAM-002",
      "REQ-SEC-001",
      "REQ-SEC-002",
      "REQ-SEC-003",
    ]),
    summary: "Cross-tenant and cross-candidate IDOR denial.",
  }),
  Object.freeze({
    id: "E2E-06",
    requirements: Object.freeze(["REQ-ADM-002", "REQ-ADM-003"]),
    summary: "Abuse report and hostile import feed through an Admin decision.",
  }),
  Object.freeze({
    id: "E2E-07",
    requirements: Object.freeze([
      "REQ-BST-001",
      "REQ-SCORE-001",
      "REQ-MKT-001",
    ]),
    summary: "Active and expired boost, score invariance and stable pagination.",
  }),
] as const);

export type Phase17CaseId = (typeof PHASE17_CASES)[number]["id"];
