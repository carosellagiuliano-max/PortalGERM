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
