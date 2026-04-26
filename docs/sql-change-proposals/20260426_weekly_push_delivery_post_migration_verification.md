# Weekly Push Delivery Post-Migration Verification

## Audience

This note is for the database owner/Claude and the application maintainer.

## Verification Method

Codex ran a read-only metadata export after the database owner applied the
`user_weekly_push_deliveries` migration.

Generated export:

- `sql/exports/20260426T021646Z_remote_public_schema.sql`

No DDL was executed by Codex.

## Result

The production table now exists and satisfies the current application code
contract used by `src/server/repositories/weekly-push.ts`.

Resolution chosen after DB-owner review:

- Production is canonical.
- `sql/p3_weekly_push_no_repeat.sql` has been replaced with the applied
  production shape.

Confirmed table:

- `public.user_weekly_push_deliveries`

Confirmed columns:

- `id`
- `issue_id`
- `user_id`
- `paper_id`
- `issue_week_start`
- `delivered_at`

Confirmed constraints:

- primary key on `id`
- foreign key from `issue_id` to `push_issues(id)` with cascade delete
- foreign key from `paper_id` to `papers(id)` with cascade delete
- foreign key from `user_id` to `auth.users(id)` with cascade delete
- unique `(issue_id, user_id, paper_id)`
- unique `(user_id, paper_id)`

Confirmed RLS:

- RLS is enabled.
- Authenticated users can select their own delivery rows.

## Historical Difference From Previous Local Draft

The production table was compatible with the current app code, but differed
from the previous local draft.

Historical differences that were resolved by adopting production as canonical:

- Local draft includes `created_at timestamptz not null default now()`.
- Production export does not show `created_at` on
  `user_weekly_push_deliveries`.
- Local draft has index `idx_uwpd_user_issue` on `(user_id, issue_id)`.
- Local draft has index `idx_uwpd_user_created` on `(user_id, created_at desc)`.
- Production export shows indexes on `issue_id` and
  `(user_id, issue_week_start desc)` instead.
- Local draft policy allows own rows or admin reads through
  `public.is_admin(auth.uid())`.
- Production export shows own-row reads only.

## App Impact

No immediate app breakage was found from these differences.

The current repository code:

- inserts `issue_id`, `user_id`, `paper_id`, `issue_week_start`, `delivered_at`
- checks same-issue delivery by `issue_id` and `user_id`
- checks cross-week repeated papers by `user_id` and `paper_id`

Those operations are covered by the production columns and unique constraints.

## Follow-Up Decision

No follow-up production migration is required for the current app contract.

If future admin tooling needs to read all delivery records, add that as an
explicit follow-up migration and app feature rather than keeping a speculative
admin policy in this baseline.
