import {
  PASSWORD_HASH_POLICY_V1,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { companyMediaOptions } from "@/lib/security/company-media-manifest";
import type { CanonicalJsonValue } from "@/prisma/seed/canonical-json";
import { createOrVerifySeedRecord, SeedDataDriftError } from "@/prisma/seed/create-or-verify";
import { createSeedBlockDigest } from "@/prisma/seed/manifest";
import { stableSeedId } from "@/prisma/seed/ids";
import {
  COMPANY_FIXTURES,
  COMPANIES_JOBS_SEED_IDENTITIES,
  DEMO_ACCOUNT_FIXTURES,
  DEMO_COMPANY_SLUG,
  DEMO_LOGIN_PASSWORD,
  buildJobFixtures,
  type CompanyFixture,
  type DemoAccountFixture,
  type DemoJobStatus,
  type JobFixture,
} from "@/prisma/seed/fixtures/companies-jobs";
import { CATEGORY_FIXTURES } from "@/prisma/seed/fixtures/categories";
import { CITY_FIXTURES } from "@/prisma/seed/fixtures/cities";
import { OCCUPATION_CODES_2026_FIXTURE } from "@/prisma/seed/fixtures/occupation-codes";
import type { PlanCode } from "@/prisma/seed/fixtures/plans";
import { SKILL_FIXTURES } from "@/prisma/seed/fixtures/skills";

type SeedTransaction = Prisma.TransactionClient;

export type DemoAccountSeedHandle = Readonly<{
  id: string;
  email: string;
  role: DemoAccountFixture["role"];
  profileId: string | null;
}>;

export type CompanySeedHandle = Readonly<{
  id: string;
  slug: string;
  name: string;
  planCode: PlanCode;
  ownerUserId: string;
  ownerMembershipId: string;
}>;

export type JobSeedHandle = Readonly<{
  id: string;
  slug: string;
  companyId: string;
  revisionId: string;
  status: DemoJobStatus;
  publishedRevisionId: string | null;
}>;

export type CompaniesJobsSeedResult = Readonly<{
  demoAccounts: readonly DemoAccountSeedHandle[];
  companies: readonly CompanySeedHandle[];
  jobs: readonly JobSeedHandle[];
  blockDigest: ReturnType<typeof createSeedBlockDigest>;
  identities: typeof COMPANIES_JOBS_SEED_IDENTITIES;
}>;

export async function seedDemoAccountsCompaniesAndJobs(
  database: PrismaClient,
  anchorAt: Date,
): Promise<CompaniesJobsSeedResult> {
  assertAnchor(anchorAt);
  const jobs = buildJobFixtures(anchorAt);

  await seedUsersAndCredentials(database, anchorAt);
  await assertReferenceContract(database);

  for (const company of COMPANY_FIXTURES) {
    await database.$transaction(
      (transaction) => seedCompany(transaction, company, anchorAt),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }

  await database.$transaction(
    (transaction) => seedCompanyClaims(transaction, anchorAt),
    { maxWait: 5_000, timeout: 10_000 },
  );

  const occupationContract = await loadOccupationContract(database);
  for (const job of jobs) {
    await database.$transaction(
      (transaction) =>
        seedJob(transaction, job, anchorAt, occupationContract),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }

  const demoAccounts = Object.freeze(
    DEMO_ACCOUNT_FIXTURES.map(({ id, email, role, profileId }) =>
      Object.freeze({ id, email, role, profileId }),
    ),
  );
  const companies = Object.freeze(
    COMPANY_FIXTURES.map(
      ({ id, slug, name, planCode, ownerUserId, ownerMembershipId }) =>
        Object.freeze({
          id,
          slug,
          name,
          planCode,
          ownerUserId,
          ownerMembershipId,
        }),
    ),
  );
  const jobHandles = Object.freeze(
    jobs.map((job) =>
      Object.freeze({
        id: job.id,
        slug: job.slug,
        companyId: job.companyId,
        revisionId: job.revisionId,
        status: job.status,
        publishedRevisionId: wasPublished(job.status) ? job.revisionId : null,
      }),
    ),
  );

  return Object.freeze({
    demoAccounts,
    companies,
    jobs: jobHandles,
    identities: COMPANIES_JOBS_SEED_IDENTITIES,
    blockDigest: createSeedBlockDigest("companies-jobs", 144, {
      accounts: demoAccounts.map(({ id, email, role }) => ({ id, email, role })),
      companies: companies.map(({ id, slug, planCode }) => ({ id, slug, planCode })),
      jobs: jobHandles.map(({ id, slug, status, companyId }) => ({
        id,
        slug,
        status,
        companyId,
      })),
    }),
  });
}

async function seedUsersAndCredentials(
  database: PrismaClient,
  anchorAt: Date,
): Promise<void> {
  for (const account of DEMO_ACCOUNT_FIXTURES) {
    await ensureUser(database, account, anchorAt);
    if (account.role === "EMPLOYER" || account.role === "RECRUITER") {
      await ensureEmployerProfile(database, account.email, account.id, account.name, anchorAt);
    }
    await ensureCredential(database, account, anchorAt);
  }

  for (const company of COMPANY_FIXTURES) {
    if (company.ownerEmail === "employer@demo.ch") continue;
    const principal: DemoAccountFixture = {
      id: company.ownerUserId,
      email: company.ownerEmail,
      name: `Demo-Inhaberin ${company.name}`,
      role: "EMPLOYER",
      profileId: stableSeedId("employer-profile", company.ownerEmail),
    };
    await ensureUser(database, principal, anchorAt);
    await ensureEmployerProfile(
      database,
      principal.email,
      principal.id,
      principal.name,
      anchorAt,
    );
  }
}

async function ensureUser(
  database: PrismaClient,
  account: DemoAccountFixture,
  anchorAt: Date,
): Promise<void> {
  const createdAt = addDays(anchorAt, -180);
  const emailVerifiedAt = addDays(anchorAt, -179);
  const expected = {
    id: account.id,
    email: account.email,
    emailNormalized: account.email,
    role: account.role,
    name: account.name,
    status: "ACTIVE",
    dataProvenance: "DEMO",
    emailVerifiedAt: emailVerifiedAt.toISOString(),
    createdAt: createdAt.toISOString(),
  } as const;
  await createOrVerifySeedRecord({
    entity: "User",
    naturalKey: account.email,
    findExisting: () => database.user.findUnique({ where: { id: account.id } }),
    create: () =>
      database.user.create({
        data: {
          id: account.id,
          email: account.email,
          emailNormalized: account.email,
          role: account.role,
          name: account.name,
          status: "ACTIVE",
          dataProvenance: "DEMO",
          emailVerifiedAt,
          createdAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      email: row.email,
      emailNormalized: row.emailNormalized,
      role: row.role,
      name: row.name,
      status: row.status,
      dataProvenance: row.dataProvenance,
      emailVerifiedAt: iso(row.emailVerifiedAt),
      createdAt: row.createdAt.toISOString(),
    }),
    expected,
  });
}

async function ensureCredential(
  database: PrismaClient,
  account: DemoAccountFixture,
  anchorAt: Date,
): Promise<void> {
  const id = stableSeedId("credential", account.email);
  const passwordChangedAt = addDays(anchorAt, -180);
  const existing = await database.credential.findUnique({ where: { id } });
  const passwordHash = existing?.passwordHash ?? (await hashPassword(DEMO_LOGIN_PASSWORD));
  const result = await createOrVerifySeedRecord({
    entity: "Credential",
    naturalKey: account.email,
    findExisting: () => database.credential.findUnique({ where: { id } }),
    create: () =>
      database.credential.create({
        data: {
          id,
          userId: account.id,
          passwordHash,
          algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
          algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
          passwordChangedAt,
          createdAt: passwordChangedAt,
        },
      }),
    project: (row) => ({
      id: row.id,
      userId: row.userId,
      algorithm: row.algorithm,
      algorithmVersion: row.algorithmVersion,
      passwordChangedAt: row.passwordChangedAt.toISOString(),
    }),
    expected: {
      id,
      userId: account.id,
      algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
      algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
      passwordChangedAt: passwordChangedAt.toISOString(),
    },
  });
  if (!(await verifyPassword(DEMO_LOGIN_PASSWORD, result.record.passwordHash))) {
    throw new SeedDataDriftError("Credential", account.email);
  }
}

async function ensureEmployerProfile(
  database: PrismaClient,
  naturalKey: string,
  userId: string,
  displayName: string,
  anchorAt: Date,
): Promise<void> {
  const id = stableSeedId("employer-profile", naturalKey);
  await createOrVerifySeedRecord({
    entity: "EmployerProfile",
    naturalKey,
    findExisting: () => database.employerProfile.findUnique({ where: { id } }),
    create: () =>
      database.employerProfile.create({
        data: { id, userId, displayName, createdAt: addDays(anchorAt, -179) },
      }),
    project: (row) => ({ id: row.id, userId: row.userId, displayName: row.displayName }),
    expected: { id, userId, displayName },
  });
}

async function assertReferenceContract(database: PrismaClient): Promise<void> {
  const [categories, cities, skills] = await Promise.all([
    database.category.findMany({
      where: { slug: { in: CATEGORY_FIXTURES.map((fixture) => fixture.slug) } },
      select: { id: true, slug: true },
    }),
    database.city.findMany({
      where: { slug: { in: CITY_FIXTURES.map((fixture) => fixture.slug) } },
      select: { id: true, slug: true, canton: { select: { code: true } } },
    }),
    database.skill.findMany({
      where: { slug: { in: SKILL_FIXTURES.map((fixture) => fixture.slug) } },
      select: { id: true, slug: true },
    }),
  ]);
  for (const category of categories) {
    if (category.id !== stableSeedId("category", category.slug)) {
      throw new SeedDataDriftError("Category", category.slug);
    }
  }
  for (const city of cities) {
    if (city.id !== stableSeedId("city", `${city.canton.code}:${city.slug}`)) {
      throw new SeedDataDriftError("City", `${city.canton.code}:${city.slug}`);
    }
  }
  for (const skill of skills) {
    if (skill.id !== stableSeedId("skill", skill.slug)) {
      throw new SeedDataDriftError("Skill", skill.slug);
    }
  }
  if (
    categories.length !== CATEGORY_FIXTURES.length ||
    cities.length !== CITY_FIXTURES.length ||
    skills.length !== SKILL_FIXTURES.length
  ) {
    throw new Error("Reference fixtures must be seeded before companies and jobs.");
  }
}

async function seedCompany(
  transaction: SeedTransaction,
  fixture: CompanyFixture,
  anchorAt: Date,
): Promise<void> {
  const createdAt = addDays(anchorAt, -180);
  const logoAsset = companyMediaOptions("LOGO")[0];
  const coverAsset = companyMediaOptions("COVER")[0];
  if (logoAsset === undefined || coverAsset === undefined) {
    throw new Error("The reviewed company-media manifest is incomplete.");
  }
  const companyCore = {
    id: fixture.id,
    name: fixture.name,
    slug: fixture.slug,
    industry: fixture.industry,
    size: fixture.size,
    website: `https://${fixture.slug}.example.test`,
    logoStorageKey: logoAsset.path,
    coverStorageKey: coverAsset.path,
    about: `${fixture.name} ist ein vollständig fiktives Schweizer Demo-Unternehmen. Das Team verbindet ${fixture.industry} mit nachvollziehbaren Arbeitsweisen, fairer Kommunikation und konkreten Lernmöglichkeiten.`,
    values: ["Verlässliche Zusammenarbeit", "Lernen im Alltag", "Faire Entscheidungen"],
    benefits: ["Planbare Arbeitszeiten", "Bezahlte Weiterbildung", "Transparente Lohnbänder"],
    responseTargetDays: fixture.responseTargetDays,
    responseSampleSize: fixture.responseSampleSize,
    responseWithinTargetBps: fixture.responseWithinTargetBps,
    dataProvenance: "DEMO" as const,
  };
  await createOrVerifySeedRecord({
    entity: "Company",
    naturalKey: fixture.slug,
    findExisting: () => transaction.company.findUnique({ where: { id: fixture.id } }),
    create: () =>
      transaction.company.create({
        data: { ...companyCore, status: "DRAFT", createdAt },
      }),
    project: (row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      industry: row.industry,
      size: row.size,
      website: row.website,
      logoStorageKey: row.logoStorageKey,
      coverStorageKey: row.coverStorageKey,
      about: row.about,
      values: row.values,
      benefits: row.benefits,
      responseTargetDays: row.responseTargetDays,
      responseSampleSize: row.responseSampleSize,
      responseWithinTargetBps: row.responseWithinTargetBps,
      dataProvenance: row.dataProvenance,
    }),
    expected: companyCore,
  });

  await createOrVerifySeedRecord({
    entity: "CompanyLocation",
    naturalKey: `${fixture.slug}:primary`,
    findExisting: () => transaction.companyLocation.findUnique({ where: { id: fixture.locationId } }),
    create: () =>
      transaction.companyLocation.create({
        data: {
          id: fixture.locationId,
          companyId: fixture.id,
          cantonId: fixture.cantonId,
          cityId: fixture.cityId,
          address: `Demostrasse ${COMPANY_FIXTURES.indexOf(fixture) + 1}`,
          postalCode: String(8000 + COMPANY_FIXTURES.indexOf(fixture)).padStart(4, "0"),
          isPrimary: true,
          createdAt: addDays(anchorAt, -179),
        },
      }),
    project: (row) => ({
      id: row.id,
      companyId: row.companyId,
      cantonId: row.cantonId,
      cityId: row.cityId,
      address: row.address,
      postalCode: row.postalCode,
      isPrimary: row.isPrimary,
    }),
    expected: {
      id: fixture.locationId,
      companyId: fixture.id,
      cantonId: fixture.cantonId,
      cityId: fixture.cityId,
      address: `Demostrasse ${COMPANY_FIXTURES.indexOf(fixture) + 1}`,
      postalCode: String(8000 + COMPANY_FIXTURES.indexOf(fixture)).padStart(4, "0"),
      isPrimary: true,
    },
  });

  await ensureMembership(
    transaction,
    fixture.ownerMembershipId,
    fixture,
    fixture.ownerUserId,
    "OWNER",
    fixture.ownerEmail,
    anchorAt,
  );
  if (fixture.slug === DEMO_COMPANY_SLUG) {
    const recruiter = DEMO_ACCOUNT_FIXTURES.find((account) => account.email === "recruiter@demo.ch");
    if (!recruiter) throw new Error("Recruiter demo account is missing.");
    await ensureMembership(
      transaction,
      stableSeedId("company-membership", `${fixture.slug}:${recruiter.email}`),
      fixture,
      recruiter.id,
      "RECRUITER",
      recruiter.email,
      anchorAt,
    );
  }

  const state = await transaction.company.findUniqueOrThrow({ where: { id: fixture.id } });
  if (state.status === "DRAFT") {
    await transaction.company.update({ where: { id: fixture.id }, data: { status: "ACTIVE" } });
  } else if (state.status !== "ACTIVE") {
    throw new SeedDataDriftError("Company", fixture.slug);
  }

  await seedCompanyStatusEvents(transaction, fixture, anchorAt);
  await seedCompanyVerification(transaction, fixture, anchorAt);
  if (fixture.billingProfileId) {
    await seedBillingProfile(transaction, fixture, anchorAt);
  }
}

async function ensureMembership(
  transaction: SeedTransaction,
  id: string,
  company: CompanyFixture,
  userId: string,
  role: "OWNER" | "RECRUITER",
  naturalUserKey: string,
  anchorAt: Date,
): Promise<void> {
  const joinedAt = addDays(anchorAt, -178);
  await createOrVerifySeedRecord({
    entity: "CompanyMembership",
    naturalKey: `${company.slug}:${naturalUserKey}`,
    findExisting: () => transaction.companyMembership.findUnique({ where: { id } }),
    create: () =>
      transaction.companyMembership.create({
        data: { id, companyId: company.id, userId, role, status: "ACTIVE", joinedAt, createdAt: joinedAt },
      }),
    project: (row) => ({
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt.toISOString(),
      removedAt: iso(row.removedAt),
    }),
    expected: { id, companyId: company.id, userId, role, status: "ACTIVE", joinedAt: joinedAt.toISOString(), removedAt: null },
  });
}

async function seedCompanyStatusEvents(
  transaction: SeedTransaction,
  fixture: CompanyFixture,
  anchorAt: Date,
): Promise<void> {
  const index = COMPANY_FIXTURES.indexOf(fixture);
  const events: Array<{
    suffix: string;
    kind: "DRAFT_CREATED" | "ONBOARDING_COMPLETED" | "SUSPENDED" | "REACTIVATED";
    fromStatus: "DRAFT" | "ACTIVE" | "SUSPENDED" | null;
    toStatus: "DRAFT" | "ACTIVE" | "SUSPENDED";
    at: Date;
  }> = [
    { suffix: "draft-created", kind: "DRAFT_CREATED", fromStatus: null, toStatus: "DRAFT", at: addDays(anchorAt, -180) },
    { suffix: "onboarding-completed", kind: "ONBOARDING_COMPLETED", fromStatus: "DRAFT", toStatus: "ACTIVE", at: addDays(anchorAt, -175) },
  ];
  if (index % 8 === 0) {
    events.push(
      { suffix: "suspended-history", kind: "SUSPENDED", fromStatus: "ACTIVE", toStatus: "SUSPENDED", at: addDays(anchorAt, -90) },
      { suffix: "reactivated-history", kind: "REACTIVATED", fromStatus: "SUSPENDED", toStatus: "ACTIVE", at: addDays(anchorAt, -85) },
    );
  }
  for (const event of events) {
    const id = stableSeedId("company-status-event", `${fixture.slug}:${event.suffix}`);
    await createOrVerifySeedRecord({
      entity: "CompanyStatusEvent",
      naturalKey: `${fixture.slug}:${event.suffix}`,
      findExisting: () => transaction.companyStatusEvent.findUnique({ where: { id } }),
      create: () =>
        transaction.companyStatusEvent.create({
          data: {
            id,
            companyId: fixture.id,
            kind: event.kind,
            fromStatus: event.fromStatus,
            toStatus: event.toStatus,
            actorUserId: fixture.ownerUserId,
            reasonCode: `DEMO_${event.kind}`,
            correlationId: `seed-company-${fixture.slug}`,
            createdAt: event.at,
          },
        }),
      project: (row) => ({ id: row.id, companyId: row.companyId, kind: row.kind, fromStatus: row.fromStatus, toStatus: row.toStatus, actorUserId: row.actorUserId, reasonCode: row.reasonCode, correlationId: row.correlationId, createdAt: row.createdAt.toISOString() }),
      expected: { id, companyId: fixture.id, kind: event.kind, fromStatus: event.fromStatus, toStatus: event.toStatus, actorUserId: fixture.ownerUserId, reasonCode: `DEMO_${event.kind}`, correlationId: `seed-company-${fixture.slug}`, createdAt: event.at.toISOString() },
    });
  }
}

async function seedCompanyVerification(
  transaction: SeedTransaction,
  fixture: CompanyFixture,
  anchorAt: Date,
): Promise<void> {
  let supersedesRequestId: string | null = null;
  if (fixture.slug === DEMO_COMPANY_SLUG) {
    supersedesRequestId = stableSeedId("company-verification-request", `${fixture.slug}:rejected-v1`);
    await ensureVerificationRequest(transaction, {
      id: supersedesRequestId,
      naturalKey: `${fixture.slug}:rejected-v1`,
      fixture,
      status: "REJECTED",
      supersedesRequestId: null,
      createdAt: addDays(anchorAt, -170),
      evidenceMetadata: { provenance: "DEMO", cycle: 1, outcome: "domain-evidence-mismatch" },
    });
    await ensureVerificationEvents(transaction, fixture, "rejected-v1", supersedesRequestId, ["DRAFT_CREATED", "SUBMITTED", "REJECTED"], addDays(anchorAt, -170));
  }

  const currentId = stableSeedId("company-verification-request", `${fixture.slug}:current`);
  await ensureVerificationRequest(transaction, {
    id: currentId,
    naturalKey: `${fixture.slug}:current`,
    fixture,
    status: "VERIFIED",
    supersedesRequestId,
    createdAt: addDays(anchorAt, -160),
    evidenceMetadata: { provenance: "DEMO", cycle: supersedesRequestId ? 2 : 1, reviewedEvidence: ["mock-domain", "mock-register"] },
  });
  await ensureVerificationEvents(transaction, fixture, "current", currentId, ["DRAFT_CREATED", "SUBMITTED", "VERIFIED"], addDays(anchorAt, -160));
}

async function ensureVerificationRequest(
  transaction: SeedTransaction,
  input: Readonly<{
    id: string;
    naturalKey: string;
    fixture: CompanyFixture;
    status: "REJECTED" | "VERIFIED";
    supersedesRequestId: string | null;
    createdAt: Date;
    evidenceMetadata: CanonicalJsonValue;
  }>,
): Promise<void> {
  await createOrVerifySeedRecord({
    entity: "CompanyVerificationRequest",
    naturalKey: input.naturalKey,
    findExisting: () => transaction.companyVerificationRequest.findUnique({ where: { id: input.id } }),
    create: () => transaction.companyVerificationRequest.create({ data: {
      id: input.id,
      companyId: input.fixture.id,
      requestedByUserId: input.fixture.ownerUserId,
      supersedesRequestId: input.supersedesRequestId,
      status: input.status,
      evidenceMetadata: input.evidenceMetadata as Prisma.InputJsonValue,
      createdAt: input.createdAt,
    } }),
    project: (row) => ({ id: row.id, companyId: row.companyId, requestedByUserId: row.requestedByUserId, supersedesRequestId: row.supersedesRequestId, status: row.status, evidenceMetadata: row.evidenceMetadata as CanonicalJsonValue }),
    expected: { id: input.id, companyId: input.fixture.id, requestedByUserId: input.fixture.ownerUserId, supersedesRequestId: input.supersedesRequestId, status: input.status, evidenceMetadata: input.evidenceMetadata },
  });
}

async function ensureVerificationEvents(
  transaction: SeedTransaction,
  fixture: CompanyFixture,
  cycle: string,
  requestId: string,
  kinds: readonly ("DRAFT_CREATED" | "SUBMITTED" | "REJECTED" | "VERIFIED")[],
  startAt: Date,
): Promise<void> {
  const statusForKind = { DRAFT_CREATED: "DRAFT", SUBMITTED: "PENDING", REJECTED: "REJECTED", VERIFIED: "VERIFIED" } as const;
  let previous: "DRAFT" | "PENDING" | null = null;
  for (const [index, kind] of kinds.entries()) {
    const naturalKey = `${fixture.slug}:${cycle}:${kind.toLowerCase().replace("_created", "")}`;
    const id = stableSeedId("company-verification-event", naturalKey);
    const toStatus = statusForKind[kind];
    const createdAt = addDays(startAt, index * 2);
    const expected = { id, verificationRequestId: requestId, kind, fromStatus: previous, toStatus, actorUserId: fixture.ownerUserId, reasonCode: `DEMO_${kind}`, evidenceRef: `mock-storage/demo/verification/${fixture.slug}/${cycle}.json`, idempotencyKey: `seed:${naturalKey}`, correlationId: `seed-verification-${fixture.slug}`, createdAt: createdAt.toISOString() };
    await createOrVerifySeedRecord({
      entity: "CompanyVerificationEvent",
      naturalKey,
      findExisting: () => transaction.companyVerificationEvent.findUnique({ where: { id } }),
      create: () => transaction.companyVerificationEvent.create({ data: { ...expected, createdAt } }),
      project: (row) => ({ id: row.id, verificationRequestId: row.verificationRequestId, kind: row.kind, fromStatus: row.fromStatus, toStatus: row.toStatus, actorUserId: row.actorUserId, reasonCode: row.reasonCode, evidenceRef: row.evidenceRef, idempotencyKey: row.idempotencyKey, correlationId: row.correlationId, createdAt: row.createdAt.toISOString() }),
      expected,
    });
    previous = toStatus === "PENDING" || toStatus === "DRAFT" ? toStatus : previous;
  }
}

async function seedBillingProfile(
  transaction: SeedTransaction,
  fixture: CompanyFixture,
  anchorAt: Date,
): Promise<void> {
  const id = fixture.billingProfileId;
  if (!id) return;
  const expected = {
    id,
    companyId: fixture.id,
    legalName: fixture.name,
    billingContactEmail: "",
    street: "",
    postalCode: "",
    city: "",
    countryCode: "CH",
    uid: null,
    vatNumber: null,
    version: 1,
  } as const;
  await createOrVerifySeedRecord({
    entity: "CompanyBillingProfile",
    naturalKey: fixture.slug,
    findExisting: () => transaction.companyBillingProfile.findUnique({ where: { id } }),
    create: () => transaction.companyBillingProfile.create({ data: { ...expected, createdAt: addDays(anchorAt, -150) } }),
    project: (row) => ({ id: row.id, companyId: row.companyId, legalName: row.legalName, billingContactEmail: row.billingContactEmail, street: row.street, postalCode: row.postalCode, city: row.city, countryCode: row.countryCode, uid: row.uid, vatNumber: row.vatNumber, version: row.version }),
    expected,
  });
}

async function seedCompanyClaims(
  transaction: SeedTransaction,
  anchorAt: Date,
): Promise<void> {
  const requester = DEMO_ACCOUNT_FIXTURES.find((account) => account.email === "employer@demo.ch");
  const admin = DEMO_ACCOUNT_FIXTURES.find((account) => account.role === "ADMIN");
  const pendingTarget = COMPANY_FIXTURES[0];
  const rejectedTarget = COMPANY_FIXTURES[1];
  if (!requester || !admin || !pendingTarget || !rejectedTarget) throw new Error("Claim fixtures are incomplete.");
  await ensureClaim(transaction, {
    key: "pending-duplicate-demo",
    requesterId: requester.id,
    companyId: pendingTarget.id,
    status: "PENDING",
    reviewedAt: null,
    matchSignals: { provenance: "DEMO", scenario: "duplicate-company-name", confidence: "insufficient" },
    events: ["CREATED"],
    actorId: requester.id,
    anchorAt: addDays(anchorAt, -20),
  });
  await ensureClaim(transaction, {
    key: "rejected-domain-mismatch-demo",
    requesterId: requester.id,
    companyId: rejectedTarget.id,
    status: "REJECTED",
    reviewedAt: addDays(anchorAt, -12),
    matchSignals: { provenance: "DEMO", scenario: "domain-mismatch", confidence: "reviewed" },
    events: ["CREATED", "REJECTED"],
    actorId: admin.id,
    anchorAt: addDays(anchorAt, -15),
  });
}

async function ensureClaim(
  transaction: SeedTransaction,
  input: Readonly<{
    key: string;
    requesterId: string;
    companyId: string;
    status: "PENDING" | "REJECTED";
    reviewedAt: Date | null;
    matchSignals: CanonicalJsonValue;
    events: readonly ("CREATED" | "REJECTED")[];
    actorId: string;
    anchorAt: Date;
  }>,
): Promise<void> {
  const id = stableSeedId("company-claim-request", input.key);
  await createOrVerifySeedRecord({
    entity: "CompanyClaimRequest",
    naturalKey: input.key,
    findExisting: () => transaction.companyClaimRequest.findUnique({ where: { id } }),
    create: () => transaction.companyClaimRequest.create({ data: { id, requesterEmployerUserId: input.requesterId, candidateCompanyId: input.companyId, requestedRole: "OWNER", matchSignals: input.matchSignals as Prisma.InputJsonValue, evidenceSummary: "Fiktive Signale für einen klar gekennzeichneten Demo-Prüffall.", status: input.status, idempotencyKey: `seed:${input.key}`, reviewedAt: input.reviewedAt, createdAt: input.anchorAt } }),
    project: (row) => ({ id: row.id, requesterEmployerUserId: row.requesterEmployerUserId, candidateCompanyId: row.candidateCompanyId, requestedRole: row.requestedRole, approvedRole: row.approvedRole, matchSignals: row.matchSignals as CanonicalJsonValue, evidenceSummary: row.evidenceSummary, status: row.status, idempotencyKey: row.idempotencyKey, reviewedAt: iso(row.reviewedAt) }),
    expected: { id, requesterEmployerUserId: input.requesterId, candidateCompanyId: input.companyId, requestedRole: "OWNER", approvedRole: null, matchSignals: input.matchSignals, evidenceSummary: "Fiktive Signale für einen klar gekennzeichneten Demo-Prüffall.", status: input.status, idempotencyKey: `seed:${input.key}`, reviewedAt: iso(input.reviewedAt) },
  });
  for (const [index, kind] of input.events.entries()) {
    const naturalKey = `${input.key}:${kind.toLowerCase()}`;
    const eventId = stableSeedId("company-claim-event", naturalKey);
    const createdAt = addDays(input.anchorAt, index * 2);
    const expected = { id: eventId, claimRequestId: id, kind, actorUserId: input.actorId, reasonCode: `DEMO_${kind}`, evidenceRef: null, correlationId: `seed-claim-${input.key}`, createdAt: createdAt.toISOString() };
    await createOrVerifySeedRecord({
      entity: "CompanyClaimEvent",
      naturalKey,
      findExisting: () => transaction.companyClaimEvent.findUnique({ where: { id: eventId } }),
      create: () => transaction.companyClaimEvent.create({ data: { ...expected, createdAt } }),
      project: (row) => ({ id: row.id, claimRequestId: row.claimRequestId, kind: row.kind, actorUserId: row.actorUserId, reasonCode: row.reasonCode, evidenceRef: row.evidenceRef, correlationId: row.correlationId, createdAt: row.createdAt.toISOString() }),
      expected,
    });
  }
}

type OccupationContract = Readonly<{
  versionId: string;
  datasetVersionSnapshot: string;
  dataYearSnapshot: number;
  referenceUrlSnapshot: string | null;
  sourceSnapshot: string;
  disclaimer: string;
  codes: ReadonlyMap<string, Readonly<{ id: string; code: string; label: string; result: "REQUIRES_REPORTING" | "NOT_REQUIRED" | "UNKNOWN" }>>;
}>;

async function loadOccupationContract(database: PrismaClient): Promise<OccupationContract> {
  const version = await database.occupationCodeVersion.findFirst({
    where: { datasetKey: OCCUPATION_CODES_2026_FIXTURE.datasetKey, version: OCCUPATION_CODES_2026_FIXTURE.datasetVersion },
    include: { codes: true },
  });
  if (!version || version.codes.length !== 40 || version.disclaimer !== OCCUPATION_CODES_2026_FIXTURE.disclaimer) {
    throw new Error("The reviewed 40-code Jobroom reference fixture must be seeded first.");
  }
  return Object.freeze({
    versionId: version.id,
    datasetVersionSnapshot: version.version,
    dataYearSnapshot: version.datasetYear,
    referenceUrlSnapshot: version.referenceUrl,
    sourceSnapshot: `${version.source} | ${version.referenceUrl ?? "no-reference-url"}`,
    disclaimer: version.disclaimer,
    codes: new Map(version.codes.map((code) => [code.code, Object.freeze({ id: code.id, code: code.code, label: code.label, result: code.result })])),
  });
}

async function seedJob(
  transaction: SeedTransaction,
  fixture: JobFixture,
  anchorAt: Date,
  occupation: OccupationContract,
): Promise<void> {
  const company = COMPANY_FIXTURES.find((entry) => entry.id === fixture.companyId);
  const admin = DEMO_ACCOUNT_FIXTURES.find((account) => account.role === "ADMIN");
  if (!company || !admin) throw new Error(`Job dependencies are missing for ${fixture.slug}.`);
  const jobCore = { id: fixture.id, companyId: fixture.companyId, slug: fixture.slug, origin: "MANUAL" as const, sourceReference: `seed:phase-05:${fixture.slug}`, dataProvenance: "DEMO" as const, createdByUserId: company.ownerUserId, createdAt: new Date(fixture.createdAt) };
  await createOrVerifySeedRecord({
    entity: "Job",
    naturalKey: fixture.slug,
    findExisting: () => transaction.job.findUnique({ where: { id: fixture.id } }),
    create: () => transaction.job.create({ data: { ...jobCore, status: "DRAFT" } }),
    project: (row) => ({ id: row.id, companyId: row.companyId, slug: row.slug, origin: row.origin, sourceReference: row.sourceReference, dataProvenance: row.dataProvenance, createdByUserId: row.createdByUserId, createdAt: row.createdAt.toISOString() }),
    expected: { ...jobCore, createdAt: jobCore.createdAt.toISOString() },
  });

  await ensureJobRevision(transaction, fixture, company.ownerUserId);
  await ensureRevisionChildren(transaction, fixture);
  await ensureJobRevisionLifecycle(transaction, fixture);
  await ensureJobScore(transaction, fixture);
  await ensureJobReporting(transaction, fixture, admin.id, anchorAt, occupation);
  await ensureJobEvents(transaction, fixture, company.ownerUserId, admin.id);
  await ensureJobFinalState(transaction, fixture);
}

async function ensureJobRevision(
  transaction: SeedTransaction,
  fixture: JobFixture,
  ownerUserId: string,
): Promise<void> {
  const contentExpected = {
    id: fixture.revisionId,
    jobId: fixture.id,
    revisionNumber: 1,
    contentLanguage: fixture.contentLanguage,
    title: fixture.title,
    description: fixture.description,
    tasks: [...fixture.tasks],
    requirements: [...fixture.requirements],
    applicationProcessSteps: [...fixture.applicationProcessSteps],
    requiredDocumentKinds: [...fixture.requiredDocumentKinds],
    jobType: fixture.jobType,
    remoteType: fixture.remoteType,
    remoteCountryCode: fixture.remoteCountryCode,
    categoryId: fixture.categoryId,
    cantonId: fixture.cantonId,
    cityId: fixture.cityId,
    locationLabel: fixture.locationLabel,
    workloadMin: fixture.workloadMin,
    workloadMax: fixture.workloadMax,
    salaryPeriod: fixture.salaryPeriod,
    salaryMin: fixture.salaryMin,
    salaryMax: fixture.salaryMax,
    startDate: fixture.startDate,
    startByArrangement: false,
    validThrough: fixture.validThrough,
    responseTargetDays: fixture.responseTargetDays,
    applicationEffort: fixture.applicationEffort,
    inclusionStatement: fixture.inclusionStatement,
    applicationContactKind: "EMAIL",
    applicationContactValue: fixture.applicationContactValue,
    authoredByUserId: ownerUserId,
    contentChecksum: fixture.contentChecksum,
    createdAt: fixture.createdAt,
  } as const;
  const result = await createOrVerifySeedRecord({
    entity: "JobRevision",
    naturalKey: `${fixture.slug}:1`,
    findExisting: () => transaction.jobRevision.findUnique({ where: { id: fixture.revisionId } }),
    create: () => transaction.jobRevision.create({ data: {
      ...contentExpected,
      tasks: [...fixture.tasks],
      requirements: [...fixture.requirements],
      applicationProcessSteps: [...fixture.applicationProcessSteps],
      requiredDocumentKinds: [...fixture.requiredDocumentKinds],
      startDate: new Date(contentExpected.startDate),
      validThrough: new Date(contentExpected.validThrough),
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
      createdAt: new Date(contentExpected.createdAt),
    } }),
    project: (row) => ({ id: row.id, jobId: row.jobId, revisionNumber: row.revisionNumber, contentLanguage: row.contentLanguage, title: row.title, description: row.description, tasks: row.tasks, requirements: row.requirements, applicationProcessSteps: row.applicationProcessSteps, requiredDocumentKinds: row.requiredDocumentKinds, jobType: row.jobType, remoteType: row.remoteType, remoteCountryCode: row.remoteCountryCode, categoryId: row.categoryId, cantonId: row.cantonId, cityId: row.cityId, locationLabel: row.locationLabel, workloadMin: row.workloadMin, workloadMax: row.workloadMax, salaryPeriod: row.salaryPeriod, salaryMin: row.salaryMin, salaryMax: row.salaryMax, startDate: iso(row.startDate), startByArrangement: row.startByArrangement, validThrough: iso(row.validThrough), responseTargetDays: row.responseTargetDays, applicationEffort: row.applicationEffort, inclusionStatement: row.inclusionStatement, applicationContactKind: row.applicationContactKind, applicationContactValue: row.applicationContactValue, authoredByUserId: row.authoredByUserId, contentChecksum: row.contentChecksum, createdAt: row.createdAt.toISOString() }),
    expected: contentExpected,
  });
  const lifecycle = projectRevisionLifecycle(result.record);
  const expectedLifecycle = expectedRevisionLifecycle(fixture);
  const draftLifecycle = { submittedAt: null, approvedAt: null, rejectedAt: null };
  if (
    JSON.stringify(lifecycle) !== JSON.stringify(draftLifecycle) &&
    JSON.stringify(lifecycle) !== JSON.stringify(expectedLifecycle)
  ) {
    throw new SeedDataDriftError("JobRevision", `${fixture.slug}:1`);
  }
}

async function ensureJobRevisionLifecycle(
  transaction: SeedTransaction,
  fixture: JobFixture,
): Promise<void> {
  let revision = await transaction.jobRevision.findUniqueOrThrow({
    where: { id: fixture.revisionId },
  });
  const expected = expectedRevisionLifecycle(fixture);
  if (JSON.stringify(projectRevisionLifecycle(revision)) !== JSON.stringify(expected)) {
    const draft = { submittedAt: null, approvedAt: null, rejectedAt: null };
    if (JSON.stringify(projectRevisionLifecycle(revision)) !== JSON.stringify(draft)) {
      throw new SeedDataDriftError("JobRevision", `${fixture.slug}:1`);
    }
    const submittedAt = dateOrNull(fixture.submittedAt);
    if (submittedAt !== null) {
      revision = await transaction.jobRevision.update({
        where: { id: fixture.revisionId },
        data: { submittedAt },
      });
    }

    const approvedAt = dateOrNull(fixture.approvedAt);
    const rejectedAt = dateOrNull(fixture.rejectedAt);
    if (approvedAt !== null || rejectedAt !== null) {
      revision = await transaction.jobRevision.update({
        where: { id: fixture.revisionId },
        data: { approvedAt, rejectedAt },
      });
    }
  }
  if (JSON.stringify(projectRevisionLifecycle(revision)) !== JSON.stringify(expected)) {
    throw new SeedDataDriftError("JobRevision", `${fixture.slug}:1`);
  }
}

function projectRevisionLifecycle(row: Readonly<{
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
}>) {
  return {
    submittedAt: iso(row.submittedAt),
    approvedAt: iso(row.approvedAt),
    rejectedAt: iso(row.rejectedAt),
  };
}

function expectedRevisionLifecycle(fixture: JobFixture) {
  return {
    submittedAt: fixture.submittedAt,
    approvedAt: fixture.approvedAt,
    rejectedAt: fixture.rejectedAt,
  };
}

async function ensureRevisionChildren(transaction: SeedTransaction, fixture: JobFixture): Promise<void> {
  for (const benefit of fixture.benefits) {
    const expected = { id: benefit.id, jobRevisionId: fixture.revisionId, benefitCode: benefit.benefitCode, description: benefit.description, sortOrder: benefit.sortOrder };
    await createOrVerifySeedRecord({ entity: "JobRevisionBenefit", naturalKey: `${fixture.slug}:${benefit.benefitCode}`, findExisting: () => transaction.jobRevisionBenefit.findUnique({ where: { id: benefit.id } }), create: () => transaction.jobRevisionBenefit.create({ data: expected }), project: (row) => ({ id: row.id, jobRevisionId: row.jobRevisionId, benefitCode: row.benefitCode, description: row.description, sortOrder: row.sortOrder }), expected });
  }
  for (const [index, skillId] of fixture.skillIds.entries()) {
    const slot = index + 1;
    const id = stableSeedId("job-revision-skill", `${fixture.slug}:skill:${slot}`);
    const expected = { id, jobRevisionId: fixture.revisionId, skillId, required: index === 0 };
    await createOrVerifySeedRecord({ entity: "JobRevisionSkill", naturalKey: `${fixture.slug}:skill:${slot}`, findExisting: () => transaction.jobRevisionSkill.findUnique({ where: { id } }), create: () => transaction.jobRevisionSkill.create({ data: expected }), project: (row) => ({ id: row.id, jobRevisionId: row.jobRevisionId, skillId: row.skillId, required: row.required }), expected });
  }
  for (const [index, code] of fixture.languageCodes.entries()) {
    const slot = index === 0 ? "primary" : "secondary";
    const id = stableSeedId("job-revision-language", `${fixture.slug}:language:${slot}`);
    const expected = { id, jobRevisionId: fixture.revisionId, code, minLevel: index === 0 ? ("B2" as const) : ("B1" as const) };
    await createOrVerifySeedRecord({ entity: "JobRevisionLanguage", naturalKey: `${fixture.slug}:language:${slot}`, findExisting: () => transaction.jobRevisionLanguage.findUnique({ where: { id } }), create: () => transaction.jobRevisionLanguage.create({ data: expected }), project: (row) => ({ id: row.id, jobRevisionId: row.jobRevisionId, code: row.code, minLevel: row.minLevel }), expected });
  }
}

async function ensureJobScore(transaction: SeedTransaction, fixture: JobFixture): Promise<void> {
  const snapshot = fixture.scoreSnapshot;
  if (!snapshot) return;
  const id = stableSeedId("job-score-snapshot", `${fixture.slug}:v2`);
  const expected = { id, jobRevisionId: fixture.revisionId, scoreVersion: snapshot.scoreVersion, scorePoints: snapshot.scorePoints, maxPoints: snapshot.maxPoints, inputSnapshot: snapshot.inputSnapshot as unknown as CanonicalJsonValue, evidence: snapshot.evidence as unknown as CanonicalJsonValue, factorBreakdown: snapshot.factorBreakdown as unknown as CanonicalJsonValue, evidenceHash: snapshot.evidenceHash, calculatedAt: snapshot.calculatedAt.toISOString() };
  await createOrVerifySeedRecord({ entity: "JobScoreSnapshot", naturalKey: `${fixture.slug}:v2`, findExisting: () => transaction.jobScoreSnapshot.findUnique({ where: { id } }), create: () => transaction.jobScoreSnapshot.create({ data: { ...expected, inputSnapshot: expected.inputSnapshot as Prisma.InputJsonValue, evidence: expected.evidence as Prisma.InputJsonValue, factorBreakdown: expected.factorBreakdown as Prisma.InputJsonValue, calculatedAt: snapshot.calculatedAt } }), project: (row) => ({ id: row.id, jobRevisionId: row.jobRevisionId, scoreVersion: row.scoreVersion, scorePoints: row.scorePoints, maxPoints: row.maxPoints, inputSnapshot: row.inputSnapshot as CanonicalJsonValue, evidence: row.evidence as CanonicalJsonValue, factorBreakdown: row.factorBreakdown as CanonicalJsonValue, evidenceHash: row.evidenceHash, calculatedAt: row.calculatedAt.toISOString() }), expected });
}

async function ensureJobReporting(
  transaction: SeedTransaction,
  fixture: JobFixture,
  adminUserId: string,
  anchorAt: Date,
  contract: OccupationContract,
): Promise<void> {
  const code = contract.codes.get(fixture.occupationCode);
  if (!code) throw new Error(`Occupation code ${fixture.occupationCode} is missing.`);
  const id = stableSeedId("job-reporting-check", `${fixture.slug}:jobroom-2026`);
  const checkedAt = addDays(anchorAt, -5);
  const reasonSnapshot = code.result === "REQUIRES_REPORTING" ? "Die fiktive Mock-Klassifikation markiert diese Berufsart als meldepflichtig." : code.result === "NOT_REQUIRED" ? "Die fiktive Mock-Klassifikation markiert diese Berufsart als nicht meldepflichtig." : "Die fiktive Mock-Klassifikation liefert bewusst kein eindeutiges Ergebnis; eine offizielle Prüfung bleibt nötig.";
  const expected = { id, jobRevisionId: fixture.revisionId, occupationCodeVersionId: contract.versionId, occupationCodeId: code.id, occupationCodeSnapshot: code.code, occupationLabelSnapshot: code.label, result: code.result, reasonSnapshot, disclaimerSnapshot: contract.disclaimer, sourceSnapshot: contract.sourceSnapshot, datasetVersionSnapshot: contract.datasetVersionSnapshot, dataYearSnapshot: contract.dataYearSnapshot, referenceUrlSnapshot: contract.referenceUrlSnapshot, checkedByUserId: adminUserId, checkedAt: checkedAt.toISOString() };
  await createOrVerifySeedRecord({ entity: "JobReportingCheck", naturalKey: `${fixture.slug}:jobroom-2026`, findExisting: () => transaction.jobReportingCheck.findUnique({ where: { id } }), create: () => transaction.jobReportingCheck.create({ data: { ...expected, checkedAt } }), project: (row) => ({ id: row.id, jobRevisionId: row.jobRevisionId, occupationCodeVersionId: row.occupationCodeVersionId, occupationCodeId: row.occupationCodeId, occupationCodeSnapshot: row.occupationCodeSnapshot, occupationLabelSnapshot: row.occupationLabelSnapshot, result: row.result, reasonSnapshot: row.reasonSnapshot, disclaimerSnapshot: row.disclaimerSnapshot, sourceSnapshot: row.sourceSnapshot, datasetVersionSnapshot: row.datasetVersionSnapshot, dataYearSnapshot: row.dataYearSnapshot, referenceUrlSnapshot: row.referenceUrlSnapshot, checkedByUserId: row.checkedByUserId, checkedAt: row.checkedAt.toISOString() }), expected });
}

async function ensureJobEvents(
  transaction: SeedTransaction,
  fixture: JobFixture,
  ownerUserId: string,
  adminUserId: string,
): Promise<void> {
  for (const event of fixture.statusEvents) {
    const actorUserId = ["REVIEW_STARTED", "CHANGES_REQUESTED", "APPROVED", "REJECTED"].includes(event.kind) ? adminUserId : ownerUserId;
    const expected = { id: event.id, jobId: fixture.id, jobRevisionId: fixture.revisionId, kind: event.kind, fromStatus: event.fromStatus, toStatus: event.toStatus, actorUserId, reasonCode: `DEMO_${event.kind}`, idempotencyKey: event.idempotencyKey, correlationId: `seed-job-${fixture.slug}`, createdAt: event.createdAt };
    await createOrVerifySeedRecord({ entity: "JobStatusEvent", naturalKey: `${fixture.slug}:${event.kind.toLowerCase()}`, findExisting: () => transaction.jobStatusEvent.findUnique({ where: { id: event.id } }), create: () => transaction.jobStatusEvent.create({ data: { ...expected, kind: event.kind as Prisma.JobStatusEventCreateInput["kind"], createdAt: new Date(event.createdAt) } }), project: (row) => ({ id: row.id, jobId: row.jobId, jobRevisionId: row.jobRevisionId, kind: row.kind, fromStatus: row.fromStatus, toStatus: row.toStatus, actorUserId: row.actorUserId, reasonCode: row.reasonCode, idempotencyKey: row.idempotencyKey, correlationId: row.correlationId, createdAt: row.createdAt.toISOString() }), expected });
  }
}

async function ensureJobFinalState(transaction: SeedTransaction, fixture: JobFixture): Promise<void> {
  const released = wasPublished(fixture.status);
  const expected = {
    status: fixture.status,
    currentRevisionId: fixture.revisionId,
    publishedRevisionId: released ? fixture.revisionId : null,
    publishedAt: released ? fixture.publishedAt : null,
    expiresAt: released ? fixture.validThrough : null,
    publishedCategoryId: released ? fixture.categoryId : null,
    publishedCantonId: released ? fixture.cantonId : null,
    publishedCityId: released ? fixture.cityId : null,
    publishedSalaryPeriod: released ? fixture.salaryPeriod : null,
    publishedSalaryMin: released ? fixture.salaryMin : null,
    publishedSalaryMax: released ? fixture.salaryMax : null,
  } as const;
  let job = await transaction.job.findUniqueOrThrow({ where: { id: fixture.id } });
  const actual = projectJobState(job);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    if (job.status !== "DRAFT" || job.currentRevisionId !== null || job.publishedRevisionId !== null) {
      throw new SeedDataDriftError("Job", fixture.slug);
    }
    job = await transaction.job.update({ where: { id: fixture.id }, data: {
      status: fixture.status,
      currentRevisionId: fixture.revisionId,
      publishedRevisionId: released ? fixture.revisionId : null,
      publishedAt: released ? dateOrNull(fixture.publishedAt) : null,
      expiresAt: released ? new Date(fixture.validThrough) : null,
      publishedCategoryId: released ? fixture.categoryId : null,
      publishedCantonId: released ? fixture.cantonId : null,
      publishedCityId: released ? fixture.cityId : null,
      publishedSalaryPeriod: released ? fixture.salaryPeriod : null,
      publishedSalaryMin: released ? fixture.salaryMin : null,
      publishedSalaryMax: released ? fixture.salaryMax : null,
    } });
  }
  if (JSON.stringify(projectJobState(job)) !== JSON.stringify(expected)) {
    throw new SeedDataDriftError("Job", fixture.slug);
  }
}

function projectJobState(row: Readonly<{ status: string; currentRevisionId: string | null; publishedRevisionId: string | null; publishedAt: Date | null; expiresAt: Date | null; publishedCategoryId: string | null; publishedCantonId: string | null; publishedCityId: string | null; publishedSalaryPeriod: string | null; publishedSalaryMin: number | null; publishedSalaryMax: number | null }>) {
  return { status: row.status, currentRevisionId: row.currentRevisionId, publishedRevisionId: row.publishedRevisionId, publishedAt: iso(row.publishedAt), expiresAt: iso(row.expiresAt), publishedCategoryId: row.publishedCategoryId, publishedCantonId: row.publishedCantonId, publishedCityId: row.publishedCityId, publishedSalaryPeriod: row.publishedSalaryPeriod, publishedSalaryMin: row.publishedSalaryMin, publishedSalaryMax: row.publishedSalaryMax };
}

function wasPublished(status: DemoJobStatus): boolean {
  return ["PUBLISHED", "PAUSED", "EXPIRED", "CLOSED"].includes(status);
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function dateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function assertAnchor(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("A valid companies/jobs anchorAt is required.");
  }
}
