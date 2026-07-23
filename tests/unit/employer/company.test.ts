import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { DatabaseClient } from "@/lib/db/factory";
import {
  employerCompanyProfileSchema,
  getCompanyOnboardingMissing,
  getEmployerCompanyWorkspace,
} from "@/lib/employer/company";

const IDS = Object.freeze({
  actor: "10000000-0000-4000-8000-000000000001",
  company: "10000000-0000-4000-8000-000000000002",
  membership: "10000000-0000-4000-8000-000000000003",
  canton: "10000000-0000-4000-8000-000000000004",
  city: "10000000-0000-4000-8000-000000000005",
  location: "10000000-0000-4000-8000-000000000006",
  request: "10000000-0000-4000-8000-000000000007",
});

const VALID_PROFILE = Object.freeze({
  name: "Swiss Talent AG",
  uid: "CHE-123.456.789",
  industry: "Technology",
  size: "11–50",
  website: "https://example.ch/company",
  logoStorageKey: "/assets/company-media/default-logo.svg",
  coverStorageKey: "/assets/company-media/default-cover.svg",
  linkedinUrl: "https://www.linkedin.com/company/swiss-talent",
  facebookUrl: "https://www.facebook.com/swiss-talent",
  instagramUrl: "https://www.instagram.com/swiss-talent",
  about: "Ein vollständiges Firmenprofil mit nachvollziehbaren Angaben.",
  values: ["Verantwortung", "Transparenz"],
  benefits: ["Flexible Arbeitszeiten", "Weiterbildungsbudget"],
  locations: [
    {
      id: null,
      cantonId: IDS.canton,
      cityId: IDS.city,
      address: "Bahnhofstrasse 1",
      postalCode: "8001",
      isPrimary: true,
    },
  ],
});

describe("Phase-10 company profile contract", () => {
  it("accepts the bounded social, location and storage metadata contract", () => {
    expect(employerCompanyProfileSchema.safeParse(VALID_PROFILE).success).toBe(true);
  });

  it.each([
    ["unsafe social protocol", { linkedinUrl: "http://linkedin.example/company" }],
    ["unsafe storage traversal", { logoStorageKey: "companies/../secret.svg" }],
    [
      "unreviewed self-hosted media",
      { logoStorageKey: "/assets/company-media/unreviewed.svg" },
    ],
    [
      "external media",
      { coverStorageKey: "https://tracking.example/pixel.png" },
    ],
    ["duplicate values", { values: ["Fair", "fair"] }],
    [
      "multiple primary locations",
      {
        locations: [
          VALID_PROFILE.locations[0],
          { ...VALID_PROFILE.locations[0], cityId: IDS.location },
        ],
      },
    ],
  ])("rejects %s", (_label, patch) => {
    expect(
      employerCompanyProfileSchema.safeParse({ ...VALID_PROFILE, ...patch }).success,
    ).toBe(false);
  });

  it("reports the exact onboarding requirements without conflating verification", () => {
    expect(
      getCompanyOnboardingMissing({
        name: "",
        industry: null,
        size: null,
        website: null,
        uid: null,
        about: " ",
        locations: [],
      }),
    ).toEqual([
      "NAME",
      "INDUSTRY",
      "SIZE",
      "WEBSITE_OR_UID",
      "PRIMARY_LOCATION",
      "PUBLIC_DESCRIPTION",
    ]);
    expect(
      getCompanyOnboardingMissing({
        name: VALID_PROFILE.name,
        industry: VALID_PROFILE.industry,
        size: VALID_PROFILE.size,
        website: null,
        uid: VALID_PROFILE.uid,
        about: VALID_PROFILE.about,
        locations: [{ isPrimary: true }],
      }),
    ).toEqual([]);
  });
});

describe("Phase-10 company workspace scope", () => {
  it("uses the Company plus active Membership predicate first and hides private verification details from Viewer", async () => {
    const fixture = createWorkspaceDatabase("VIEWER");

    const workspace = await getEmployerCompanyWorkspace(fixture.database, {
      companyId: IDS.company,
      membershipId: IDS.membership,
      actorUserId: IDS.actor,
    }, { resolveEnhancedProfileAccess: async () => false });

    expect(fixture.companyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: IDS.company,
          status: { in: ["DRAFT", "ACTIVE"] },
          memberships: {
            some: {
              id: IDS.membership,
              userId: IDS.actor,
              status: "ACTIVE",
            },
          },
        },
      }),
    );
    expect(fixture.companyFindFirst.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.cantonFindMany.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(fixture.verificationFindMany).not.toHaveBeenCalled();
    expect(workspace.canManage).toBe(false);
    expect(workspace.enhancedProfileAllowed).toBe(false);
    expect(workspace.verification.current).toMatchObject({
      id: IDS.request,
      evidence: null,
      events: [],
    });
  });

  it("loads evidence and internal event reasons only after an Owner role is established", async () => {
    const fixture = createWorkspaceDatabase("OWNER");
    fixture.verificationFindMany.mockResolvedValue([
      {
        id: IDS.request,
        evidenceMetadata: {
          schemaVersion: "company-verification-evidence-v1",
          summary: "Handelsregisterangaben und Domainbesitz stimmen überein.",
          reference: "HR-2026-17",
        },
        events: [
          {
            kind: "SUBMITTED",
            fromStatus: "DRAFT",
            toStatus: "PENDING",
            reasonCode: "INITIAL_SUBMISSION",
            createdAt: new Date("2026-07-20T10:00:00.000Z"),
          },
        ],
      },
    ]);

    const workspace = await getEmployerCompanyWorkspace(fixture.database, {
      companyId: IDS.company,
      membershipId: IDS.membership,
      actorUserId: IDS.actor,
    }, { resolveEnhancedProfileAccess: async () => true });

    expect(fixture.verificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: IDS.company,
          id: { in: [IDS.request] },
        }),
      }),
    );
    expect(workspace.canManage).toBe(true);
    expect(workspace.enhancedProfileAllowed).toBe(true);
    expect(workspace.verification.current?.evidence?.reference).toBe("HR-2026-17");
    expect(workspace.verification.current?.events[0]?.reasonCode).toBe(
      "INITIAL_SUBMISSION",
    );
  });
});

function createWorkspaceDatabase(role: "OWNER" | "VIEWER") {
  const companyFindFirst = vi.fn().mockResolvedValue({
    id: IDS.company,
    name: VALID_PROFILE.name,
    slug: "swiss-talent",
    uid: VALID_PROFILE.uid,
    industry: VALID_PROFILE.industry,
    size: VALID_PROFILE.size,
    website: VALID_PROFILE.website,
    logoStorageKey: VALID_PROFILE.logoStorageKey,
    coverStorageKey: VALID_PROFILE.coverStorageKey,
    linkedinUrl: VALID_PROFILE.linkedinUrl,
    facebookUrl: VALID_PROFILE.facebookUrl,
    instagramUrl: VALID_PROFILE.instagramUrl,
    about: VALID_PROFILE.about,
    values: VALID_PROFILE.values,
    benefits: VALID_PROFILE.benefits,
    status: "ACTIVE",
    updatedAt: new Date("2026-07-20T09:00:00.000Z"),
    memberships: [{ role }],
    locations: [
      {
        id: IDS.location,
        cantonId: IDS.canton,
        cityId: IDS.city,
        address: "Bahnhofstrasse 1",
        postalCode: "8001",
        isPrimary: true,
        canton: { code: "ZH", name: "Zürich" },
        city: { name: "Zürich" },
      },
    ],
    verificationRequests: [
      {
        id: IDS.request,
        status: "PENDING",
        supersedesRequestId: null,
        createdAt: new Date("2026-07-20T10:00:00.000Z"),
        updatedAt: new Date("2026-07-20T10:00:00.000Z"),
      },
    ],
  });
  const cantonFindMany = vi.fn().mockResolvedValue([
    { id: IDS.canton, code: "ZH", name: "Zürich" },
  ]);
  const cityFindMany = vi.fn().mockResolvedValue([
    { id: IDS.city, cantonId: IDS.canton, name: "Zürich" },
  ]);
  const verificationFindMany = vi.fn().mockResolvedValue([]);
  const database = {
    company: { findFirst: companyFindFirst },
    canton: { findMany: cantonFindMany },
    city: { findMany: cityFindMany },
    companyVerificationRequest: { findMany: verificationFindMany },
  } as unknown as DatabaseClient;
  return {
    database,
    companyFindFirst,
    cantonFindMany,
    verificationFindMany,
  };
}
