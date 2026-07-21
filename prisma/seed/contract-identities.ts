import {
  buildBillingOpsSeedIdentities,
  type BillingCompanyHandle,
  type BillingJobHandle,
} from "@/prisma/seed/blocks/billing-ops";
import { REFERENCE_CATALOG_SEED_IDENTITIES } from "@/prisma/seed/blocks/reference-catalog";
import type { SeedIdentityRecord } from "@/prisma/seed/contract";
import {
  AUTH_RBAC_SEED_IDENTITIES,
  CANDIDATE_WORKFLOW_SEED_IDENTITIES,
  COMPANY_FIXTURES,
  COMPANIES_JOBS_SEED_IDENTITIES,
  DEMO_ACCOUNT_FIXTURES,
  EMPLOYER_CORE_SEED_IDENTITIES,
  buildJobFixtures,
} from "@/prisma/seed/fixtures";
import { mergeSeedIdentitySets } from "@/prisma/seed/identity-catalog";

const CONTRACT_PLANNING_ANCHOR = new Date("2026-01-01T00:00:00.000Z");

export type SeedPlanningGraph = Readonly<{
  adminUserId: string;
  companies: readonly BillingCompanyHandle[];
  identities: readonly SeedIdentityRecord[];
  jobs: readonly BillingJobHandle[];
}>;

/**
 * Builds the complete semantic identity graph before the manifest anchor row is
 * written. Dates may shape fixture values, but never IDs or natural keys.
 */
export function buildSeedPlanningGraph(): SeedPlanningGraph {
  const companies = Object.freeze(
    COMPANY_FIXTURES.map(
      ({ id, name, ownerMembershipId, ownerUserId, planCode, slug }) =>
        Object.freeze({
          id,
          name,
          ownerMembershipId,
          ownerUserId,
          planCode,
          slug,
        }),
    ),
  );
  const jobs = Object.freeze(
    buildJobFixtures(CONTRACT_PLANNING_ANCHOR).map((job) =>
      Object.freeze({
        companyId: job.companyId,
        id: job.id,
        publishedRevisionId: wasPublished(job.status) ? job.revisionId : null,
        revisionId: job.revisionId,
        slug: job.slug,
        status: job.status,
      }),
    ),
  );
  const admin = DEMO_ACCOUNT_FIXTURES.find(
    (account) => account.role === "ADMIN",
  );
  if (admin === undefined) {
    throw new Error(
      "The Phase-05 identity contract requires one admin account.",
    );
  }

  const identities = mergeSeedIdentitySets(
    REFERENCE_CATALOG_SEED_IDENTITIES,
    COMPANIES_JOBS_SEED_IDENTITIES,
    AUTH_RBAC_SEED_IDENTITIES,
    EMPLOYER_CORE_SEED_IDENTITIES,
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    buildBillingOpsSeedIdentities({ companies, jobs }),
  );

  return Object.freeze({
    adminUserId: admin.id,
    companies,
    identities,
    jobs,
  });
}

function wasPublished(status: string): boolean {
  return ["PUBLISHED", "PAUSED", "EXPIRED", "CLOSED"].includes(status);
}
