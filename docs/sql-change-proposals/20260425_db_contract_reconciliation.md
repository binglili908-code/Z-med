# DB Contract Reconciliation Proposal

Generated after the read-only production schema/RPC export.

## Scope

This proposal reconciles the app review findings with the exported Supabase
contract. It is intended for Claude/DB-owner review. Codex should not apply DDL
to production.

## Source Artifacts

- Remote export: `sql/exports/20260425T093644Z_remote_public_schema.sql`
- Export handoff: `docs/sql-change-proposals/20260425T093644Z_supabase_schema_rpc_handoff.md`
- Superseded draft: `sql/p5_app_contracts.sql`

## Review Finding Status

### Finding 1: Database contract not fully versioned

Status: partially closed by export, pending canonical migration split.

The remote export confirms the app-required structures exist in production:

- `profiles.custom_journals`
- `profiles.byok_provider`
- `profiles.byok_api_key_encrypted`
- `profiles.byok_model`
- `profiles.ai_digest_enabled`
- `papers.title_zh`
- `papers.abstract_zh`
- `papers.journal_if`
- `papers.journal_jcr`
- `papers.journal_cas_zone`
- `feed_recommendations`
- `byok_usage_log`
- `ai_analysis_queue`

Action for Claude/DB owner:

1. Treat `sql/exports/20260425T093644Z_remote_public_schema.sql` as the source
   contract snapshot.
2. Split it into canonical ordered migrations or a baseline migration for new
   environments.
3. Do not use `sql/p5_app_contracts.sql` as executable SQL. It was a pre-export
   draft and is intentionally comment-only now.

### Finding 2: RPC contract not versioned

Status: closed at discovery level, pending canonical migration split.

The remote export contains all app-required RPCs:

- `build_pubmed_query_for_keyword(p_keyword text, p_days_back integer default 7)`
- `calculate_ai_med_score(p_title text, p_abstract text default '')`
- `get_journal_tier_and_weight(p_journal text)`
- `get_or_flag_keyword(p_keyword text)`
- `get_personalized_feed(p_user_id uuid, p_page integer default 1, p_page_size integer default 20)`
- `save_llm_synonyms(...)` in both 3-arg and 4-arg overloads

Action for Claude/DB owner:

1. Preserve exact function bodies and overloads from the export.
2. Keep return shapes stable for current app code:
   - `get_personalized_feed` returns JSONB with `papers`, `total`, `page`, and
     `page_size`-style metadata.
   - `calculate_ai_med_score`, `get_or_flag_keyword`, `build_pubmed_query_for_keyword`,
     and `save_llm_synonyms` return JSONB.
   - `get_journal_tier_and_weight` returns a table shape with tier/weight/impact
     metadata.

### Finding 3: Feed total semantics unstable

Status: code fixed.

The API fallback branch now requests an exact count from Supabase before
returning `total`, instead of using the current page length.

### Finding 4: Frontend/backend DTO duplicated

Status: code improved.

The feed and spotlight surfaces now share contracts from
`src/shared/contracts/papers.ts`, and subscription settings share
`src/shared/contracts/subscriptions.ts`.

## Important Differences From The Superseded Draft

The pre-export draft should not be executed because it does not exactly match
production:

- `papers.journal_if` is `numeric(7,2)` in production, not the draft's
  `numeric(8,4)`.
- `feed_recommendations.recommendation_score` is `numeric(7,4)` in production.
- `feed_recommendations` has `consumed_at` in production and no `updated_at`.
- `byok_usage_log.model` is `not null` in production.
- `byok_usage_log.usage_type` has an explicit check for
  `translate`, `summarize`, `pdf_analysis`, and `chat`.
- `byok_usage_log` has `error_message` in production.
- `ai_analysis_queue` uses `error_message`, has `completed_at`, and its
  `user_id` foreign key is `on delete set null`.
- Production includes additional app-relevant structures not in the draft:
  `ai_digest_log`, `journal_if_cache`, `journal_sync_log`, `keyword_synonyms`,
  `subject_categories`, `user_journal_subscriptions`, and `weekly_reports`.

## Recommended Migration Strategy

For new/staging environments:

1. Create a baseline migration from the remote export.
2. Keep seed data separate from schema.
3. Restore extensions, tables, constraints, functions, indexes, RLS, policies,
   and triggers in dependency order.
4. Run smoke queries below before app deployment.

For production:

1. Do not replay the baseline against production.
2. Use future migrations only as explicit deltas reviewed by Claude/DB owner.
3. Prefer additive, idempotent changes.

## Security Hardening Review For Claude

The export contains `SECURITY DEFINER` functions in `public`, including
auth/profile helpers and `is_admin`. This may be intentional, but Claude/DB
owner should review:

- Whether each definer function has a safe `search_path`.
- Whether any definer function should move to a private schema.
- Whether exposed public functions need explicit grants/revokes.
- Whether RLS policies rely only on trusted claims and table data.

Do not change this automatically; treat it as a dedicated hardening review.

## Verification Queries

Run these in a non-mutating SQL session:

```sql
select to_regclass('public.feed_recommendations') as feed_recommendations,
       to_regclass('public.byok_usage_log') as byok_usage_log,
       to_regclass('public.ai_analysis_queue') as ai_analysis_queue;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'papers')
  and column_name in (
    'custom_journals',
    'byok_provider',
    'byok_api_key_encrypted',
    'byok_model',
    'ai_digest_enabled',
    'title_zh',
    'abstract_zh',
    'journal_if',
    'journal_jcr',
    'journal_cas_zone'
  )
order by table_name, ordinal_position;

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_personalized_feed',
    'calculate_ai_med_score',
    'get_journal_tier_and_weight',
    'get_or_flag_keyword',
    'build_pubmed_query_for_keyword',
    'save_llm_synonyms'
  )
order by p.proname, args;
```
