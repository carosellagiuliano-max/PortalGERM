# Phase 07 — Public Pages

> **PortalGERM target status: NOT IMPLEMENTED.** Public CTAs must have a real next state. Cluster pages stay noindex until the Phase-15 content/liquidity gate; Boost behavior follows ADR-003/017.

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 07. Read [99-rules-quickref.md](./99-rules-quickref.md) §7, §20, §21 before starting.

## Goal

Build the functional public discovery surfaces and polish the Phase-06 auth shells. Eligible job/company/guide pages can be indexable; cluster pages remain noindex until the Phase-15 Content/Liquidity Gate, and private routes always remain noindex/no-store as applicable.

## Prerequisites

- [ ] Phases 02–06 done
- [ ] `lib/scoring`, `lib/search`, `lib/utils/format`, `lib/privacy/anonymize-candidate` available

## Deliverables (checklist)

### Layout & shared components

- [ ] `app/(public)/layout.tsx` — public top nav (logo · Jobs · Unternehmen · Lohn-Radar · Ratgeber · Pricing · Für Arbeitgeber · Login · "Kostenlos starten") + footer (links, language note "DE-CH", privacy disclaimer)
- [ ] `components/layout/{PublicNav.tsx,PublicFooter.tsx}`
- [ ] `components/jobs/{JobCard.tsx,JobFilters.tsx,JobBadgeRow.tsx,FairScoreBadge.tsx,SalaryDisplay.tsx,BoostedBadge.tsx}`
- [ ] `components/companies/{CompanyCard.tsx,CompanyHeader.tsx,CompanyBenefits.tsx}`
- [ ] `components/marketing/{HeroSection.tsx,FeatureCard.tsx,CtaSection.tsx,TrustSection.tsx}`
- [ ] Public read models include `dataProvenance`; Production selects `LIVE` only. Local/Preview renders a persistent visible „Demo-Daten – keine reale Marktaktivität“ banner/badge whenever Company/Job/Content is DEMO, and such rows never feed public launch evidence or indexable output.

### `/` — Homepage

- [ ] Hero with H1 "Finde nicht irgendeinen Job. Finde den Job, der wirklich passt." + launch-honest subline focused on the currently served de-CH clusters; do not claim nationwide liquidity before the launch gates prove it
- [ ] Search bar (keyword · canton or city · radius · category · workload · remote/hybrid) — submits to `/jobs?...`
- [ ] Highlight cards: Fair-Job-Score · Lohn-Radar · Anti-Ghosting-Arbeitgeber · 1-Klick-Bewerbung · Anonymer Talentpool
- [ ] Featured jobs (6 eligible jobs): `SPONSORED_PLACEMENT_CONFIG_V1.HOMEPAGE = 2` maximum labelled relevant active boosts, then organic quality/freshness; verification remains a separate badge, not a Fair-score input
- [ ] Featured verified companies grid (8)
- [ ] Canton quick links show currently served/gated clusters with honest counts; the taxonomy may know all 26 cantons, but the homepage does not advertise empty nationwide liquidity
- [ ] Category quick links promote only Product/Ops-activated/gated launch categories with honest current counts. All 18 taxonomy categories remain available as neutral search filters, but inactive/thin categories are not marketed or indexed as liquid destinations.
- [ ] "So funktioniert's für Bewerber:innen" + "So funktioniert's für Arbeitgeber" two-column section
- [ ] CTAs: "SwissJobPass erstellen" → `/register/candidate`; "Inserat erfassen" → `/register/employer`
- [ ] Trust section: Datenschutz, anonymes Talentprofil, keine Tracking-Pixel
- [ ] CTA to pricing

### `/jobs` — Job search

- [ ] Server component reading filters from URL search params
- [ ] Filter sidebar/sheet using `JobFilters`: keyword/canton/city/category/workload/jobType/remote/language/effort/salaryDisclosed/evidence-based response status/companyVerified/sort. Radius is optional for MVP and may be deferred if geo distance requires extra complexity.
  keyword, canton, city/radius when supported, category, workload min/max, job type, remote, salary disclosed, response-target/evidence filter when defined, company verified, language, application effort
- [ ] Sort dropdown: Relevanz · Neueste · Fair-Job-Score · Lohn (hoch→tief) · Antwortgeschwindigkeit. There is no „Boosted zuerst“ sort; paid placement remains the separate capped labelled zone under every sort.
- [ ] Cursor pagination (20 per slice) uses the Phase-15 stable tuple contract; Phase 07 may initially expose only the first slice but must not establish offset/page semantics
- [ ] Default ranking via `lib/search/ranking.ts`: eligibility/relevance first, then a bounded labelled sponsored zone within relevant results, then organic relevance/Fair-Job-Score/`publishedAt` with a stable id tie-breaker; order before pagination (ADR-003)
- [ ] Empty state ("Noch keine passenden Jobs gefunden — Filter anpassen oder Jobabo erstellen")
- [ ] Loading state (skeleton list) — `app/(public)/jobs/loading.tsx`
- [ ] Phase 07 does not create or advertise Save/internal Apply mutations owned by Phase 09. Components expose explicit capability props; Save/Apply controls are enabled only when the Phase-09 action and E2E path exist. External-apply links may work earlier after URL/safety validation.
- [ ] Job card shows truthful persisted discovery data and badges, including **"Geboostet"** when active. Before Phase 09 its real primary action is "Details ansehen"; Phase 09 adds candidate Save/Apply controls without duplicating the card.

### `/jobs/[slug]` — Job detail

- [ ] Job-detail fields from Blueprint §5 and REQ-MKT-002: title, company, location, canton, workload, type, language, published/valid-through, salary/transparency, versioned Fair breakdown, Candidate Match+confidence when logged in, skills, benefits, remote/process and evidence-based response information
- [ ] Share and safe external-apply CTAs work in this phase. Internal **Bewerben/Schnellbewerbung** and Save are added only by Phase 09 together with form, dedupe, rate-limit, audit and notification; no dead control is rendered beforehand.
- [ ] Similar jobs list (same category/canton and exclude current); apply the same capped labelled sponsored-zone contract only after similarity eligibility
- [ ] Company preview card linking to `/companies/[slug]`
- [ ] "Job melden" button → opens dialog calling abuse-report server action
- [ ] **JSON-LD `JobPosting`** in `<head>` via `app/(public)/jobs/[slug]/page.tsx` `generateMetadata` + an inline script (validated against schema.org)
- [ ] Public render of HTML user content goes through `lib/security/sanitize.ts` (no XSS)

### `/jobs/kanton/[slug]` — Canton landing pages

- [ ] Reuses `/jobs` listing pre-filtered by canton; H1 "Jobs in <Kantonsname>"; intro paragraph mentioning Fair-Job-Score + Salary transparency
- [ ] Canonical URL set, but `noindex` and excluded from sitemap until Phase 15 proves the cluster-specific Content/Liquidity Gate

### `/jobs/kategorie/[slug]` — Category landing pages

- [ ] Same shape as canton landings, pre-filtered by category; `noindex` and excluded from sitemap until the Phase-15 gate passes

### `/companies` — Company directory

- [ ] Reuse one canonical `isCompanyPubliclyEligible(company, now)`: `Company.status = ACTIVE`, `dataProvenance=LIVE` outside explicit Demo mode, no effective public-hide restriction and the closed validated/sanitized public-profile allowlist produced by Company onboarding/update. P0 claims no separate Company profile review. DRAFT/SUSPENDED/CLOSED/restricted Companies yield no directory/profile result; verification controls its badge and Job-publish prerequisite, not public profile existence or a duplicate Boolean.
- [ ] Search by name; filters: canton, industry and verified. Any response-performance filter requires a defined evidence threshold; a paid profile is not an organic quality filter.
- [ ] Company cards show logo, name, canton/city, industry, active jobs count, verified badge, response score, benefits preview
- [ ] Pagination

### `/companies/[slug]` — Company profile

- [ ] Free profile: logo, name, basic description, industry, size, location, active jobs list
- [ ] Entitled enhanced profile renders only persisted, reviewed fields such as cover, values, benefits, evidence-based response statistics, commitments and active jobs. Do not render quote/gallery/video placeholders or derive entitlement from a stale Company boolean; use `getEffectiveEntitlements`.
- [ ] List of currently published jobs from this company
- [ ] "Unternehmen melden" button (abuse report)
- [ ] "Firma beanspruchen/Zu dieser Firma gehören?" sends anonymous users to `/register/employer?claim=<public-slug>&next=<safe-path>` with a signed, expiring server claim intent; authenticated Owner/Admin enters Phase-10 claim review. Public payload exposes no owner/membership/domain evidence.
- [ ] DRAFT/SUSPENDED/CLOSED/restricted Companies are absent and return the same safe not-found response; `noindex` alone is not sufficient

### `/salary-radar` — Salary orientation

- [ ] Form: job title (free-text), category (select), canton, seniority (JUNIOR/MID/SENIOR/LEAD), workload
- [ ] `SALARY_RADAR_POLICY_V1` selects the unique approved dataset at injected time and the first ≥30-sample precomputed scope in the exact Category+Canton+Seniority → Canton all-seniority → national Seniority → national all order. It never merges quantiles or crosses Category.
- [ ] Result shows YEARLY/FTE p25/median/p75 plus integer workload-adjusted range, dataset/as-of/method/fallback scope and only sample bucket `30–49|50–99|100+`; 29/no unique dataset/no band yields a transparent no-result and adjacent guidance. No exact sample or false precision.
- [ ] Server action implements only Policy v1 and returns `{ p25Chf, medianChf, p75Chf, adjustedP25Chf, adjustedMedianChf, adjustedP75Chf, period:'YEARLY_FTE', source, datasetVersion, asOf, method, fallbackScope, sampleBucket }` plus up to four current public-eligible Jobs in that bracket. `sampleBucket` is exactly `30–49|50–99|100+`; no raw count/min/max alias or second widening algorithm is exposed.
- [ ] **Mandatory disclaimer** below result: "Dieser Lohnbereich ist eine Orientierung und keine Rechts-, Finanz- oder Lohnberatung."
- [ ] Empty result state: "Noch keine Daten zu dieser Kombination — bitte ähnliche Auswahl probieren."

### `/guide` & `/guide/[slug]` — Ratgeber

- [ ] List current reviewed/published `ContentPage` Guide revisions, card layout with excerpt; draft/review/unpublished revisions are absent from the public query
- [ ] Detail page: title, hero, body (rendered safely from sanitized markdown or plain text), "Verwandte Artikel" suggestions
- [ ] Indexable and included in sitemap only when the reviewed-publish state and Phase-15 content/indexability gate both pass

### Auth pages polish

- [ ] Style the Phase 06 pages (`/login`, `/register*`, `/forgot-password`) to match the public look (cards, brand color, clear CTAs, German labels)
- [ ] All forms validate with **Zod + `useActionState`** (server actions), German messages — *react-hook-form not used; same intent (decisions.md ADR-012 stack).*

## Files to create / modify

- All `app/(public)/**` route files
- Components listed above under `components/{layout,jobs,companies,marketing}`
- `app/(public)/jobs/[slug]/JobJsonLd.tsx` for the structured data helper
- `app/sitemap.ts` stub at the **`app/` root** (not inside `(public)`; full impl in Phase 15) — at least exporting the public homepage + `/jobs`. See [decisions.md](./decisions.md) ADR-008.

## Rules to respect (from `99-rules-quickref.md`)

- §3 — Differentiators (Fair-Job-Score, Salary transparency, Anti-Ghosting, anonymes Talentprofil) visible on homepage and search
- §7 — German UI copy throughout; CHF prices; Swiss cantons/cities
- §16 — boosted jobs labelled "Geboostet" everywhere they appear
- §20 — JSON-LD JobPosting; canton/category landing pages; canonical URLs
- §10 — sanitize HTML in job descriptions and guide articles
- §21 — empty states, loading states, accessible nav

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] Homepage renders all sections; clicking a canton link arrives at `/jobs/kanton/<slug>`
- [ ] `/jobs?keyword=javascript&kantonId=<zh>` returns matching results with sort + pagination working
- [ ] Card/detail components correctly render a passed effective Boost as "Geboostet", but Phase 07 does not own activation/ranking evidence; the active sponsored-zone E2E is accepted only in Phase 13/15
- [ ] Logged-in candidate sees match score on job detail; anonymous user does not
- [ ] `/jobs/<slug>` exposes valid JSON-LD `JobPosting` (validate via Google Rich Results test)
- [ ] `/salary-radar` returns Policy-v1 p25/median/p75 + adjusted values/source/as-of/method/fallback/sample bucket + Jobs + disclaimer; sparse/unknown combinations do not invent a range or expose an exact count
- [ ] Guide list/detail render; only current reviewed/published revisions that pass the Phase-15 indexability gate are indexable/in the sitemap, while others render no public page or remain `noindex` as specified
- [ ] Company directory/profile returns only ACTIVE public projections; Claim CTA preserves a signed/allowlisted intent through registration and reaches Phase-10 verification without accepting a forged private Company id
- [ ] DEMO Company/Job/Content is visibly labelled in local/preview, absent from Production/public market evidence and never indexable; activated-category quick links do not expose all inactive taxonomy categories
- [ ] Lighthouse on `/` ≥ 90 performance, ≥ 95 a11y *(pending: run `npx lighthouse` locally)*

## Common pitfalls

- Rendering job description as raw HTML — must go through `lib/security/sanitize.ts`
- Forgetting "Geboostet" label on cards in canton/category landings (it must show everywhere)
- Match score running for anonymous users — gate on `getCurrentUser()`
- Loading all jobs client-side — keep the search/list as a server component with server-side pagination
- Search filter URL state lost on refresh — keep all filters in the URL as searchParams

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Give visitors useful job, salary and employer information before registration and create an honest path into Candidate/Employer activation. |
| Roles / requirements | Public, Candidate optional; REQ-MKT-001–005, SCORE-001/002, QA-002. |
| Prerequisites | 02–06; job active predicate and public Safe Read Models; Phase 09 owns persisted Save/Apply. |
| Routes/actions | `/`, jobs list/detail, companies list/detail, Salary Radar, Guide; auth CTA integration. Canton/category shells stay noindex until 15. Public search/filter/read; Candidate Match optional; CTA safe-next. |
| Data | Published/current JobRevision/Score, Company public fields, SalaryBand version, Published content; never raw models. |
| Validation | Allowlisted bounded URL params, stable pagination, valid slugs, salary ranges; expired/suspended/draft excluded in query. |
| Authorization/privacy | Public-only selects; Match requires current Candidate; no private membership/Radar/Applicant data; report action only when owning secured use case exists. |
| Audit/analytics | Minimal schema-validated search/detail/CTA events; no free-text or PII. Public reads need no AuditLog. |
| UX/mobile | Purpose/CTA/trust/date/source per Blueprint; Filter Sheet at 360px; loading/empty/error/not-found; score factors and Salary sparse/no-result; no dead Apply/Save button. |
| Seed | Relevant/irrelevant, expired, draft, suspended, boosted-compatible, salary sparse, company empty, guide content fixtures. |
| Tests | Public query/payload, filter/pagination, safe rendering/JSON-LD preparation, Match gating, route states, mobile/a11y. |
| Verification | HTTP route matrix + public/search tests + keyboard/mobile smoke. Expected 0 private/inactive rows and functional CTA paths. |
| Risks / limitations | Full SEO/canonical/sitemap/ranking in 15; Boost lifecycle in 13. Copy must not claim nationwide liquidity. |
| Definition of Done | Visitor can search, understand and take a real next action; every route/state is persisted/secured/tested and not a generic template. |
