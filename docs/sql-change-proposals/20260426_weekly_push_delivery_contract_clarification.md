# Weekly Push Delivery Contract Clarification

## Audience

This note is for the database owner/Claude.

## Short Answer

`weekly-push` should not silently reuse `user_weekly_spotlight_deliveries`.

The current codebase has two similar but different weekly email flows:

- `weekly-spotlight-email`
  - Delivery table: `user_weekly_spotlight_deliveries`
  - Purpose: one delivery record per user per week.
  - Stored shape: email address, status, trigger source, error, sent time, and a `paper_ids` array.
- `weekly-push`
  - Delivery table expected by code: `user_weekly_push_deliveries`
  - Purpose: per-user, per-paper delivery history.
  - Stored shape expected by code: `issue_id`, `user_id`, `paper_id`, `issue_week_start`, `delivered_at`.

Because `weekly-push` checks whether a specific user has already received a
specific paper, the existing spotlight table is not an equivalent replacement.
Using the spotlight table as-is would weaken or break the no-repeat behavior.

## Evidence In Repository

The `weekly-push` flow is not a Codex-created typo. It already has an older SQL
draft:

- `sql/p3_weekly_push_no_repeat.sql`

That draft creates:

- `public.user_weekly_push_deliveries`
- unique `(issue_id, user_id, paper_id)`
- unique `(user_id, paper_id)`

The `weekly-spotlight-email` flow has a separate SQL draft:

- `sql/p4_weekly_spotlight_email.sql`

That draft creates:

- `public.user_weekly_spotlight_deliveries`
- unique `(user_id, issue_week_start)`

At the time of the first review, the production schema contained
`push_issues`, `push_issue_items`, and `user_weekly_spotlight_deliveries`, but
not `user_weekly_push_deliveries`.

After DB-owner migration on 2026-04-26, production now includes
`user_weekly_push_deliveries`.

## Product Decision

Resolved on 2026-04-26:

- Option A was chosen.
- `public.user_weekly_push_deliveries` was created in production.
- Production is now treated as canonical.
- `sql/p3_weekly_push_no_repeat.sql` has been synced to the applied production
  shape.

The original options were recorded as historical context:

### Option A: Keep `weekly-push`

If the product should keep `/api/cron/weekly-push`, production needed one table
contract. Claude should create a formal Supabase migration for
`public.user_weekly_push_deliveries`, based on the agreed contract and reviewed
under the normal SQL workflow.

This keeps the current `weekly-push` behavior intact:

- build a weekly issue in `push_issues`
- store ranked issue papers in `push_issue_items`
- avoid resending the same paper to the same user across weeks
- record each delivered paper individually

### Option B: Retire `weekly-push`

If `weekly-spotlight-email` is now the canonical weekly email flow, then no new
database table is needed. Instead, application code should disable/remove:

- `/api/cron/weekly-push`
- the `weekly-push` Vercel cron entry
- any admin/manual UI action that triggers `weekly-push`
- the unused `weekly-push` repository/service code after confirming nothing
  else calls it

This avoids adding a table for a deprecated path.

## Codex Recommendation

Do not map `weekly-push` onto `user_weekly_spotlight_deliveries` without an
intentional product refactor.

The least surprising fix was to treat this as a missing `weekly-push`
migration because the scheduled `/api/cron/weekly-push` job is intended to
remain active.

That migration has now been applied by the DB owner and the local SQL baseline
has been synced to the production canonical shape.
