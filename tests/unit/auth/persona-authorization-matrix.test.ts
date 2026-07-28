import { describe, expect, it } from "vitest";

import {
  effectiveLegacyRoleForContext,
  isCompanyTenantAuthorized,
  isPortalContextAuthorized,
  listAvailablePortalContexts,
  resolveDefaultPortalContext,
  type PersonaAssignmentView,
} from "@/lib/auth/persona-policy";

const candidate = assignment("candidate", "CANDIDATE", "ACTIVE");
const employer = assignment("employer", "EMPLOYER", "ACTIVE");

describe("Phase 27 identity, persona and tenant authorization matrix", () => {
  it("does not turn a persona into tenant or admin authority", () => {
    expect(
      isPortalContextAuthorized({
        identityRole: "CANDIDATE",
        userStatus: "ACTIVE",
        portal: "EMPLOYER",
        assignments: [candidate, employer],
      }),
    ).toBe(true);
    expect(
      isCompanyTenantAuthorized({
        portalAuthorized: true,
        activeCompanyId: "company-a",
        memberships: [],
      }),
    ).toBe(false);
    expect(
      isPortalContextAuthorized({
        identityRole: "CANDIDATE",
        userStatus: "ACTIVE",
        portal: "ADMIN",
        assignments: [candidate, employer],
      }),
    ).toBe(false);
  });

  it.each([
    ["SUSPENDED", false],
    ["DELETED", false],
    ["ACTIVE", true],
  ] as const)("applies global %s status before portal context", (status, expected) => {
    expect(
      isPortalContextAuthorized({
        identityRole: "CANDIDATE",
        userStatus: status,
        portal: "CANDIDATE",
        assignments: [candidate],
        hasCandidateProfile: true,
      }),
    ).toBe(expected);
  });

  it("requires an active assignment, persisted profile and active exact-company membership", () => {
    expect(
      isPortalContextAuthorized({
        identityRole: "EMPLOYER",
        userStatus: "ACTIVE",
        portal: "CANDIDATE",
        assignments: [candidate, employer],
        hasCandidateProfile: false,
      }),
    ).toBe(false);
    expect(
      isCompanyTenantAuthorized({
        portalAuthorized: true,
        activeCompanyId: "company-a",
        memberships: [
          { companyId: "company-a", role: "OWNER", status: "SUSPENDED" },
          { companyId: "company-b", role: "OWNER", status: "ACTIVE" },
        ],
      }),
    ).toBe(false);
    expect(
      isCompanyTenantAuthorized({
        portalAuthorized: true,
        activeCompanyId: "company-b",
        memberships: [
          { companyId: "company-b", role: "RECRUITER", status: "ACTIVE" },
        ],
      }),
    ).toBe(true);
  });

  it("selects only active contexts and preserves the legacy default without capability union", () => {
    const suspendedCandidate = assignment(
      "candidate",
      "CANDIDATE",
      "SUSPENDED",
    );
    expect(
      listAvailablePortalContexts("ADMIN", [suspendedCandidate, employer]),
    ).toEqual(["EMPLOYER", "ADMIN"]);
    expect(
      resolveDefaultPortalContext("CANDIDATE", [
        suspendedCandidate,
        employer,
      ]),
    ).toBe("EMPLOYER");
    expect(
      effectiveLegacyRoleForContext({
        identityRole: "ADMIN",
        portal: "EMPLOYER",
        membershipRole: "RECRUITER",
      }),
    ).toBe("RECRUITER");
    expect(
      effectiveLegacyRoleForContext({
        identityRole: "CANDIDATE",
        portal: "ADMIN",
      }),
    ).toBe("CANDIDATE");
  });
});

function assignment(
  id: string,
  kind: PersonaAssignmentView["kind"],
  status: PersonaAssignmentView["status"],
): PersonaAssignmentView {
  return Object.freeze({ id, kind, status, version: 1 });
}
