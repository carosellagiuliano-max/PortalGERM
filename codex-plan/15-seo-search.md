# Phase 15 — SEO & Search

> **PortalGERM status: IMPLEMENTIERT UND VERIFIZIERT (MVP).** Der unveränderliche Code-Commit `f3f6bcc29eeafb3fe3b3c37360782ef9014aa7d4` erfüllt den freigegebenen Phase-15-MVP-Vertrag; die reproduzierbaren Nachweise stehen in [Phase-15-Evidence](./evidence/2026-07-22-phase-15.md). Referral Attribution, Sitemap-Index/Chunking und Redirect-Historie bleiben ausdrücklich nachgelagert. Ein JobPosting-Logo wird bis zu einer geprüften öffentlichen Asset-Projektion sicher weggelassen.

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 15. Read [99-rules-quickref.md](./99-rules-quickref.md) §20, §26 before starting.

## Goal

Polish search and SEO: server-side full-text-ish search via Postgres, URL-driven filters & pagination, JSON-LD JobPosting on detail pages, sitemap, robots.txt, slug logic with Umlaut handling, canton/category landing pages, metadata, and `noindex` everywhere private. Performance: dashboards usable with seeded data, no N+1 in search.

## Prerequisites

- [x] Phase 02 indexes (`Job.slug`, composite `(status, publishedAt)`, etc.)
- [x] Phase 03 `lib/search/query.ts`, `lib/search/ranking.ts`, `lib/utils/slug.ts`
- [x] Phase 07 public pages already query the search helper
- [x] Phase 13 Boost lifecycle, sponsorship label and ranking constraints complete

## Deliverables (checklist)

### Postgres-backed search

> **Decision (MVP):** Die öffentliche Suche verwendet parameterisiertes PostgreSQL-SQL über ausschliesslich die aktuelle freigegebene und publizierte `JobRevision`. Titel, Firmenname und Body werden per `normalize(lower(...), NFKD)` normalisiert und mit `LIKE` verglichen; die Gewichtung Titel 3 / Firma 2 / Body 1 wird in der Datenbank berechnet. Sponsoring, organische Sortierung und vollständige Keyset-Tupel werden global vor der begrenzten Card-Hydration angewandt. Prisma `contains` wurde wegen der benötigten globalen Ranking-/Pagination-Semantik nicht beibehalten. `tsvector` und GIN bleiben gemäss ADR-003 deferred.

- [x] `searchJobs({ keyword, ... })` in der server-only Fassade `lib/search/query.ts`; die parameterisierte SQL-Abfrage in `lib/jobs/public-read-model.ts` durchsucht nur aktuelle freigegebene/publizierte Texte und liefert ausschliesslich Card-Felder
- [x] Relevance: deterministische Datenbankgewichtung Titel 3 / Firma 2 / Body 1; `lib/search/relevance.ts` hält den gemeinsamen Relevance-Vertrag
- [ ] *(Deferred, not MVP — ADR-003)* `tsvector`: generated column + GIN index + `to_tsquery('german', …)` — intentionally **not built**; normalized parameterized SQL/`LIKE` plus database relevance is the MVP path
- [x] Filter parsing from `URLSearchParams`: keyword, canton (slug or id), city (slug or id), radius (km, used with city lat/lng if present), category (slug or id), workloadMin/Max, jobType (multi), remoteType (multi), salaryDisclosed (bool), `salaryPeriod`, evidence-based response status, companyVerified (bool), language (multi), applicationEffort (multi), sort (`relevance|newest|fairjobscore|salary|response`). `boosted` is not a user sort. `sort=salary` requires one explicit `salaryPeriod`; absent/invalid period returns typed validation/UI prompt rather than comparing YEARLY/MONTHLY/HOURLY values.
- [x] Pagination: opaque `after` cursor plus `pageSize` (default 20, max 50). Cursor encodes/version-checks the complete stable ranking tuple and filter/sort fingerprint; invalid/stale cursor yields a safe restart state.
- [x] Server-side ranking in `lib/jobs/public-read-model.ts`: canonical public eligibility/relevance first. Select at most three first-page sponsored IDs using `(relevanceTier DESC,relevanceScore DESC,fairScore DESC NULLS LAST,publishedAt DESC,id ASC)` independent of the user's organic sort; label them, then append the selected-sort organic sequence excluding those IDs. The signed cursor contains query/filter/sort fingerprint, policy/config version, `rankingAsOf`, selected sponsored IDs and the complete organic tuple. Later pages recheck current public eligibility, continue excluding those IDs even after Boost expiry and replenish zero. Remaining boosted Jobs retain normal organic eligibility.
- [x] Exact organic comparison tuples (direction encoded in cursor) are:
  - `relevance`: `relevanceTier DESC, relevanceScore DESC, fairScore DESC NULLS LAST, publishedAt DESC, id ASC`
  - `newest`: `publishedAt DESC, id ASC`
  - `fairjobscore`: `fairScore DESC NULLS LAST, publishedAt DESC, id ASC`
  - `salary`: within the required exact SalaryPeriod only, `salaryMinChf DESC NULLS LAST, salaryMaxChf DESC NULLS LAST, publishedAt DESC, id ASC`; cursor/fingerprint includes SalaryPeriod
  - `response`: `responseEvidenceKnown DESC, onTimeRateBps DESC, medianFirstResponseMinutes ASC NULLS LAST, publishedAt DESC, id ASC` under `EMPLOYER_RESPONSE_POLICY_V1`; unknown (<20 due cases) always follows known
  Selected Sponsored IDs are stored separately from `organicTuple` and excluded from the organic continuation. Cursor encodes schema version, fingerprint, `rankingAsOf`, selected Sponsored IDs and the ordered organic values including id. Null order is fixed as shown; invalid version/fingerprint restarts safely. Fixed-clock, Boost-expiry and concurrent publish/expiry tests lock every tuple.
- [x] **Effective job expiry:** Der kanonische Evaluator und Batch-Filter definieren den gemeinsamen Public-Vertrag; Search bildet ihn im SQL-Prefilter ab und revalidiert die begrenzte Hydration. Published Jobs require non-null `expiresAt > now` equal to current approved Revision `validThrough`, plus Company ACTIVE/current VERIFIED/LIVE, active category and no restriction. Reads never write on GET. `syncJobStatusProjection({now})` is an explicit idempotent operations command (ADR-004).
- [x] Avoid N+1: globale Auswahl und Sortierung bleiben in PostgreSQL; die anschliessende Card-Hydration ist fest begrenzt und lädt nur benötigte Company-/Taxonomie-/Boost-Felder

### Slugs

- [x] `lib/utils/slug.ts` final: lowercase + Umlaut map (`ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, plus French/Italian accent stripping for cantons like `Genève → geneve`, `Zürich → zuerich`, `Neuchâtel → neuchatel`, `Schweiz → schweiz`)
- [x] Job slug generation in `lib/jobs/slug.ts`: `slugify(title) + '-' + companyShortRef + '-' + shortIdSegment` bleibt kollisionssicher und stabil
- [x] On title edit: keep original slug; never silently change URLs (avoid 404 on already-indexed jobs). A redirect history remains out of scope for MVP.

### `/sitemap.xml`

- [x] Implement `app/sitemap.ts` exporting public URLs:
  - `/`
  - `/jobs`
  - All currently eligible published `Job` detail URLs under the documented freshness policy
  - only Canton/Category/combination pages whose versioned Content **and** Liquidity Gate passes; all other cluster routes stay `noindex` and absent
  - `/companies` and Company profiles satisfying canonical `evaluatePublicCompanyEligibility`: `status=ACTIVE`, closed validated/sanitized public profile projection, no public-hide restriction and `dataProvenance=LIVE` outside Demo mode. P0 has no separate profile review; verification controls the badge/Job publication, not profile existence.
  - `/salary-radar`
  - `/guide` and only current reviewed/published Guide `ContentPage` revisions that also pass the indexability gate
  - `/pricing`, `/employers`, `/employers/post-job`, `/employers/talent-radar`, `/employers/employer-branding`, `/employers/xml-import`
- [x] Exclude all private routes
- [x] `lastModified` from row updatedAt

> **Decision (MVP):** Eine dynamische Sitemap enthält höchstens 50.000 exakt gegatete URLs. Eine Überschreitung schlägt mit `PublicSitemapCapacityError` geschlossen fehl und wird niemals still abgeschnitten. Sitemap-Index und Chunks sind vor Erreichen dieser Grenze als P1 nachzurüsten.

### `/robots.txt`

- [x] Implement `app/robots.ts` exporting mindestens:
  ```
  User-agent: *
  Allow: /
  Disallow: /candidate/
  Disallow: /employer/
  Disallow: /admin/
  Disallow: /api/
  Sitemap: <APP_URL>/sitemap.xml
  ```
  Zusätzlich gesperrt sind `/reset-password`, `/invite/`, `/support/`, `/alerts/unsubscribe/`, `/mock/checkout/` und `/dev/`.

### JSON-LD on job detail (`/jobs/[slug]`)

- [x] Inject `<script type="application/ld+json">` with a valid `JobPosting`:
  - `@context`, `@type`, `title`, `description` (sanitized plain text), `datePosted`, required `validThrough` from non-null `expiresAt`, `employmentType` (mapped from `JobType`), `hiringOrganization` (with `@type: Organization`, safe `name`, optional safe `sameAs`; `logo` is intentionally omitted until a reviewed public self-hosted asset projection exists), `jobLocation` (Place with PostalAddress: addressCountry `CH`, available addressRegion/addressLocality), `baseSalary` (only when projected `salaryMin`/`salaryMax` present, with `@type: MonetaryAmount`, `currency: CHF`, `value: { @type: 'QuantitativeValue', minValue, maxValue, unitText: 'YEAR'|'MONTH'|'HOUR' }` derived from `SalaryPeriod`), `directApply` boolean
  - For remote jobs add `jobLocationType: TELECOMMUTE`
- [x] Validiert im Google Rich Results Test: [1 gültiges Element erkannt](https://search.google.com/test/rich-results/result?id=G226POiJDcRkf-NHUduGmg); nur optionale Hinweise zu `postalCode` und `streetAddress`

### Canton & category landing pages

- [x] `/jobs/kanton/[slug]/page.tsx`, `/jobs/kategorie/[slug]/page.tsx` and `/jobs/kanton/[slug]/kategorie/[category]/page.tsx`:
  - Resolve slug → entity; 404 on miss
  - H1 + substantive localized intro/guide sections from the current reviewed/published `ContentRevision`; do not dynamically stitch thin boilerplate
  - Server-side fetch of jobs filtered by canton/category, with pagination & ranking
  - `<link rel="canonical">` to itself
  - Metadata: `title`, `description`, `openGraph` derived from the same approved revision plus current aggregate facts; no unreviewed generated copy
- [x] `CLUSTER_LAUNCH_POLICY_V1` makes the strategy gate executable for one exact Canton×Category pair over `window=[evaluatedAt-30d,evaluatedAt)` (Candidate activity uses its stated 90-day subwindow). An assessment is `READY` only when every threshold holds: ≥15 distinct currently VERIFIED/ACTIVE LIVE Companies with an eligible Job in the pair; ≥50 current eligible LIVE Jobs; ≥200 distinct COMPLETE LIVE Candidates whose preferences include the pair and who produced `JOB_SAVED|APPLICATION_SUBMITTED|JOB_ALERT_ACTIVATED` in the preceding 90 days; median distinct Applications per eligible Job submitted in the 30-day window ≥3 (ordinary median; even sample arithmetic mean, persisted exactly as `medianApplicationsTimes2>=6`); ≥7000 basis points of due Applications receive their first canonical `EMPLOYER_RESPONSE_RECORDED` by `ApplicationSubmissionSnapshot.responseTargetDays`; and ≥8000 basis points of the versioned promoted-query set return ≥5 relevant eligible LIVE Jobs. Denominators and zero-denominator fail closed; DEMO/TEST rows are excluded.
- [x] `evaluateClusterLaunch` writes the immutable assessment/evidence hash. Separate capability-checked `approveClusterForProduct` and `approveClusterForOps` events with reason are required before idempotent `activateCluster`; activation is LIVE-only and valid seven days (`evaluatedAt <= now < validUntil`). Re-evaluation supersedes rather than edits. Revoke/expiry immediately removes acquisition/index eligibility without mutating on GET; an explicit projector may persist expiry.
- [x] `isClusterIndexable(canton,category,now)` requires that current activated assessment **and** a current reviewed/published LIVE `ContentRevision` for the exact pair. A Canton-only or Category-only landing is indexable only with its own current reviewed/published LIVE dimension Content and at least one currently indexable child pair; it does not sum several thin pairs to reach 50. Zürich/Aargau/Bern × Gesundheit/Pflege or Engineering/Technik are candidates, not automatically six indexable pages. Every failing route remains useful and `noindex,follow`, absent from Sitemap and paid/organic acquisition.

> **Prioritätsschnitt:** Route, Canonical und Gate-Mechanik für die Startpaare sind P0, damit Demo/Pilot korrekt und sicher funktionieren. Öffentliche organische Akquise über eine Kombination bleibt REQ-MKT-005/P1 und startet erst nach LIVE-Liquiditäts-, Content- und Ops-Freigabe; P0-Demo-Zahlen erfüllen dieses Marktgate nie.

### Canonical URLs

- [x] On `/jobs/[slug]` set canonical to `${APP_URL}/jobs/<slug>`
- [x] On `/companies/[slug]` similarly
- [x] On canton/category/combination landings similarly
- [x] `/jobs` query state is normalized by an allowlisted serializer (stable parameter order, duplicate/default/empty removal, invalid value rejection). Arbitrary filtered/search/cursor URLs use canonical `/jobs`, `noindex,follow`, and are excluded from Sitemap. When state is exactly an indexable Canton, Category or launch-pair filter with no keyword/sort/cursor/extra filter, server redirects to the clean landing route; clean landing pages self-canonicalize. Direct UUID-cluster URLs redirect to the canonical slug route while preserving `after`. This prevents multiple parameter orders from becoming competing canonicals.

### Metadata defaults

- [x] `app/(public)/layout.tsx` provides default `metadata` (title template `%s | SwissTalentHub`, description, openGraph, twitter)
- [x] Each public page exports appropriate German title/description metadata through static metadata or `generateMetadata`

### `noindex` on private routes

- [x] `app/{candidate,employer,admin}/layout.tsx` set `metadata.robots = { index: false, follow: false }`
- [x] `/reset-password`, `/invite/[token]`, `/support/[id]`, `/alerts/unsubscribe/[token]`, `/mock/checkout/[orderId]` and non-production `/dev/mailbox` also explicitly set `noindex,nofollow`, dynamic/no-store and strict Referrer-Policy outside those layouts; sitemap/Canonical never contains token/order/case ids
- [x] Production-HTTP responses, layout metadata tests and HTTP-Smoke confirm the private index/cache contract

### Referral attribution (P1 gated)

- [ ] When `REQ-GRW-003` is explicitly released, create rotatable opaque Referral links only for allowlisted public Job/Company/Guide targets; URLs never contain Candidate, Application, ContactRequest, email or company-private identifiers
- [ ] Resolve code → validate active/public target → record one pseudonymous, bounded-window Attribution under dedupe/rate controls → redirect to canonical target. Self-referral, replay, bot bursts and expired/revoked codes are rejected or flagged without leaking the owner.
- [ ] Conversion attribution uses allowlisted public funnel events and expiry/retention; no cross-device identity stitching and no financial reward until separate Legal/Fraud/Commercial approval
- [ ] Locked/inactive state creates no runtime routes, rows, writes or cookies; dormant Phase-02 referral models already exist. Consent/cookie treatment and campaign source retention are a Go-live decision

### Performance

- [x] Search query uses indexed Job publication projections (`status`, `publishedAt`, `publishedCantonId`, `publishedCategoryId`, published salary fields, `expiresAt`) and joins the current published Revision only for approved text/structured filters
- [x] Avoid loading whole `JobRevision.tasks/requirements/offer` on list views — query the current published revision for filtering/ranking but return only card-level projection fields
- [x] Indexed columns, bounded lookup resolution and eine begrenzte Hydration are sufficient at the named 2,006-job MVP benchmark; no unbounded request memo is needed
- [x] Keyset/cursor query applies the same complete global ranking tuple and fetches `pageSize + 1`; no `OFFSET` drift under concurrent publish/expiry, and `pageSize` is capped at 50

### URL state

- [x] Filters reflected in URL (e.g. `/jobs?keyword=react&canton=zh&workloadMin=80&sort=relevance&after=<opaque>`); changing any filter/sort clears the cursor
- [x] On filter change the URL updates through the server-side GET form while invalid/default/duplicate state is normalized
- [x] Empty-state shows a "Filter zurücksetzen" link

## Relevante Implementierungsdateien

- `app/sitemap.ts`, `app/robots.ts`
- `lib/jobs/job-json-ld.ts` plus direct safe rendering in `app/(public)/jobs/[slug]/page.tsx`
- `app/(public)/jobs/kanton/[slug]/page.tsx`, `app/(public)/jobs/kategorie/[slug]/page.tsx`, `app/(public)/jobs/kanton/[slug]/kategorie/[category]/page.tsx`
- `lib/search/query.ts`, `lib/jobs/public-read-model.ts`, `lib/search/relevance.ts`, `lib/search/response-evidence.ts`
- `lib/jobs/effective-status.ts` plus explicit `syncJobStatusProjection` maintenance command; no mutation on public GET
- `lib/utils/slug.ts` finalised plus immutable collision-safe Job slugs in `lib/jobs/slug.ts`
- `lib/seo/*`, `lib/admin/cluster-launch.ts`, `components/admin/ClusterEvaluationForm.tsx`
- Layout files updated for `metadata.robots`

## Rules to respect (from `99-rules-quickref.md`)

- §20 — public indexable, dashboards noindex, JSON-LD JobPosting, canton/category landings, slugs
- §26 — server-side filtering, pagination, indexed queries, avoid client-side full lists
- §10 — sanitize HTML in JSON-LD `description`

## Verification

> **Plan status:** Implementiert und gegen Code-Commit `f3f6bcc29eeafb3fe3b3c37360782ef9014aa7d4` verifiziert. Details, Laufzeiten, Benchmark und bewusste Grenzen: [Phase-15-Evidence](./evidence/2026-07-22-phase-15.md).

- [x] `/sitemap.xml` returns exactly the eligible current public entities/cluster pages from the Seed manifest and Content/Liquidity Gate; tests assert 0 `/admin|/employer|/candidate` paths rather than a stale hardcoded URL count
- [x] `/robots.txt` returns the listed disallow rules *(candidate/employer/admin/api + sensitive public routes + sitemap link)*
- [x] `/jobs/[slug]` exposes a valid JSON-LD JobPosting
- [x] A gated Canton page lists eligible jobs with the relevant-first capped sponsored-zone contract; an ungated Canton page is noindex and absent from sitemap
- [x] An isolated test factory (never the Demo seed) creates a complete LIVE `CLUSTER_LAUNCH_POLICY_V1` cohort and proves all six metrics + two approvals + current content make the pair self-canonical/indexable/in Sitemap. Each threshold-minus-one, zero denominator, expired/revoked/one-approval, missing content and DEMO provenance is `noindex,follow` and absent. Canton/Category parents require one passing child plus their own content. Equivalent clean filter state redirects to the pair route; arbitrary filters canonicalize to `/jobs` and stay noindex.
- [x] `/jobs?keyword=…&after=<cursor>` returns the next deterministic slice using the same ranking tuple; records inserted/expired between requests cause neither duplicate nor unauthorized/ineligible result, and an invalid cursor gets a safe restart response
- [x] Lighthouse 13.4.1 SEO: 100/100 against the production build; no failed SEO audit
- [x] Production-HTTP-Response for anonymous `/candidate/dashboard` proves Redirect plus `X-Robots-Tag`/`no-store`; layout metadata tests prove the rendered private `noindex` contract
- [x] Sensitive out-of-layout route matrix proves no-store/noindex/strict-referrer, generic invalid-token/case/order handling, and zero URL/id leakage into response Canonical or structured logs
- [x] Search performance was benchmarked with `phase15-global-search-v1` (2,006 eligible Treffer) and `EXPLAIN`; actual p50/p95 and query plans are recorded in Evidence

## Common pitfalls

- Sitemap including private routes by accident — reuse canonical public predicates (effective Job eligibility; Company `status=ACTIVE`, `dataProvenance=LIVE`, safe public projection and no public-hide restriction). Company verification controls Badge/Job publication, not profile visibility; never rely on a nonexistent `Company.suspended` Boolean
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
| Data | Bounded public Read Models, immutable collision-safe Job slug, immutable `ClusterLaunchAssessment/Event`, reviewed Content and privacy-safe aggregates; no Candidate/Radar/private paths. Redirect history remains deferred. |
| Validation | Query/sort contract, stable global ranking tuple/cursor, canonical params, slug stability/collision, indexability threshold, safe JSON serialization. |
| Authorization/cache | Nur kanonisch public-eligible Entitäten; private layouts noindex + no-store independent of robots; Sitemap public allowlist. |
| Audit/analytics | Content/admin changes audited by owner phase; minimal search/index metrics. No raw query PII beyond reviewed retention. |
| UX/mobile | invalid/no result alternatives, URL-persistente responsive GET-Form/`details`, sponsored labels, helpful unique cluster content, pagination/canonical state. |
| Seed | Duplicate slugs, draft/expired/restricted, multi-language/umlaut and boosted relevance boundaries; LIVE-liquid/non-liquid clusters come from isolated test factories, not the Demo seed. |
| Tests | ranking before pagination/no duplicates, all sort modes, JSON-LD safe/schema, sitemap/robots/private exclusions, canonical/noindex gate, query plans/performance. |
| Verification | HTTP/URL matrix, sitemap parse, structured-data check and `EXPLAIN`. Expected 0 thin/private entries and deterministic pages; vollständige Mobile-/Browserabnahme folgt in Phase 17. |
| Risks / limitations | Parameterized normalized SQL/`LIKE` satisfies the measured MVP contract; `tsvector`/GIN remains deferred. Sitemap index/chunks are required before 50,000 URLs. Programmatic scale waits for liquidity. |
| Definition of Done | Every indexed URL has unique value/current inventory and correct canonical; public search is relevant, stable, transparent and private-safe. |
