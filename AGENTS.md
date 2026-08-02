## SwissTalentHub Phase 19–33 — Standing Execution Rule

This section activates automatically whenever the repository owner asks to
check, implement, continue, finish or fix a phase from 19 through 33. The
owner does not need to repeat the planning, quality, evidence or completion
rules in each request.

### Command semantics

* **“Prüfe/analysiere/erkläre Phase NN”** is read-only. Inspect the repository
  and provide an evidence-backed result. Do not mutate code, external systems
  or Git history unless the owner separately requests a change.
* **“Implementiere/mache/fahre fort mit Phase NN”** authorizes the complete
  technical delivery of that phase or explicitly named track: implementation,
  migrations/backfills, seed/fixtures, owning tests, protected regressions,
  documentation, a new Phase-19+-Evidence record, and status updates. It does
  not authorize unrelated later phases.
* **“Behebe/fixe die Befunde in Phase NN”** authorizes only confirmed defects
  owned by that phase plus indispensable in-scope prerequisites. Re-evaluate
  every reported finding against the current tree before changing code.
* The owner’s current message can narrow or override these defaults.

### Mandatory authority and reading order

Before the first edit for a Phase-19+-task, read the following files completely
and use the current repository state rather than memory or an older session:

1. this `AGENTS.md`;
2. [`codex-plan/00-PLAN.md`](codex-plan/00-PLAN.md);
3. [`codex-plan/99-rules-quickref.md`](codex-plan/99-rules-quickref.md);
4. [`codex-plan/decisions.md`](codex-plan/decisions.md);
5. [`codex-plan/requirements-matrix.md`](codex-plan/requirements-matrix.md);
6. [`codex-plan/remediation-masterplan.md`](codex-plan/remediation-masterplan.md);
7. [`codex-plan/remediation-execution-contract.md`](codex-plan/remediation-execution-contract.md);
8. [`codex-plan/remediation-traceability.md`](codex-plan/remediation-traceability.md);
9. [`codex-plan/architecture-blueprint.md`](codex-plan/architecture-blueprint.md),
   [`codex-plan/route-role-matrix.md`](codex-plan/route-role-matrix.md) and
   [`codex-plan/product-quality-gates.md`](codex-plan/product-quality-gates.md);
10. [`codex-plan/implementation-plan.md`](codex-plan/implementation-plan.md),
    the exact phase file and every directly linked runbook/reference.

For conflicts, use this precedence:

```text
AGENTS.md/current owner instruction
-> explicitly approved ADR in codex-plan/decisions.md
-> codex-plan/requirements-matrix.md
-> current masterplan/architecture/product strategy
-> remediation execution contract and traceability
-> exact phase file/implementation plan
-> legacy inventory
```

A phase file may strengthen the common contract but may never weaken a
higher-priority security, privacy, tenant, evidence or activation rule. Repair
the lower-priority contradiction instead of silently choosing an
interpretation.

### Required start gate

Before changing product, runtime, schema or test code:

1. Record `git status --short`, current branch, `HEAD`, `origin/main`, remote
   identity and all existing user changes. Preserve unrelated work.
2. Confirm the exact phase/track, its `STH-*` and `REQ-*` IDs, target
   launch-class priorities, dependencies, external gates and protected
   Phase-01–18 regressions.
3. Phase 19 is the mandatory baseline gate. No Phase-20+-runtime change may
   start without green, current Phase-19 evidence on the chosen clean
   baseline commit. If that evidence is missing or stale, report the blocker;
   never inherit the historical Phase-18 Golden Run.
4. Historical Phase-01–18 phase files and their existing evidence records are
   immutable. They may be used as regression contracts but never rewritten.
5. If no launch class is explicitly selected, implement the technical
   contract behind `DISABLED`/`SANDBOX` gates and make no `LIVE`, market,
   provider, legal or production claim.
6. Optional/deferred tracks such as Phase 27, Phase 28A/B and trigger-based
   Phase 30B/C stay out of scope unless their documented demand/capacity gate
   or the owner explicitly activates them.

### Mandatory implementation standard

Implement the phase as connected vertical slices. For every slice verify:

```text
user action
-> UI and all required states
-> schema validation
-> server use case/API
-> authentication and fresh step-up where required
-> capability, role, ownership and tenant checks
-> entitlement/status/feature gate
-> transaction, concurrency and idempotency
-> database/provider/worker effect
-> audit and notification/outbox
-> safe response and UI feedback
-> positive, negative, abuse and regression evidence
```

Additional non-negotiable rules:

* Follow all 28 numbered contracts in the exact phase file and every row of
  its AC-to-test matrix. A planned test path is not evidence until the file
  exists and its exact command passes.
* Use real Prisma migrations with constraints, indexes, upgrade/backfill and
  compatibility tests. Never use `db push` as completion evidence.
* Use expand–migrate–contract for risky data changes. Test empty, realistic
  existing, partial-backfill, retry and rollback/roll-forward states before
  read cutover or UI activation.
* Enforce authorization before repository/provider access. Direct-action,
  IDOR, cross-role, cross-tenant, removed-membership, stale-version, replay
  and concurrency cases are mandatory where relevant.
* Implement Loading, Empty, Locked, Pending, Error, Retry, Conflict, Expired,
  Cancelled and Success states where applicable, including 360 px, keyboard,
  focus, screenreader and non-colour-only status behaviour.
* Provider and worker paths require timeout, retry/backoff, idempotency,
  duplicate/out-of-order delivery, poison/DLQ, lost-lease/restart and recovery
  coverage. Mock/Sandbox output must never be labelled real or `LIVE`.
* Do not hide failures with `.only`, unexplained `.skip`, quarantine, retry,
  blind snapshot updates, weakened assertions or an in-memory substitute for
  required PostgreSQL semantics.
* Do not perform broad refactors, speculative later-phase work or UI-only
  facades. Fix a newly discovered cross-phase defect only when indispensable
  for the current contract; otherwise assign it an ID/owner and leave it
  visibly blocked/deferred.

### Verification, evidence and honest completion

Run the exact tests from the phase matrix and the gates required by
[`codex-plan/remediation-execution-contract.md`](codex-plan/remediation-execution-contract.md):

* G0 for governance, baseline, scope, links, traceability and protected diffs;
* G1 for every phase’s owning Unit/PostgreSQL/Contract/Security/E2E tests plus
  lint, typecheck and production build;
* G2 for a completed track and all affected downstream/protected regressions;
* G3 for phase close, migrations, seed, recovery, browser/mobile/a11y and
  relevant provider/worker failure paths;
* G4 for Phase 19 baseline, the historical Phase-32 release decision and the
  Phase-33 technical LC4-/LC5-configuration candidate on the exact same
  immutable commit/artifact, including the required clean-clone Golden Run.
  Phase 33 may not rewrite the Phase-32-`NO_GO` or turn technical readiness
  into a Production approval.

Create a new
`codex-plan/evidence/YYYY-MM-DD-phase-NN[-track].md` record from
[`codex-plan/remediation-evidence-template.md`](codex-plan/remediation-evidence-template.md).
Record the exact commit, environment, database, commands, exit codes,
duration, pass/fail/skip/retry counts, AC rows, artifacts, limitations and
external gates. Never edit a Phase-01–18 evidence record.

Keep these four statuses independent:

1. plan status;
2. technical implementation status;
3. quality-gate status;
4. activation status.

Code existing is not evidence. Technical completion is not a passed gate. A
passed Sandbox gate is not `LIVE`. Do not check a phase box or begin a
dependent phase until the required evidence is linked and green. If any
mandatory test is red, flaky, skipped without an allowed reason or run on a
different commit, the phase is not complete.

### Phase-close Git and publication rule

For an implementation command, once the requested phase/track is technically
complete, its required quality gate is green and its evidence/status files are
updated:

1. Re-check the diff and stage only phase-owned and indispensable dependency
   files; never sweep unrelated user changes into the commit.
2. Verify the remote is `carosellagiuliano-max/PortalGERM`, the update is a
   fast-forward from current `origin/main`, and the tested commit/tree is the
   one being published.
3. Use the verified, non-placeholder repository-owner `user.name` and
   `carosellagiuliano@gmail.com` as Git author identity.
4. Create one intentional phase-scoped commit and push that exact commit
   directly to `origin/main`. Do not create a pull request or push a remote
   phase branch unless the owner explicitly requests it.
5. Never force-push. If remote history diverged, authentication/identity is
   wrong, unrelated changes overlap, or the phase gate is not green, stop and
   report the exact blocker instead of publishing a partial phase.

Read-only review/analysis requests do not authorize a commit or push. The
owner can explicitly say “nicht committen/pushen” for any implementation
task, which overrides this standing phase-close default.

### External and machine-safety boundaries

A phase implementation never by itself authorizes real-provider enablement,
paid purchases, production deployment, legal/tax approval, public `LIVE`
activation, destructive production-data changes or external messages. These
need the phase’s documented gate and explicit current authorization.

Never shut down, restart or log out the owner’s computer merely because a
phase finishes. Do so only when the owner explicitly requests it in the
current message.

The general repository rules below remain mandatory. Where their historical
MVP examples mention mock checkout, mock export/deletion or demo-only
completion, the active Phase-19+-contract above and the exact phase file
supersede those examples; a mock must not satisfy a remediation requirement
for a real provider, document, privacy process, payment or production gate.

---

## Connected Thinking and End-to-End Ownership

You must always think in a connected, full-stack, end-to-end way.

Do not build isolated pieces that only work visually or only work in one file.

Every change must be checked against the whole system:

* What depends on this?
* What does this depend on?
* Does the database support it?
* Does the backend support it?
* Does the frontend support it?
* Are permissions correct?
* Are validations correct?
* Are edge cases handled?
* Are empty states handled?
* Are error states handled?
* Are loading states handled?
* Are tests or manual checks possible?
* Does seeded data make this feature usable?
* Does this integrate correctly with the current phase?
* Does this affect later phases?
* Does this require updating a detail file or `00-PLAN.md`?

Never "just build something" without checking whether the surrounding system also works.

A feature is not complete if only the UI exists.

A feature is not complete if only the database model exists.

A feature is not complete if only the server action exists.

A feature is complete only when the complete flow works end-to-end.

For every meaningful feature, verify the full chain:

```text
User action -> UI -> validation -> server action/API -> auth/RBAC -> ownership check -> database state -> response -> UI feedback -> audit/logging if needed -> tests or manual verification
```

If any part of this chain is missing, the feature is not done.

---

## Dependency Awareness

Before changing or completing any task, check its dependencies.

For every task, ask:

1. Which previous phases must already work?
2. Which models, helpers, adapters, routes, components, or seed data does this depend on?
3. Are those dependencies actually implemented and verified?
4. Will this change break another page, flow, role, or phase?
5. Does this require updating tests, seed data, docs, or checkboxes?

If a dependency is missing or broken:

* Do not pretend the current task is complete.
* Fix the dependency first if it belongs to the current scope.
* Or document it clearly as a blocker.
* Leave the related checkbox unchecked.
* Mark it as `Needs verification` if implementation exists but cannot be verified.

---

## No Patchwork Rule

Do not create patchwork.

Avoid quick fixes that make one screen appear correct while breaking deeper logic.

Bad examples:

* Button exists but does nothing.
* Form submits but does not persist data.
* Dashboard shows hardcoded numbers.
* Employer can see data without ownership checks.
* Candidate flow works only for seeded demo user.
* Admin page changes UI but not database state.
* Billing appears successful but no order/invoice/subscription is created.
* Talent Radar shows anonymous UI but API response leaks identity fields.
* Job Boost label appears but ranking is not actually affected.
* Fair-Job-Score changes because of paid boost.
* Checkbox is checked but no verification was done.

Good examples:

* UI works with real local/seeded data.
* Server action validates input with Zod.
* RBAC and ownership checks are enforced server-side.
* Database state changes correctly.
* User gets clear success/error feedback.
* Audit logs are written where relevant.
* Empty, loading, and error states exist.
* Tests or manual verification prove the flow.
* Markdown checkboxes are updated only after verification.

---

## Full-Stack Completion Standard

The final result must be a serious full-stack MVP that real people can use in a demo or early controlled test.

It must not feel like a half-empty prototype.

It must feel like a connected product.

This means:

### Public users can actually use it

* Search jobs
* Filter jobs
* Open job detail pages
* View companies
* Understand salary and Fair-Job-Score information
* Read guide content
* Submit employer demo leads

### Candidates can actually use it

* Register and log in
* Build a SwissJobPass
* Save jobs
* Apply to jobs
* Track applications
* Manage job alerts
* Use messages
* Control Talent Radar visibility
* Request data export/deletion mock

### Employers can actually use it

* Register and log in
* Manage company profile
* Create jobs
* Submit jobs for review
* View applicants
* Use pipeline actions
* Understand plan usage
* Upgrade through mock checkout
* Receive invoices
* Buy or use Job Boosts
* Access Talent Radar when allowed
* Contact anonymous candidates with credits
* View analytics according to plan

### Admins can actually use it

* Approve/reject jobs
* Verify/suspend companies
* Manage users
* Manage categories and locations
* Review abuse reports
* Use import tools
* View billing data
* Manage plans/products
* View leads
* Grant credits
* Use the business cockpit

---

## Think Like a Product Owner and Engineer

When implementing anything, think from multiple perspectives:

### Candidate perspective

* Is this useful?
* Is it understandable?
* Is privacy protected?
* Does the candidate stay in control?
* Does it work on mobile?
* Is the next action clear?

### Employer perspective

* Does this help hiring?
* Is the value clear?
* Are upgrades understandable?
* Are applicants manageable?
* Is billing transparent?
* Does the dashboard show useful information?

### Admin perspective

* Can the platform be moderated?
* Can abuse be handled?
* Can jobs and companies be controlled?
* Are important actions logged?
* Can business performance be understood?

### Technical perspective

* Is the architecture clean?
* Are dependencies respected?
* Is it secure?
* Is it testable?
* Is it maintainable?
* Is it extendable after the MVP?

### Business perspective

* Does this support monetization?
* Does this make the product more credible?
* Does this help a demo with users or investors?
* Does it avoid looking empty?
* Does it create trust?

---

## End-to-End Verification Before Marking Done

Before marking any task, subtask, or phase as complete, perform an end-to-end check.

At minimum, verify:

* The user can reach the page.
* The page loads without errors.
* The main action works.
* The database changes correctly if applicable.
* Unauthorized users are blocked.
* Wrong-role users are blocked.
* Another user's data cannot be accessed.
* The UI gives useful feedback.
* Edge cases are handled.
* The feature works with seeded data.
* Relevant tests or manual checks are documented.

Only after this:

1. Check the box in the detailed phase file.
2. Add a short verification note if useful.
3. Update `00-PLAN.md` if the phase-level status changed.

Never update `00-PLAN.md` first.

Always update the detailed phase file first, then the master plan.

---

## Final Full-Stack Quality Goal

The final SwissTalentHub MVP must be:

* Full-stack
* Connected
* Usable
* Demo-ready
* Secure enough for a controlled MVP demo
* Professional in UX
* Credible for Swiss employers
* Useful for candidates
* Manageable by admins
* Supported by seeded data
* Backed by real local database state
* Protected by server-side authorization

---

## Next.js Version Note

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes -- APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
