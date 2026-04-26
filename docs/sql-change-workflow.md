# SQL Change Workflow

This project treats production Supabase DDL as externally owned.

Codex may:

- Read application code and infer database contracts.
- Run read-only schema/RPC exports through `npm run db:export-contracts`.
- Generate SQL change proposal documents for Claude/DB-owner review.
- Edit local SQL files and migration candidates after explicit approval.

Codex must not run against production:

- `create`, `alter`, `drop`, `truncate`, `grant`, `revoke`, or function replacement DDL.
- Data writes, unless the user explicitly approves a scoped data operation.
- Migration application commands.

When SQL changes are needed, Codex should produce a proposal that includes:

- Why the change is needed.
- App files that depend on the database contract.
- Proposed SQL.
- Rollout order.
- Backward-compatibility risks.
- Verification queries.

Claude/DB owner can then convert the proposal into the canonical Supabase migration.
