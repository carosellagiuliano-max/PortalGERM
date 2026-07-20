// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  EntitlementGrantRecord,
  EntitlementRepository,
  EntitlementRights,
  PlanEntitlementRecord,
  PlanVersionEntitlementSource,
} from "@/lib/billing/entitlements";
import {
  evaluatePublicCompanyEligibility,
  hasEnhancedCompanyProfileAccess,
  listPublicCompanyDirectory,
  listPublicCompanies,
  projectPublicCompanyCard,
  projectPublicCompanyDetail,
  type PublicCompanyProjectionSource,
} from "@/lib/companies/public-read-model";
import type { DatabaseClient } from "@/lib/db/factory";
import type { PublicJobCardModel } from "@/lib/public/types";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCTION_DATA_CONTEXT = Object.freeze({
  eligibilityEnvironment: "production" as const,
  liveOnly: true,
  publicIndexingAllowed: true,
  showDemoBanner: false,
});

const SOURCE: PublicCompanyProjectionSource = Object.freeze({
  id: COMPANY_ID,
  slug: "muster-werkstatt",
  name: "Muster <strong>Werkstatt</strong>",
  industry: "Handwerk",
  size: "11–50",
  website: "https://example.test/unternehmen",
  about: "<p>Wir bauen.</p><script>steal()</script>",
  values: ["Sorgfalt", "<b>Fairness</b>"],
  benefits: ["ÖV-Beitrag", "<img src=x onerror=steal()> Weiterbildung"],
  responseTargetDays: 5,
  responseSampleSize: 20,
  responseWithinTargetBps: 8_500,
  status: "ACTIVE",
  dataProvenance: "LIVE",
  primaryLocations: [
    { city: { name: "Bern" }, canton: { name: "Bern" } },
  ],
  currentVerifiedCycleIds: ["verification-1"],
  hasEffectivePauseRestriction: false,
});

describe("public Company eligibility", () => {
  it("uses only ACTIVE, provenance and an effective PAUSE_COMPANY restriction", () => {
    const unverified: PublicCompanyProjectionSource = {
      ...SOURCE,
      currentVerifiedCycleIds: [],
    };
    expect(evaluatePublicCompanyEligibility(SOURCE, "production")).toBe(true);
    expect(evaluatePublicCompanyEligibility(unverified, "production")).toBe(true);
  });

  it.each(["DRAFT", "SUSPENDED", "CLOSED"])(
    "rejects %s companies",
    (status) => {
      expect(
        evaluatePublicCompanyEligibility({ ...SOURCE, status }, "production"),
      ).toBe(false);
    },
  );

  it("rejects effective pauses and production DEMO rows, but permits DEMO locally", () => {
    expect(
      evaluatePublicCompanyEligibility(
        { ...SOURCE, hasEffectivePauseRestriction: true },
        "production",
      ),
    ).toBe(false);
    expect(
      evaluatePublicCompanyEligibility(
        { ...SOURCE, dataProvenance: "DEMO" },
        "production",
      ),
    ).toBe(false);
    expect(
      evaluatePublicCompanyEligibility(
        { ...SOURCE, dataProvenance: "DEMO" },
        "non-production",
      ),
    ).toBe(true);
  });
});

describe("safe public Company projections", () => {
  it("projects a closed allowlist and treats verification only as a badge", () => {
    const sourceWithPrivateFields = {
      ...SOURCE,
      logoStorageKey: "private/logo-key",
      coverStorageKey: "private/cover-key",
      uid: "CHE-secret",
      registrationEmailDomainNormalized: "private.test",
      evidenceMetadata: { secret: true },
      currentVerifiedCycleIds: [],
    } as PublicCompanyProjectionSource;
    const card = projectPublicCompanyCard(sourceWithPrivateFields, {
      environment: "production",
      enhancedProfile: false,
      openJobCount: 3,
    });

    expect(card).toMatchObject({
      id: COMPANY_ID,
      slug: "muster-werkstatt",
      name: "Muster Werkstatt",
      verified: false,
      openJobCount: 3,
      benefitsPreview: [],
      response: {
        known: false,
        targetDays: null,
        onTimeRateBps: null,
        sampleSizeBucket: null,
      },
    });
    expect(JSON.stringify(card)).not.toMatch(
      /StorageKey|registration|evidence|CHE-secret|private\.test/u,
    );
  });

  it("hides every enhanced field and response aggregate without entitlement", () => {
    const detail = projectPublicCompanyDetail(SOURCE, {
      environment: "production",
      enhancedProfile: false,
      jobs: [],
    });

    expect(detail).toMatchObject({
      enhancedProfile: false,
      about: "Wir bauen.",
      values: [],
      benefits: [],
      response: {
        known: false,
        targetDays: null,
        onTimeRateBps: null,
        sampleSizeBucket: null,
      },
    });
  });

  it("reveals only sanitized enhanced fields and bucketed response evidence", () => {
    const detail = projectPublicCompanyDetail(SOURCE, {
      environment: "production",
      enhancedProfile: true,
      jobs: [],
    });

    expect(detail).toMatchObject({
      enhancedProfile: true,
      website: "https://example.test/unternehmen",
      values: ["Sorgfalt", "Fairness"],
      benefitsPreview: ["ÖV-Beitrag", "Weiterbildung"],
      benefits: ["ÖV-Beitrag", "Weiterbildung"],
      response: {
        known: true,
        targetDays: 5,
        onTimeRateBps: 8_500,
        sampleSizeBucket: "20–49",
      },
    });
    expect(JSON.stringify(detail)).not.toContain("steal");
  });

  it("fails response evidence closed below threshold or for inconsistent values", () => {
    for (const patch of [
      { responseSampleSize: 19 },
      { responseTargetDays: 0 },
      { responseWithinTargetBps: 10_001 },
    ]) {
      expect(
        projectPublicCompanyCard(
          { ...SOURCE, ...patch },
          {
            environment: "production",
            enhancedProfile: true,
            openJobCount: 0,
          },
        )?.response,
      ).toEqual({
        known: false,
        targetDays: null,
        onTimeRateBps: null,
        sampleSizeBucket: null,
      });
    }
    expect(
      projectPublicCompanyCard(
        { ...SOURCE, responseSampleSize: 50 },
        {
          environment: "production",
          enhancedProfile: true,
          openJobCount: 0,
        },
      )?.response.sampleSizeBucket,
    ).toBe("50+");
  });

  it("accepts canonical public jobs only from the requested company", () => {
    const ownJob = publicJob(COMPANY_ID, "muster-werkstatt", "job-1");
    const foreignJob = publicJob(
      "22222222-2222-4222-8222-222222222222",
      "fremde-firma",
      "job-2",
    );
    const detail = projectPublicCompanyDetail(SOURCE, {
      environment: "production",
      enhancedProfile: false,
      jobs: [foreignJob, ownJob],
    });

    expect(detail?.jobs).toEqual([ownJob]);
    expect(detail?.openJobCount).toBe(1);
  });

  it("does not expose an ambiguous primary location or unsafe website", () => {
    const detail = projectPublicCompanyDetail(
      {
        ...SOURCE,
        website: "javascript:alert(1)",
        primaryLocations: [
          ...SOURCE.primaryLocations,
          { city: { name: "Zürich" }, canton: { name: "Zürich" } },
        ],
      },
      { environment: "production", enhancedProfile: true, jobs: [] },
    );
    expect(detail).toMatchObject({ city: null, canton: null, website: null });
  });
});

describe("public Company directory", () => {
  it("lists only eligible safe cards with canonical counts and deterministic order", async () => {
    const alphaOne = companyRow({
      id: "11111111-1111-4111-8111-111111111110",
      slug: "alpha-eins",
      name: "Alpha",
    });
    const alphaTwo = companyRow({
      id: "11111111-1111-4111-8111-111111111112",
      slug: "alpha-zwei",
      name: "Alpha",
      verificationRequests: [],
    });
    const zeta = companyRow({
      id: "11111111-1111-4111-8111-111111111119",
      slug: "zeta",
      name: "Zeta <script>unsafe()</script>",
    });
    const paused = companyRow({
      id: "11111111-1111-4111-8111-111111111113",
      slug: "pausiert",
      name: "Pausiert",
    });
    const demo = companyRow({
      id: "11111111-1111-4111-8111-111111111114",
      slug: "demo-firma",
      name: "Demo",
      dataProvenance: "DEMO",
    });
    const suspended = companyRow({
      id: "11111111-1111-4111-8111-111111111115",
      slug: "gesperrt",
      name: "Gesperrt",
      status: "SUSPENDED",
    });
    const { database, transaction } = directoryDatabase(
      [zeta, suspended, alphaTwo, demo, paused, alphaOne],
      [paused.id],
    );
    const loadCounts = vi.fn(async (companyIds: readonly string[]) =>
      new Map(companyIds.map((id, index) => [id, index + 2])));

    const result = await listPublicCompanies(
      { limit: 100 },
      loadCounts,
      {
        now: NOW,
        database,
        dataContext: PRODUCTION_DATA_CONTEXT,
      },
    );

    expect(result.map((company) => [company.name, company.id])).toEqual([
      ["Alpha", alphaOne.id],
      ["Alpha", alphaTwo.id],
      ["Zeta", zeta.id],
    ]);
    expect(result.find((company) => company.id === alphaTwo.id)?.verified).toBe(
      false,
    );
    expect(new Set(loadCounts.mock.calls[0]?.[0])).toEqual(
      new Set([alphaOne.id, alphaTwo.id, zeta.id]),
    );
    expect(result.every((company) => company.openJobCount >= 2)).toBe(true);
    expect(result.every((company) => company.benefitsPreview.length === 0)).toBe(
      true,
    );
    expect(result.every((company) => company.response.known === false)).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /StorageKey|registration|evidence|unsafe/u,
    );
    expect(transaction.moderationRestriction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetType: "PAUSE_COMPANY" }),
      }),
    );
    const directorySelect = transaction.company.findMany.mock.calls[0]?.[0]
      ?.select;
    expect(directorySelect).not.toHaveProperty("website");
    expect(directorySelect).not.toHaveProperty("about");
    expect(directorySelect).not.toHaveProperty("values");
    expect(directorySelect).not.toHaveProperty("benefits");
    expect(directorySelect).not.toHaveProperty("responseTargetDays");
    expect(directorySelect).not.toHaveProperty("responseSampleSize");
    expect(directorySelect).not.toHaveProperty("responseWithinTargetBps");
    expect(transaction.planVersion.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.employerSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.entitlementGrant.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.company.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.employerSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: {
            in: [alphaOne.id, alphaTwo.id, zeta.id],
          },
        }),
      }),
    );
  });

  it("shows a bounded safe preview and response evidence only for an entitled company", async () => {
    const entitled = companyRow({
      id: "11111111-1111-4111-8111-111111111116",
      slug: "entitled-company",
      name: "Entitled",
      benefits: [
        "<b>ÖV-Beitrag</b>",
        "<img src=x onerror=steal()> Weiterbildung",
        "Flexible Arbeitszeit",
        "Homeoffice",
      ],
    });
    const free = companyRow({
      id: "11111111-1111-4111-8111-111111111117",
      slug: "free-company",
      name: "Free",
      benefits: ["Geheimer Free-Benefit"],
    });
    const { database, transaction } = directoryDatabase(
      [free, entitled],
      [],
      [entitled.id],
    );

    const result = await listPublicCompanies(
      {},
      async (companyIds) => new Map(companyIds.map((id) => [id, 1])),
      {
        now: NOW,
        database,
        dataContext: PRODUCTION_DATA_CONTEXT,
      },
    );

    expect(result.find((company) => company.id === entitled.id)).toMatchObject({
      benefitsPreview: [
        "ÖV-Beitrag",
        "Weiterbildung",
        "Flexible Arbeitszeit",
      ],
      response: {
        known: true,
        targetDays: 5,
        onTimeRateBps: 8_500,
        sampleSizeBucket: "20–49",
      },
    });
    expect(result.find((company) => company.id === free.id)).toMatchObject({
      benefitsPreview: [],
      response: {
        known: false,
        targetDays: null,
        onTimeRateBps: null,
        sampleSizeBucket: null,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/steal|Geheimer Free-Benefit/u);
    expect(transaction.planVersion.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.employerSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.entitlementGrant.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.company.findMany).toHaveBeenCalledTimes(2);
    expect(transaction.company.findMany.mock.calls[1]?.[0]).toEqual({
      where: { id: { in: [entitled.id] } },
      select: {
        id: true,
        benefits: true,
        responseTargetDays: true,
        responseSampleSize: true,
        responseWithinTargetBps: true,
      },
    });
  });

  it("keeps verification as an optional exact badge/filter", async () => {
    const verified = companyRow({
      id: "11111111-1111-4111-8111-111111111120",
      slug: "verifiziert",
      name: "Verifiziert",
    });
    const unverified = companyRow({
      id: "11111111-1111-4111-8111-111111111121",
      slug: "nicht-verifiziert",
      name: "Nicht verifiziert",
      verificationRequests: [],
    });
    const ambiguous = companyRow({
      id: "11111111-1111-4111-8111-111111111122",
      slug: "mehrfach-verifiziert",
      name: "Mehrfach verifiziert",
      verificationRequests: [{ id: "verified-1" }, { id: "verified-2" }],
    });
    const { database } = directoryDatabase([
      unverified,
      ambiguous,
      verified,
    ]);
    const loadCounts = vi.fn(async (companyIds: readonly string[]) =>
      new Map(companyIds.map((id) => [id, 1])));

    const result = await listPublicCompanies(
      { verifiedOnly: true },
      loadCounts,
      {
        now: NOW,
        database,
        dataContext: PRODUCTION_DATA_CONTEXT,
      },
    );

    expect(result.map((company) => company.id)).toEqual([verified.id]);
    expect(loadCounts).toHaveBeenCalledWith([verified.id], { now: NOW });
  });

  it("passes bounded search filters to the database and caps output at 100", async () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      companyRow({
        id: `company-${String(index).padStart(3, "0")}`,
        slug: `firma-${index}`,
        name: `Firma ${String(index).padStart(3, "0")}`,
      }));
    const { database, transaction } = directoryDatabase(rows);
    const loadCounts = vi.fn(async (companyIds: readonly string[]) =>
      new Map(companyIds.map((id) => [id, 0])));

    const result = await listPublicCompanies(
      {
        query: "  Firma  ",
        cantonSlug: "bern",
        industry: "  Handwerk  ",
        limit: 100,
      },
      loadCounts,
      {
        now: NOW,
        database,
        dataContext: PRODUCTION_DATA_CONTEXT,
      },
    );

    expect(result).toHaveLength(100);
    expect(transaction.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 101,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        where: expect.objectContaining({
          status: "ACTIVE",
          dataProvenance: "LIVE",
          name: { contains: "Firma", mode: "insensitive" },
          industry: { equals: "Handwerk", mode: "insensitive" },
          locations: {
            some: { isPrimary: true, canton: { slug: "bern" } },
          },
        }),
      }),
    );
  });

  it.each([0, 101, 1.5, Number.NaN])(
    "rejects an unsafe directory limit %s before database access",
    async (limit) => {
      const { database } = directoryDatabase([]);
      const loadCounts = vi.fn(async () => new Map<string, number>());
      await expect(
        listPublicCompanies(
          { limit },
          loadCounts,
          {
            now: NOW,
            database,
            dataContext: PRODUCTION_DATA_CONTEXT,
          },
        ),
      ).rejects.toThrow(RangeError);
      expect(database.$transaction).not.toHaveBeenCalled();
      expect(loadCounts).not.toHaveBeenCalled();
    },
  );

  it("fails missing or malformed canonical counts closed to zero", async () => {
    const first = companyRow({
      id: "11111111-1111-4111-8111-111111111130",
      slug: "erste-firma",
      name: "Erste",
    });
    const second = companyRow({
      id: "11111111-1111-4111-8111-111111111131",
      slug: "zweite-firma",
      name: "Zweite",
    });
    const { database } = directoryDatabase([first, second]);

    const result = await listPublicCompanies(
      {},
      async () => new Map([[first.id, -4]]),
      {
        now: NOW,
        database,
        dataContext: PRODUCTION_DATA_CONTEXT,
      },
    );

    expect(result.map((company) => company.openJobCount)).toEqual([0, 0]);
  });

  it("uses a signed, query-bound stable cursor and reports the canonical total", async () => {
    const rows = [
      companyRow({
        id: "11111111-1111-4111-8111-111111111140",
        slug: "alpha-eins",
        name: "Alpha",
      }),
      companyRow({
        id: "11111111-1111-4111-8111-111111111141",
        slug: "alpha-zwei",
        name: "Alpha",
      }),
      companyRow({
        id: "11111111-1111-4111-8111-111111111142",
        slug: "beta",
        name: "Beta",
      }),
    ];
    const { database } = directoryDatabase(rows);
    const options = {
      now: NOW,
      database,
      dataContext: PRODUCTION_DATA_CONTEXT,
      cursorSecret: "company-directory-test-secret-32-characters",
    } as const;
    const loadCounts = vi.fn(async (companyIds: readonly string[]) =>
      new Map(companyIds.map((id) => [id, 0])));

    const first = await listPublicCompanyDirectory(
      { limit: 2 },
      loadCounts,
      options,
    );
    expect(first).toMatchObject({
      totalEligible: 3,
      invalidCursor: false,
    });
    expect(first.companies.map((company) => company.id)).toEqual([
      rows[0]?.id,
      rows[1]?.id,
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await listPublicCompanyDirectory(
      { limit: 2, cursor: first.nextCursor! },
      loadCounts,
      options,
    );
    expect(second.companies.map((company) => company.id)).toEqual([
      rows[2]?.id,
    ]);
    expect(second).toMatchObject({
      nextCursor: null,
      totalEligible: 3,
      invalidCursor: false,
    });

    const mismatched = await listPublicCompanyDirectory(
      { industry: "Andere Branche", limit: 2, cursor: first.nextCursor! },
      loadCounts,
      options,
    );
    expect(mismatched.invalidCursor).toBe(true);
  });
});

describe("effective enhanced-profile entitlement", () => {
  it("honours an active raising grant over the complete Free baseline", async () => {
    const repository = entitlementRepository({
      grants: [enhancedProfileGrant()],
    });
    await expect(
      hasEnhancedCompanyProfileAccess(COMPANY_ID, NOW, repository),
    ).resolves.toBe(true);
  });

  it("fails closed for entitlement ambiguity and repository failures", async () => {
    const free = planVersion(false);
    await expect(
      hasEnhancedCompanyProfileAccess(
        COMPANY_ID,
        NOW,
        entitlementRepository({ defaultPlans: [free, { ...free, id: "free-2" }] }),
      ),
    ).resolves.toBe(false);

    const failed = entitlementRepository();
    vi.mocked(failed.listCompanySubscriptions).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(
      hasEnhancedCompanyProfileAccess(COMPANY_ID, NOW, failed),
    ).resolves.toBe(false);
  });
});

type MockCompanyRow = Readonly<{
  id: string;
  slug: string;
  name: string;
  industry: string | null;
  size: string | null;
  website: string | null;
  about: string | null;
  values: readonly string[];
  benefits: readonly string[];
  responseTargetDays: number | null;
  responseSampleSize: number;
  responseWithinTargetBps: number | null;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  dataProvenance: "LIVE" | "DEMO" | "TEST";
  locations: readonly Readonly<{
    city: Readonly<{ name: string }>;
    canton: Readonly<{ name: string }>;
  }>[];
  verificationRequests: readonly Readonly<{ id: string }>[];
}>;

function companyRow(overrides: Partial<MockCompanyRow> = {}): MockCompanyRow {
  return {
    id: COMPANY_ID,
    slug: "muster-werkstatt",
    name: "Muster Werkstatt",
    industry: "Handwerk",
    size: "11–50",
    website: "https://example.test/unternehmen",
    about: "Wir bauen.",
    values: ["Sorgfalt"],
    benefits: ["ÖV-Beitrag"],
    responseTargetDays: 5,
    responseSampleSize: 20,
    responseWithinTargetBps: 8_500,
    status: "ACTIVE",
    dataProvenance: "LIVE",
    locations: [{ city: { name: "Bern" }, canton: { name: "Bern" } }],
    verificationRequests: [{ id: "verification-1" }],
    ...overrides,
  };
}

function directoryDatabase(
  rows: readonly MockCompanyRow[],
  restrictedIds: readonly string[] = [],
  enhancedProfileCompanyIds: readonly string[] = [],
) {
  const transaction = {
    company: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        filterDirectoryRows(rows, restrictedIds, where).length),
      findMany: vi.fn(async ({
        where,
        take,
      }: {
        where: Record<string, unknown>;
        take?: number;
        select?: Record<string, unknown>;
      }) => {
        const requestedIds = ((where.id as Record<string, unknown> | undefined)
          ?.in as readonly string[] | undefined);
        const filtered = requestedIds === undefined
          ? filterDirectoryRows(rows, restrictedIds, where)
          : rows.filter((row) => requestedIds.includes(row.id));
        return take === undefined ? filtered : filtered.slice(0, take);
      }),
    },
    moderationRestriction: {
      findMany: vi.fn(async () =>
        restrictedIds.map((targetId) => ({ targetId }))),
    },
    planVersion: {
      findMany: vi.fn(async () => [databasePlanVersion(false)]),
    },
    employerSubscription: {
      findMany: vi.fn(async () => []),
    },
    entitlementGrant: {
      findMany: vi.fn(async () =>
        enhancedProfileCompanyIds.map((companyId) =>
          enhancedProfileGrant(companyId))),
    },
    companyVerificationRequest: {
      groupBy: vi.fn(async () =>
        rows
          .filter((row) => row.verificationRequests.length > 1)
          .map((row) => ({ companyId: row.id }))),
    },
  };
  const transactionRunner = vi.fn(
    async (
      operation: (client: typeof transaction) => Promise<unknown>,
    ): Promise<unknown> => operation(transaction),
  );
  return {
    database: { $transaction: transactionRunner } as unknown as DatabaseClient,
    transaction,
  };
}

function filterDirectoryRows(
  rows: readonly MockCompanyRow[],
  restrictedIds: readonly string[],
  rawWhere: Record<string, unknown>,
): MockCompanyRow[] {
  const and = Array.isArray(rawWhere.AND) ? rawWhere.AND : [];
  const where = (and[0] ?? rawWhere) as Record<string, unknown>;
  const cursorWhere = and[1] as
    | Readonly<{ OR?: readonly Record<string, unknown>[] }>
    | undefined;
  const excluded = new Set([
    ...restrictedIds,
    ...((((where.id as Record<string, unknown> | undefined)?.notIn) as
      | readonly string[]
      | undefined) ?? []),
  ]);
  const verifiedOnly = where.verificationRequests !== undefined;
  const query = ((where.name as Record<string, unknown> | undefined)
    ?.contains as string | undefined)?.toLocaleLowerCase("de-CH");
  const industry = ((where.industry as Record<string, unknown> | undefined)
    ?.equals as string | undefined)?.toLocaleLowerCase("de-CH");
  const cursorName = ((cursorWhere?.OR?.[0]?.name as
    | Record<string, unknown>
    | undefined)?.gt as string | undefined);
  const cursorId = ((cursorWhere?.OR?.[1]?.id as
    | Record<string, unknown>
    | undefined)?.gt as string | undefined);

  return rows
    .filter((row) => row.status === "ACTIVE")
    .filter((row) => row.dataProvenance === "LIVE")
    .filter((row) => !excluded.has(row.id))
    .filter((row) => !verifiedOnly || row.verificationRequests.length === 1)
    .filter((row) => query === undefined || row.name.toLocaleLowerCase("de-CH").includes(query))
    .filter((row) => industry === undefined || row.industry?.toLocaleLowerCase("de-CH") === industry)
    .filter((row) => cursorName === undefined || row.name > cursorName ||
      (row.name === cursorName && cursorId !== undefined && row.id > cursorId))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function databasePlanVersion(enhancedProfile: boolean) {
  const source = planVersion(enhancedProfile);
  return {
    id: source.id,
    status: source.status,
    validFrom: source.validFrom,
    validTo: source.validTo,
    plan: {
      code: source.planSlug,
      isDefaultFree: source.isDefaultFree,
    },
    entitlements: source.entitlements,
  };
}

function publicJob(
  companyId: string,
  companySlug: string,
  id: string,
): PublicJobCardModel {
  return {
    id,
    slug: id,
    title: "Stelle",
    description: "Beschreibung",
    company: {
      id: companyId,
      slug: companySlug,
      name: "Firma",
      verified: true,
    },
    category: { id: "category", name: "Kategorie", slug: "kategorie" },
    canton: null,
    city: null,
    locationLabel: null,
    remoteType: "REMOTE",
    jobType: "PERMANENT",
    workloadMin: 80,
    workloadMax: 100,
    salaryMin: null,
    salaryMax: null,
    salaryPeriod: null,
    applicationEffort: "SIMPLE",
    contentLanguage: "DE",
    fairScore: 90,
    response: {
      known: false,
      targetDays: null,
      onTimeRateBps: null,
      sampleSizeBucket: null,
    },
    publishedAt: new Date("2026-07-01T00:00:00.000Z"),
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    dataProvenance: "LIVE",
    activeBoost: false,
    sponsored: false,
  };
}

function entitlementRepository(
  input: Readonly<{
    defaultPlans?: readonly PlanVersionEntitlementSource[];
    grants?: readonly EntitlementGrantRecord[];
  }> = {},
): EntitlementRepository {
  return {
    listDefaultFreePlanVersions: vi.fn(async () =>
      input.defaultPlans ?? [planVersion(false)]),
    listCompanySubscriptions: vi.fn(async () => []),
    listCompanyEntitlementGrants: vi.fn(async () => input.grants ?? []),
    listFundableCredits: vi.fn(async () => []),
  };
}

function planVersion(enhancedProfile: boolean): PlanVersionEntitlementSource {
  return {
    id: "free-1",
    planSlug: "free",
    isDefaultFree: true,
    status: "ACTIVE",
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validTo: null,
    entitlements: entitlementRows({
      ACTIVE_JOB_LIMIT: 1,
      SEAT_LIMIT: 1,
      TALENT_RADAR_ACCESS: false,
      TALENT_CONTACT_ALLOWANCE: 0,
      JOB_BOOST_ALLOWANCE: 0,
      ANALYTICS_LEVEL: "NONE",
      ENHANCED_COMPANY_PROFILE: enhancedProfile,
      EMPLOYER_IMPORT_ACCESS: false,
    }),
  };
}

function entitlementRows(rights: EntitlementRights): PlanEntitlementRecord[] {
  return Object.entries(rights).map(([key, value]) => {
    if (typeof value === "boolean") {
      return {
        key,
        valueType: "BOOLEAN",
        booleanValue: value,
        integerValue: null,
        analyticsLevelValue: null,
      };
    }
    if (typeof value === "number") {
      return {
        key,
        valueType: "INTEGER",
        booleanValue: null,
        integerValue: value,
        analyticsLevelValue: null,
      };
    }
    return {
      key,
      valueType: "ANALYTICS_LEVEL",
      booleanValue: null,
      integerValue: null,
      analyticsLevelValue: value,
    };
  });
}

function enhancedProfileGrant(companyId = COMPANY_ID): EntitlementGrantRecord {
  return {
    id: "grant-enhanced-profile",
    companyId,
    key: "ENHANCED_COMPANY_PROFILE",
    valueType: "BOOLEAN",
    booleanValue: true,
    integerValue: null,
    analyticsLevelValue: null,
    integerMode: null,
    validFrom: new Date("2026-07-01T00:00:00.000Z"),
    validTo: new Date("2026-08-01T00:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}
