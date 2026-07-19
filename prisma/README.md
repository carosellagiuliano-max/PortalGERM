# Phase-02 database contract

`schema.prisma` is the typed application-facing model. The committed migrations are the deployable database contract and additionally contain PostgreSQL checks, partial unique indexes, composite tenant/scope foreign keys, exclusion constraints, and lifecycle triggers that Prisma cannot express completely.

The audited Phase-02 inventory contains 124 models/tables, 119 closed enums and the exact 116-member `AuditAction` contract. These counts are drift signals, not substitutes for the named invariant tests.

## Model groups

| Group | Authoritative roots | Database-owned invariants |
|---|---|---|
| Identity and tenancy | `User`, `Credential`, `Session`, `Company`, `CompanyMembership` | normalized unique email, hashed tokens, one retained active owner, company-scoped memberships and assignments |
| Candidate and jobs | `CandidateProfile`, `CandidatePreference`, `Job`, `JobRevision`, `JobScoreSnapshot` | complete-onboarding predicates, immutable submitted/published evidence, revision and location scope |
| Applications and messaging | `Application`, `ApplicationSubmissionSnapshot`, `Conversation`, `Message` | one application and snapshot, applicant-owned CV, origin XOR, company/principal scope |
| Talent Radar and privacy | `CandidateConsent`, `RadarProfile`, `RadarSearchSession`, `EmployerContactRequest`, `IdentityRevealGrant`, `PrivacyRequest` | safe eligibility projection, tenant-scoped opaque identities, funded contact request, encrypted reveal scope, typed privacy outcomes |
| Billing and fulfillment | `PlanVersion`, `ProductVersion`, `EmployerSubscription`, `Order`, `Invoice`, `CreditLedgerEntry`, `JobBoost` | half-open non-overlapping versions, integer-Rappen snapshots, typed line context, append-only non-negative ledger, exact funding |
| Import and operations | `ImportSource`, `ImportDecision`, `AuditLog`, `AnalyticsEvent`, `ContentRevision`, `SupportCase` | licensed company scope, append-only evidence, closed taxonomies, immutable reviewed content |

All relations use `ON DELETE RESTRICT`. Phase 02 therefore establishes a fail-closed soft-tombstone baseline; the final retention/anonymization policy remains a Legal go-live decision and must not be simulated with cascading deletes.

## Migration policy

- Use `npm run db:migrate` / `prisma migrate deploy`; `db push` is not completion evidence.
- Use `npm run db:migrate:status` after deployment.
- Never edit an already deployed migration. Add a new migration after Phase 02 has been released.
- A raw Prisma diff is intentionally not empty because Prisma cannot model every custom composite FK, partial index, exclusion constraint or trigger. Never apply generated drop/rename SQL without reconciling it against this stricter migration and the schema contract tests.
- Prisma `uuid()` defaults are client-side. Direct SQL fixtures provide UUIDs explicitly.
- Effective ranges are half-open `[validFrom, validTo)`. Adjacent versions are valid and switch exactly at the boundary.
- Billing amounts are integer Rappen. Salary reference data uses whole CHF.
- Catalog/demo rows are intentionally deferred to Phase 05; the Phase-02 seed only verifies the migrated technical contract.

The integration suite creates a uniquely named temporary database from `TEST_DATABASE_URL`, applies all committed migrations, asserts named constraints (including concurrent writes), and drops only that allowlisted temporary database.
