# Phase 18 — Documentation & Final Audit

> **PortalGERM target status: NOT IMPLEMENTED.** Documentation cannot turn a Mock-/Legal-/Ops placeholder into production readiness. Every final claim needs target-commit evidence.

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 18. Read [99-rules-quickref.md](./99-rules-quickref.md) §34, §35, §36 before starting.

## Goal

Write the real `README.md`, finalise `.env.example`, and verify the Masterplan Product/Pilot gates, every P0 Requirement, E2E-01–08 and the Release/Operations Gate. Then summarise the build honestly per `99-rules-quickref.md §38`.

## Prerequisites

- [ ] Phases 01–17 complete
- [ ] Phase-17 Unit/Integration/E2E-01–07 passing
- [ ] `npm run lint` and `npm run build` clean

## Deliverables (checklist)

### `README.md` sections (per `99-rules-quickref.md` §34)

- [ ] **Product overview** — what SwissTalentHub is, who it serves, what it differentiates on
- [ ] **Tech stack** — Next.js + TS + Tailwind + shadcn/ui + Prisma + Postgres + Zod + auth choice + Vitest
- [ ] **Architecture overview** — directory map (`/app`, `/components`, `/lib`, `/prisma`, `/tests`); link to `lib/scoring/__rules.md`, the ADR log ([decisions.md](./decisions.md)) and the [glossary.md](./glossary.md)
- [ ] **Setup instructions** use only cross-platform npm/Node scripts (same commands in PowerShell, cmd, bash and CI):
  ```text
  npm ci
  npm run env:init
  npm run db:generate
  npm run db:migrate
  npm run db:seed
  npm run dev
  ```
- [ ] `env:init` refuses Production, creates ignored `.env.local` only when absent, interactively validates `DATABASE_URL`/`APP_URL`, generates every Phase-01 32-byte key/keyring and mailbox secret through CSPRNG, sets `RATE_LIMIT_BACKEND=postgres`, leaves future provider placeholders inactive and prints variable names only—never values. A non-interactive CI mode reads pre-provisioned environment variables and writes no file.
- [ ] **Environment variables** — copy of `.env.example` plus a one-line description per var; clearly mark "placeholder, leave empty for MVP"
- [ ] **Database setup** — committed migration workflow, isolated test DB and Postgres-via-Docker option; clearly forbid production `db push`
- [ ] **Seed instructions** — `npx prisma db seed`; mention idempotency
- [ ] **Demo accounts** — table of the four accounts + the per-plan employers
- [ ] **Available routes** — generate/verify against the implemented route tree and the [architecture blueprint](./architecture-blueprint.md) §5; mark unavailable/deferred routes honestly
- [ ] **Role overview** — Candidate / Employer / Recruiter / Admin + company-level roles (Owner / Admin / Recruiter / Viewer)
- [ ] **Monetization overview** — plans, active/deferred products, Credits and Invoice snapshots; current 8.1 % planning rate plus Tax-review caveat; Success Fee disabled
- [ ] **Mock integrations** — list of the external ports under `/lib/providers/{payments,email,ai,jobroom,storage,commute}`, what each does locally and which approval gates a real provider requires. State separately that Analytics validation/aggregation and HTML Invoice rendering are internal services, not provider ports.
- [ ] **Security & privacy notes** — DSG-friendly wording, anonymity in Talent Radar, consent log, data deletion mock, audit log, no real external APIs, no scraping
- [ ] **Limitations of MVP** — explicit list:
  - Mock payments only (Stripe placeholders only)
  - Mock email (writes `EmailLog`, no real send)
  - Mock AI (deterministic rule-based rewrite)
  - Mock Job-Room (versionierter `OccupationCode`-Lookup mit `REQUIRES_REPORTING|NOT_REQUIRED|UNKNOWN`, no real arbeit.swiss call)
  - Mock storage (metadata only, no bytes persisted)
  - Mock commute (deterministic distance class or disabled; no maps/network call)
  - Subscription renewal not automated (admin marks manually)
  - No background jobs / cron in MVP — reads calculate effective current/expired state without writes; an explicit idempotent maintenance command may persist due projections and Audit evidence (ADR-004)
  - Actual implemented search/ranking approach and measured limitations (ADR-003); do not pre-claim `contains` if Phase 15 selected SQL/FTS
  - Actual sitemap/indexability limits, if any, with reason
  - Production uses the shared atomic PostgreSQL rate store; process memory is a Local/Test-only adapter, not a launch limitation presented as protection
  - HTML invoices, no PDF generation; amounts stored in Rappen (ADR-002)
- [ ] **How to swap mock providers for real providers later** — for each external adapter: which interface to implement, env vars to populate (Stripe, OpenAI, Postmark/Mailgun/SendGrid, S3, arbeit.swiss, optional map/commute service), and what additional code may be needed (webhooks, retry, etc.). Do not invent an Analytics/Invoice provider; document their separate future gates.
- [ ] **Deployment notes** — required env vars, recommended Postgres provider, secure cookie flags in prod, `STRICT-TRANSPORT-SECURITY` only with HTTPS, build command, start command
- [ ] **Legal / compliance disclaimer** — "Datenschutzfreundliches MVP — keine Rechtsberatung. Erfolgsbasierte Vermittlungsmodelle werden erst nach rechtlicher Prüfung aktiviert."

### `.env.example` confirmed

- [ ] Matches Phase 01, Billing Phase 12, encrypted Radar/Reveal Phase 14 and Backup/Ops expectations exactly, including keyring lengths/versions/rotation, `RATE_LIMIT_BACKEND=postgres` and `BACKUP_AGE_RECIPIENT`
- [ ] Comments explaining which vars are required vs placeholders

### Run quality gates

- [ ] `npm ci` from committed lockfile
- [ ] `npm run db:generate`
- [ ] `npm run db:migrate`
- [ ] `npm run db:seed` twice with stable manifest
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:integration`
- [ ] `npm run test:e2e`

If any command can't run in the environment, document why per `99-rules-quickref.md §37`.

> If Postgres is not reachable, start the documented local service and rerun the migration/seed commands. An unavailable DB remains `Needs verification` and blocks the relevant gate. Record actual outcomes in `BUILD_REPORT.md`.

### Final Self-Audit walkthrough

Walk through the Masterplan Product/Pilot gates, every P0 Requirement and E2E-01–08 personally. For each failure: fix in the owning phase, re-test and link evidence; do not tick by inspection alone.

### E2E-08 — clean release and recovery (owned here)

- [ ] From a clean isolated clone/worktree and empty database: validate Env, `npm ci`, migrate, seed twice with identical manifest, build and start; Production-mode seed attempt must fail before DEMO write
- [ ] Use the reviewed cross-platform Node wrappers: `npm run ops:backup -- --source release-test --out <explicit .dump.age path>` spawns `pg_dump --format=custom --no-owner --no-acl` and streams directly into `age -r BACKUP_AGE_RECIPIENT`, atomically renames completed ciphertext and writes its SHA-256; it stores no plaintext and deletes a partial temp ciphertext on failure. `npm run ops:restore -- --in <explicit .dump.age path> --target restore-test` verifies checksum/distinct allowlisted empty target, reads `BACKUP_AGE_IDENTITY_FILE` only from the Ops secret-mounted path, streams `age --decrypt` into `pg_restore --exit-on-error --clean --if-exists --no-owner`, then runs migration/integrity/manifest/smoke. Wrapper rejects same/unknown/shared/Production source or target and removes temporary identity mount/DB after evidence.
- [ ] Record tool/version, release commit, start/end, backup checksum/location/retention classification, restored DB identifier, measured RPO/RTO versus hypotheses, commands/exit codes and cleanup. Never put credentials or backup bytes in Git/BUILD_REPORT.
- [ ] `E2E-08` passes only when clean clone, Production Demo guard, backup, isolated restore and post-restore smoke all succeed. A missing DB/tool/environment is `Needs Verification` and blocks the Release/Operations gate; Phase 17 remains green but does not substitute for this result.

### Final Acceptance walkthrough

Walk through every P0 row and E2E-01–08 in [requirements-matrix.md](./requirements-matrix.md), plus the Masterplan Product/Pilot and Product Quality Release gates. Same evidence discipline.

### Final summary report (per `99-rules-quickref.md §38`)

Produce a `BUILD_REPORT.md` (or close-out comment) covering:
- What was implemented
- Files / areas touched
- Commands run + outcomes
- Tests passing / known failing
- Known limitations (link to README "Limitations of MVP")
- What is mocked & ready for later real-provider integration

Use precise wording: **"Implemented with mock provider"** · **"Server-side gated"** · **"Demo-ready"** · **"Known limitation"** · **"Ready for later real provider integration"**. Do **not** say "production-ready" — anything mocked is not.

- [ ] `BUILD_REPORT.md` created with command outcomes, limitations and blocked DB/E2E gates.

## Files to create / modify

- `README.md`
- `.env.example` (final)
- `BUILD_REPORT.md` — mandatory release artifact; a commit message is not a substitute

## Rules to respect (from `99-rules-quickref.md`)

- §34 — README must describe the listed sections
- §35 — Definition of Done: works end-to-end, no broken routes, server perms, ownership, Zod, sensitive data protected, seed works, demo accounts work, build/lint/tests pass, README updated
- §36 — final self-check list before declaring done
- §38 — honest, precise reporting

## Verification

- [ ] All four demo accounts can log in
- [ ] `npm run build` succeeds with no errors
- [ ] Every P0 Requirement and applicable Masterplan/Release gate has linked target evidence; open legal/production gates remain explicitly open
- [ ] Every P0 Requirement and E2E-01–08 has linked target evidence; any excluded item has an approved Audit/ADR reason
- [ ] E2E-08 evidence explicitly names the isolated source/restore databases, backup checksum and post-restore smoke; no destructive command targets an unknown or shared database
- [ ] README opens to the demo-accounts table within 30 seconds of scanning

## Common pitfalls

- Calling the project "production-ready" because it builds — it isn't, anything mocked must be flagged
- Describing Production rate limiting as in-memory/future work instead of verifying the required shared PostgreSQL store; subscription renewal/Worker automation remains a separate limitation
- Listing real provider env vars without noting they are placeholders
- Auto-generated README from create-next-app left in place — replace with the real one
- Skipping the final self-audit because "everything looked fine" — actually walk it

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Deliver an honest, reproducible pilot candidate with setup/operation/limitations understood by the next engineer and business owner. |
| Roles / requirements | Engineering, Product, Ops, Owner; REQ-DOC-001, OPS-001–003, all P0 Requirements. |
| Prerequisites | 01–17 green; 0 open P0 Audit items; Legal/Privacy/Tax/Provider blockers explicitly listed. |
| Deliverables | Real README, Env catalog, Architecture/route/role docs, migration/deploy/rollback/runbooks, mock/provider limitations, evidence index, BUILD_REPORT, release checklist and final report. |
| Routes/data | Generate/verify route/schema catalog against code. Clean migration/seed and Production demo guard; backup/restore isolated. No new feature hidden in docs phase. |
| Security/privacy | Secret/dependency/license scan; final IDOR/Radar/cache/header review; retention/legal status truthful. Demo credentials never production. |
| UX/mobile | Manual four-role walkthrough of every critical state at desktop/360px with named fixtures; German copy, A11y and no template/placeholder review. |
| Tests/verification | Full Phase-17 E2E-01–07 suite on release commit; this phase owns E2E-08 migration status, clean clone, Production Demo guard, isolated backup/restore and staging smoke, plus link/checkbox/Requirement audit. |
| Expected result | All commands exit 0 and evidence records contain environment/commit/assertions; known limitations remain visible and are not converted to `[x]`. |
| Risks / limitations | A successful build is not production readiness. Real providers, legal texts, tax, durable Workers, incident process and confirmed SLAs/RPO/RTO may still block launch; the shared atomic Production rate store itself is required, not deferred. |
| Definition of Done | Next owner can set up and audit without reinterpretation; all completion claims are evidence-backed; report says controlled/mock/pilot-ready only where true. |
