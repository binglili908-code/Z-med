# DB Owner Handoff After Data Access Refactor

## Audience

This note is for the database owner/Claude who controls production Supabase
schema and RPC migrations.

## Current Boundary

Codex has performed an application-code refactor only.

- No production DDL was executed.
- No production migration was applied.
- No table/column/function was intentionally added, removed, or replaced.
- Supabase access in app/API/service code has been centralized into
  `src/server/repositories/*`.

The main refactor summary is:

- `docs/refactor-step-3-data-access.md`

Existing schema/RPC export artifacts are:

- `sql/exports/20260425T093644Z_remote_public_schema.sql`
- `docs/sql-change-proposals/20260425T093644Z_supabase_schema_rpc_handoff.md`
- `docs/sql-change-proposals/20260425_db_contract_reconciliation.md`
- `docs/sql-change-proposals/20260426_weekly_push_delivery_contract_clarification.md`
- `docs/sql-change-proposals/20260426_weekly_push_delivery_post_migration_verification.md`

## What Changed In App Code

Database calls were moved from route handlers and long service files into
repository modules:

- `profiles.ts`
- `papers.ts`
- `ai-analysis.ts`
- `pubmed-sync.ts`
- `weekly-spotlight-email.ts`
- `weekly-push.ts`
- `paper-translation.ts`
- `pdf-email.ts`
- `byok-settings.ts`
- `reference-data.ts`
- `dev-self-check.ts`
- `recommendations.ts`
- `easyscholar.ts`
- `quality-recompute.ts`

This is intended to preserve behavior while making the database contract
visible in one directory.

## DB Owner Action Requested

Please do not infer new DDL from the refactor alone.

Instead, review whether the repository SQL/migration baseline can recreate the
current production contract:

1. Compare `sql/exports/20260425T093644Z_remote_public_schema.sql` against
   checked-in SQL/migrations.
2. Ensure all app-used tables/columns/RPCs are represented in canonical
   migrations.
3. If gaps exist, create migrations under your normal Supabase migration
   process.
4. If no gaps exist, no DB change is required for this refactor.

## High-Priority Contracts To Verify

Tables and columns now referenced from repositories include:

- `profiles`
  - `id`, `contact_email`, `is_active`
  - `subscription_keywords`, `subscription_mesh_terms`, `custom_journals`
  - `byok_provider`, `byok_api_key_encrypted`, `byok_model`,
    `ai_digest_enabled`
- `papers`
  - `id`, `pmid`, `doi`, `title`, `title_zh`, `abstract`, `abstract_zh`
  - `journal`, `publication_date`, `pubmed_url`
  - `authors`, `mesh_terms`, `keywords`
  - `is_ai_med`, `ai_med_score`, `quality_score`, `quality_tier`
  - `journal_if`, `journal_jcr`, `journal_cas_zone`
  - `is_open_access`, `oa_pdf_url`, `ai_analysis`, `source_payload`
  - `fetched_at`, `updated_at`
- `journal_quality`
  - `id`, `journal_name`, `aliases`, `tier`, `weight`, `impact_factor`
  - `jcr_quartile`, `cas_zone`, `is_active`
  - `es_last_sync_at`, `es_sync_status`, `es_error`, `es_raw`
- `research_topics`
  - `id`, `slug`, `name_zh`, `name_en`, `description`, `sort_order`,
    `is_active`
- `paper_research_topics`
  - `paper_id`, `topic_id`, `confidence`, `source`, `matched_terms`,
    `updated_at`
- `feed_recommendations`
  - `user_id`, `paper_id`, `source_type`, `recommendation_score`, `reason`
  - `is_consumed`, `batch_date`
- `user_paper_interactions`
  - `user_id`, `paper_id`, `pdf_emailed_at`, `updated_at`
- `user_weekly_spotlight_deliveries`
  - `id`, `user_id`, `email_to`, `issue_week_start`, `status`
  - `trigger_source`, `spotlight_count`, `paper_ids`, `last_error`
  - `sent_at`, `updated_at`
- `user_weekly_push_deliveries`
  - `issue_id`, `user_id`, `paper_id`, `issue_week_start`, `delivered_at`
  - Status after DB-owner review: production table created; production shape
    accepted as canonical and synced into `sql/p3_weekly_push_no_repeat.sql`.
- `push_issues`
  - `id`, `issue_week_start`, `status`, `generated_at`, `sent_at`, `meta`
- `push_issue_items`
  - `issue_id`, `paper_id`, `rank`, `quality_score`
- `ai_analysis_queue`
  - `id`, `paper_id`, `user_id`, `provider`, `status`, `priority`
  - `attempts`, `max_attempts`, `completed_at`, `error_message`
- `byok_usage_log`
  - `user_id`, `paper_id`, `provider`, `model`, `usage_type`
  - `input_tokens`, `output_tokens`, `status`, `created_at`
- `sync_state`
  - `key`, `value`, `updated_at`
- `journal_sync_log`
  - `journal_quality_id`, `journal_name`, `sync_from`, `sync_to`
  - `papers_found`, `papers_passed`, `papers_new`, `status`, `error_message`
  - `finished_at`, `created_at`

RPC/function contracts to verify:

- `get_personalized_feed(p_user_id, p_page, p_page_size)`
- `calculate_ai_med_score(p_title, p_abstract)`
- `get_journal_tier_and_weight(p_journal)`
- `get_or_flag_keyword(p_keyword)`
- `build_pubmed_query_for_keyword(p_keyword, p_days_back)`
- `save_llm_synonyms(...)`

## Notes On Behavior Changes

These app-level fixes were intentional and do not require schema changes if
the fields already exist:

- Feed fallback now uses an exact total count instead of current-page length.
- AI analysis queue completion/failure writes `completed_at` / `error_message`.
- Email and recommendation Chinese text was repaired from mojibake.
- Supabase publishable key is supported alongside legacy anon key.

## Suggested Verification Queries

Use read-only checks first:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select routine_name
from information_schema.routines
where specific_schema = 'public'
order by routine_name;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles',
    'papers',
    'journal_quality',
    'research_topics',
    'feed_recommendations',
    'ai_analysis_queue',
    'byok_usage_log'
  )
order by table_name, ordinal_position;
```

## Requested Output From DB Owner

Please return one of:

1. "No DB migration required; current migrations/schema export cover app
   contracts."
2. "Migration required", with a migration file or SQL proposal that explains
   which app contract was missing.
