# PortalGERM repository scope

`PortalGERM` is a separate nested Git repository with its own remote and
governance. The parent file `../CLAUDE.md` belongs to the different
`Portal.git` repository and does **not** define architecture or provider
behavior for this repository.

For work below this directory, read and follow:

1. [`AGENTS.md`](./AGENTS.md);
2. [`codex-plan/00-PLAN.md`](./codex-plan/00-PLAN.md);
3. [`codex-plan/decisions.md`](./codex-plan/decisions.md), especially ADR-014
   and ADR-016.

PortalGERM remains intentionally mock-only for external providers. Payment,
email and storage are not activated by parent-repository code or environment
keys. Any real-provider change requires an explicit PortalGERM ADR, its own
security/legal/operations gate and end-to-end evidence.
