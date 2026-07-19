# Phase 15 — SEO & Search

> **PortalGERM target status: NOT IMPLEMENTED.** Any URL counts, rendered metadata or pass claims below are target assertions. This phase depends on Boost semantics and cluster liquidity (ADR-003/024/026).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 15. Read [99-rules-quickref.md](./99-rules-quickref.md) §20, §26 before starting.

## Goal

Polish search and SEO: server-side full-text-ish search via Postgres, URL-driven filters & pagination, JSON-LD JobPosting on detail pages, sitemap, robots.txt, slug logic with Umlaut handling, canton/category landing pages, metadata, and `noindex` everywhere private. Performance: dashboards usable with seeded data, no N+1 in search.

## Prerequisites

- [ ] Phase 02 indexes (`Job.slug`, composite `(status, publishedAt)`, etc.)
- [ ] Phase 03 `lib/search/query.ts`, `lib/search/ranking.ts`, `lib/utils/slug.ts`
- [ ] Phase 07 public pages already query the search helper
- [ ] Phase 13 Boost lifecycle, sponsorship label and ranking constraints complete

## Deliverables (checklist)

### Postgres-backed search

> **Decision (MVP):** Prisma/Postgres case-insensitive `contains` over the Job's current approved/published `JobRevision` title/tasks/requirements/offer plus public Company name. Never search a stale Draft revision. The `tsvector` + GIN path is **deferred**. See ADR-003.

- [ ] `searchJobs({ keyword, ... })` in `lib/search/query.ts` using `contains` (`mode: 'insensitive'`) on the text fields; list payload still returns **only card-level fields**
- [ ] Relevance: `lib/search/relevance.ts` deterministic proxy (title 3 / company 2 / body 1) — gives `sort=relevance` and the ranking's relevance tier real meaning without tsvector
- [ ] *(Deferred, not MVP — ADR-003)* `tsvector`: generated column + GIN index + `to_tsquery('german', …)` — intentionally **not built**; `contains` + relevance proxy is the MVP path
- [ ] Filter parsing from `URLSearchParams`: keyword, canton (slug or id), city (slug or id), radius (km, used with city lat/lng if present), category (slug or id), workloadMin/Max, jobType (multi), remoteType (multi), salaryDisclosed (bool), `salaryPeriod`, evidence-based response status, companyVerified (bool), language (multi), applicationEffort (multi), sort (`relevance|newest|fairjobscore|salary|response`). `boosted` is not a user sort. `sort=salary` requires one explicit `salaryPeriod`; absent/invalid period returns typed validation/UI prompt rather than comparing YEARLY/MONTHLY/HOURLY values.
- [ ] Pagination: opaque `after` cursor plus `pageSize` (default 20, max 50). Cursor encodes/version-checks the complete stable ranking tuple and filter/sort fingerprint; invalid/stale cursor yields a safe restart state.
- [ ] Server-side ranking via `lib/search/ranking.ts`: canonical public eligibility/relevance first. Select at most three first-page sponsored IDs using `(relevanceTier DESC,relevanceScore DESC,fairScore DESC NULLS LAST,publishedAt DESC,id ASC)` independent of the user's organic sort; label them, then append the selected-sort organic sequence excluding those IDs. The signed cursor contains query/filter/sort fingerprint, policy/config version, `rankingAsOf`, selected sponsored IDs and the complete organic tuple. Later pages recheck current public eligibility, continue excluding those IDs even after Boost expiry and replenish zero. Remaining boosted Jobs retain normal organic eligibility.
- [ ] Exact ascending comparison tuples (direction encoded in cursor) are:
  - `relevance`: `zoneRank ASC, relevanceTier DESC, relevanceScore DESC, fairScore DESC NULLS LAST, publishedAt DESC, id ASC`
  - `newest`: `zoneRank ASC, publishedAt DESC, id ASC`
  - `fairjobscore`: `zoneRank ASC, fairScore DESC NULLS LAST, publishedAt DESC, id ASC`
  - `salary`: within the required exact SalaryPeriod only, `zoneRank ASC, salaryMinChf DESC NULLS LAST, salaryMaxChf DESC NULLS LAST, publishedAt DESC, id ASC`; cursor/fingerprint includes SalaryPeriod
  - `response`: `zoneRank ASC, responseEvidenceKnown DESC, onTimeRateBps DESC, medianFirstResponseMinutes ASC NULLS LAST, publishedAt DESC, id ASC` under `EMPLOYER_RESPONSE_POLICY_V1`; unknown (<20 due cases) always follows known
  `zoneRank=0` exists only for the selected first-slice Sponsored Zone; otherwise `1`. Cursor encodes schema version, fingerprint, `rankingAsOf`, selected Sponsored IDs, zoneRank, null flags, ordered organic values and id. Null order is fixed as shown; invalid version/fingerprint restarts safely. Fixed-clock, Boost-expiry and concurrent publish/expiry tests lock every tuple.
- [ ] **Effective job expiry:** every public/search/similar/sitemap/Alert/Apply query calls `isJobPubliclyEligible`; published Jobs require non-null `expiresAt > now` equal to current approved Revision `validThrough`, plus Company ACTIVE/current VERIFIED/LIVE and no restriction. Reads never write on GET. `syncJobStatusProjection({now})` is an explicit idempotent operations command (ADR-004).
- [ ] Avoid N+1: include company + canton + city + boost relations efficiently with `select`/`include`

### Slugs

- [ ] `lib/utils/slug.ts` final: lowercase + Umlaut map (`ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, plus French/Italian accent stripping for cantons like `Genève → geneve`, `Zürich → zuerich`, `Neuchâtel → neuchatel`, `Schweiz → schweiz`)
- [ ] Job slug generation: `slugify(title) + '-' + companyShortRef + '-' + shortIdSegment` to keep stable
- [ ] On title edit: keep original slug; never silently change URLs (avoid 404 on already-indexed jobs). Add a "redirected from" mechanism only if needed (out of scope for MVP).

### `/sitemap.xml`

- [ ] Implement `app/sitemap.ts` exporting public URLs:
  - `/`
  - `/jobs`
  - All currently eligible published `Job` detail URLs under the documented freshness policy
  - only Canton/Category/combination pages whose versioned Content **and** Liquidity Gate passes; all other cluster routes stay `noindex` and absent
  - `/companies` and Company profiles satisfying canonical `isCompanyPubliclyEligible`: `status=ACTIVE`, closed validated/sanitized public profile projection, no public-hide restriction and `dataProvenance=LIVE` outside Demo mode. P0 has no separate profile review; verification controls the badge/Job publication, not profile existence.
  - `/salary-radar`
  - `/guide` and only current reviewed/published Guide `ContentPage` revisions that also pass the indexability gate
  - `/pricing`, `/employers`, `/employers/post-job`, `/employers/talent-radar`, `/employers/employer-branding`, `/employers/xml-import`
- [ ] Exclude all private routes
- [ ] `lastModified` from row updatedAt

> **Decision (MVP):** Sitemap includes currently eligible LIVE jobs, canonical ACTIVE public-profile-eligible companies, gated reviewed/published LIVE Guide Content revisions and only gated cluster pages. If a dynamic type exceeds the supported single-sitemap bound, create sitemap indexes/chunks; never silently truncate or index thin/Demo clusters.

### `/robots.txt`

- [ ] Implement `app/robots.ts` exporting:
  ```
  User-agent: *
  Allow: /
  Disallow: /candidate/
  Disallow: /employer/
  Disallow: /admin/
  Disallow: /api/
  Sitemap: <APP_URL>/sitemap.xml
  ```

### JSON-LD on job detail (`/jobs/[slug]`)

- [ ] Inject `<script type="application/ld+json">` with a valid `JobPosting`:
  - `@context`, `@type`, `title`, `description` (sanitized plain text), `datePosted`, required `validThrough` from non-null `expiresAt`, `employmentType` (mapped from `JobType`), `hiringOrganization` (with `@type: Organization`, `name`, reviewed self-hosted `logo`, `sameAs: company.website`), `jobLocation` (Place with PostalAddress: addressCountry `CH`, addressRegion canton name, addressLocality city), `baseSalary` (only when projected `salaryMin`/`salaryMax` present, with `@type: MonetaryAmount`, `currency: CHF`, `value: { @type: 'QuantitativeValue', minValue, maxValue, unitText: SalaryPeriod }`), `directApply` boolean
  - For remote jobs add `jobLocationType: TELECOMMUTE`
- [ ] Validate via Google Rich Results test before declaring done

### Canton & category landing pages

- [ ] `/jobs/kanton/[canton]/page.tsx`, `/jobs/kategorie/[category]/page.tsx` and `/jobs/kanton/[canton]/kategorie/[category]/page.tsx`:
  - Resolve slug → entity; 404 on miss
  - H1 + substantive localized intro/guide sections from the current reviewed/published `ContentRevision`; do not dynamically stitch thin boilerplate
  - Server-side fetch of jobs filtered by canton/category, with pagination & ranking
  - `<link rel="canonical">` to itself
  - Metadata: `title`, `description`, `openGraph` derived from the same approved revision plus current aggregate facts; no unreviewed generated copy
- [ ] `CLUSTER_LAUNCH_POLICY_V1` makes the strategy gate executable for one exact Canton×Category pair over `window=[evaluatedAt-30d,evaluatedAt)` (Candidate activity uses its stated 90-day subwindow). An assessment is `READY` only when every threshold holds: ≥15 distinct currently VERIFIED/ACTIVE LIVE Companies with an eligible Job in the pair; ≥50 current eligible LIVE Jobs; ≥200 distinct COMPLETE LIVE Candidates whose preferences include the pair and who produced `JOB_SAVED|APPLICATION_SUBMITTED|JOB_ALERT_ACTIVATED` in the preceding 90 days; median distinct Applications per eligible Job submitted in the 30-day window ≥3 (ordinary median; even sample arithmetic mean, persisted exactly as `medianApplicationsTimes2>=6`); ≥7000 basis points of due Applications receive their first canonical `EMPLOYER_RESPONSE_RECORDED` by `ApplicationSubmissionSnapshot.responseTargetDays`; and ≥8000 basis points of the versioned promoted-query set return ≥5 relevant eligible LIVE Jobs. Denominators and zero-denominator fail closed; DEMO/TEST rows are excluded.
- [ ] `evaluateClusterLaunch` writes the immutable assessment/evidence hash. Separate capability-checked `approveClusterForProduct` and `approveClusterForOps` events with reason are required before idempotent `activateCluster`; activation is LIVE-only and valid seven days (`evaluatedAt <= now < validUntil`). Re-evaluation supersedes rather than edits. Revoke/expiry immediately removes acquisition/index eligibility without mutating on GET; an explicit projector may persist expiry.
- [ ] `isClusterIndexable(canton,category,now)` requires that current activated assessment **and** a current reviewed/published LIVE `ContentRevision` for the exact pair. A Canton-only or Category-only landing is indexable only with its own current reviewed/published LIVE dimension Content and at least one currently indexable child pair; it does not sum several thin pairs to reach 50. Zürich/Aargau/Bern × Gesundheit/Pflege or Engineering/Technik are candidates, not automatically six indexable pages. Every failing route remains useful and `noindex,follow`, absent from Sitemap and paid/organic acquisition.

> **Prioritätsschnitt:** Route, Canonical und Gate-Mechanik für die Startpaare sind P0, damit Demo/Pilot korrekt und sicher funktionieren. Öffentliche organische Akquise über eine Kombination bleibt REQ-MKT-005/P1 und startet erst nach LIVE-Liquiditäts-, Content- und Ops-Freigabe; P0-Demo-Zahlen erfüllen dieses Marktgate nie.

### Canonical URLs

- [ ] On `/jobs/[slug]` set canonical to `${APP_URL}/jobs/<slug>`
- [ ] On `/companies/[slug]` similarly
- [ ] On canton/category/combination landings similarly
- [ ] `/jobs` query state is normalized by an allowlisted serializer (stable parameter order, duplicate/default/empty removal, invalid value rejection). Arbitrary filtered/search/cursor URLs use canonical `/jobs`, `noindex,follow`, and are excluded from Sitemap. When state is exactly an indexable Canton, Category or launch-pair filter with no keyword/sort/cursor/extra filter, server redirects to the clean landing route; clean landing pages self-canonicalize. This prevents multiple parameter orders from becoming competing canonicals.

### Metadata defaults

- [ ] `app/(public)/layout.tsx` provides default `metadata` (title template `%s | SwissTalentHub`, description, openGraph, twitter)
- [ ] Each public page `export const metadata` overrides title/description appropriately (German)

### `noindex` on private routes

- [ ] `app/{candidate,employer,admin}/layout.tsx` set `metadata.robots = { index: false, follow: false }`
- [ ] `/reset-password`, `/invite/[token]`, `/support/[id]`, `/alerts/unsubscribe/[token]`, `/mock/checkout/[orderId]` and non-production `/dev/mailbox` also explicitly set `noindex,nofollow`, dynamic/no-store and strict Referrer-Policy outside those layouts; sitemap/Canonical never contains token/order/case ids
- [ ] Confirm via `view-source:` on production build

### Referral attribution (P1 gated)

- [ ] When `REQ-GRW-003` is explicitly released, create rotatable opaque Referral links only for allowlisted public Job/Company/Guide targets; URLs never contain Candidate, Application, ContactRequest, email or company-private identifiers
- [ ] Resolve code → validate active/public target → record one pseudonymous, bounded-window Attribution under dedupe/rate controls → redirect to canonical target. Self-referral, replay, bot bursts and expired/revoked codes are rejected or flagged without leaking the owner.
- [ ] Conversion attribution uses allowlisted public funnel events and expiry/retention; no cross-device identity stitching and no financial reward until separate Legal/Fraud/Commercial approval
- [ ] Locked/inactive state creates no referral models/cookie; consent/cookie treatment and campaign source retention are a Go-live decision

### Performance

- [ ] Search query uses indexed Job publication projections (`status`, `publishedAt`, `publishedCantonId`, `publishedCategoryId`, published salary fields, `expiresAt`) and joins the current published Revision only for approved text/structured filters
- [ ] Avoid loading whole `JobRevision.tasks/requirements/offer` on list views — query the current published revision for filtering/ranking but return only card-level projection fields
- [ ] Memoize per-request company/canton/city lookups only if needed at seeded MVP volumes; otherwise document why indexed columns + minimal `select` are enough
- [ ] Keyset/cursor query applies the same complete global ranking tuple and fetches `pageSize + 1`; no `OFFSET` drift under concurrent publish/expiry, and `pageSize` is capped at 50

### URL state

- [ ] Filters reflected in URL (e.g. `/jobs?keyword=react&canton=zh&workloadMin=80&sort=relevance&after=<opaque>`); changing any filter/sort clears the cursor
- [ ] On filter change the URL updates (server-side or via `router.replace` with `scroll: false`)
- [ ] Empty-state shows a "Filter zurücksetzen" link

## Files to create / modify

- `app/sitemap.ts`, `app/robots.ts`
- `app/(public)/jobs/[slug]/JobJsonLd.tsx`
- `app/(public)/jobs/kanton/[canton]/page.tsx`, `app/(public)/jobs/kategorie/[category]/page.tsx`, `app/(public)/jobs/kanton/[canton]/kategorie/[category]/page.tsx`
- `lib/search/query.ts`, `lib/search/ranking.ts`, `lib/search/relevance.ts` finalised
- `lib/jobs/effective-status.ts` plus explicit `syncJobStatusProjection` maintenance command; no mutation on public GET
- `lib/utils/slug.ts` finalised
- Layout files updated for `metadata.robots`

## Rules to respect (from `99-rules-quickref.md`)

- §20 — public indexable, dashboards noindex, JSON-LD JobPosting, canton/category landings, slugs
- §26 — server-side filtering, pagination, indexed queries, avoid client-side full lists
- §10 — sanitize HTML in JSON-LD `description`

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] `/sitemap.xml` returns exactly the eligible current public entities/cluster pages from the Seed manifest and Content/Liquidity Gate; tests assert 0 `/admin|/employer|/candidate` paths rather than a stale hardcoded URL count
- [ ] `/robots.txt` returns the listed disallow rules *(candidate/employer/admin/api + sitemap link)*
- [ ] `/jobs/[slug]` exposes a valid JSON-LD JobPosting
- [ ] A gated Canton page lists eligible jobs with the relevant-first capped sponsored-zone contract; an ungated Canton page is noindex and absent from sitemap
- [ ] An isolated test factory (never the Demo seed) creates a complete LIVE `CLUSTER_LAUNCH_POLICY_V1` cohort and proves all six metrics + two approvals + current content make the pair self-canonical/indexable/in Sitemap. Each threshold-minus-one, zero denominator, expired/revoked/one-approval, missing content and DEMO provenance is `noindex,follow` and absent. Canton/Category parents require one passing child plus their own content. Equivalent clean filter state redirects to the pair route; arbitrary filters canonicalize to `/jobs` and stay noindex.
- [ ] `/jobs?keyword=…&after=<cursor>` returns the next deterministic slice using the same ranking tuple; records inserted/expired between requests cause neither duplicate nor unauthorized/ineligible result, and an invalid cursor gets a safe restart response
- [ ] Lighthouse SEO target ≥95 is measured against the production build in the implementation environment; record the actual result and limitations
- [ ] Production-build response/source for `/candidate/dashboard` proves `noindex`; separate response tests prove private `no-store` behavior where required
- [ ] Sensitive out-of-layout route matrix proves no-store/noindex/strict-referrer, generic invalid-token/case/order handling, and zero URL/id leakage into response Canonical or structured logs
- [ ] Search performance budget is benchmarked with the named realistic dataset and `EXPLAIN`; record p50/p95 and query plans rather than accepting an unmeasured fixed claim

## Common pitfalls

- Sitemap including private routes by accident — reuse canonical public predicates (`Job` effective eligibility, Company `status = ACTIVE` plus approved public verification/content rules); never rely on a nonexistent `Company.suspended` Boolean
- Forgetting JSON-LD `validThrough` for time-bound jobs
- Slug collisions when two jobs share the same title — use a short id segment
- Returning all job columns to a card list — wastes bandwidth, slow
- Using `noindex` on a page that should be indexable (e.g. canton landing) — double-check robots meta only on dashboards

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Acquire relevant organic users through genuinely useful pages and stable search, without thin content, privacy leakage or paid irrelevance. |
| Roles / requirements | Public/Growth/Candidate; REQ-MKT-001/002/005, BST-001, DATA-001, SEC-002. |
| Prerequisites | 07 and 13 explicitly; real Published content/jobs from 10/11; ADR-003/024/026. |
| Routes/actions | Harden `/jobs`; canton/category and approved combinations; sitemap/robots; canonical/metadata/JSON-LD; Search/Alert CTA events. |
| Data | Bounded public Read Models, slug history, immutable `ClusterLaunchAssessment/Event`, reviewed Content and privacy-safe aggregates; no Candidate/Radar/private paths. |
| Validation | Query/sort contract, stable global ranking tuple/cursor, canonical params, slug collision/redirect, indexability threshold, safe JSON serialization. |
| Authorization/cache | Published/current/non-suspended only; private layouts noindex + no-store independent of robots; Sitemap public allowlist. |
| Audit/analytics | Content/admin changes audited by owner phase; minimal search/index metrics. No raw query PII beyond reviewed retention. |
| UX/mobile | invalid/no result alternatives, URL-persistent Filter Sheet, sponsored labels, helpful unique cluster content, pagination/canonical state. |
| Seed | liquid/non-liquid cluster, duplicate slugs, draft/expired/suspended, multi-language/umlaut, boosted relevance boundaries. |
| Tests | ranking before pagination/no duplicates, all sort modes, JSON-LD safe/schema, sitemap/robots/private exclusions, canonical/noindex gate, query plans/performance. |
| Verification | HTTP/URL matrix, sitemap parse, structured-data check where available, `EXPLAIN`, mobile search. Expected 0 thin/private entries and deterministic pages. |
| Risks / limitations | `contains` is allowed only if correctness/performance passes; otherwise pull SQL/FTS forward. Programmatic scale waits for liquidity. |
| Definition of Done | Every indexed URL has unique value/current inventory and correct canonical; public search is relevant, stable, transparent and private-safe. |
