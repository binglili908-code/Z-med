# Model Hub GitHub Sync SQL Proposal

Date: 2026-04-29

## Why

The `/model-hub` page now expects a lightweight Supabase-backed index of
GitHub medical AI repositories. The app intentionally stores only compact
metadata and recommendation scores so Supabase is not used as a crawler store,
README archive, or model artifact host.

## App Files That Depend On This Contract

- `src/app/model-hub/page.tsx`
- `src/lib/github-model-hub.ts`
- `src/scripts/sync-model-hub-github.ts`
- `src/server/repositories/model-hub.ts`
- `src/shared/contracts/model-hub.ts`
- `src/shared/contracts/model-hub.schema.ts`

## Proposed SQL

Use `sql/p11_model_hub_github_sync.sql`.

It creates:

- `public.model_hub_items`
  - one row per GitHub repository;
  - compact metadata only: GitHub ids, URL, description, topics, language,
    license, activity metrics, category, task tags, recommendation score, and
    sync provenance;
  - no README bodies, screenshots, model weights, PDFs, or large raw payloads.
- `public.model_hub_sync_runs`
  - internal audit trail for GitHub sync attempts.

## Access Model

- `model_hub_items` is public readable through RLS because the page is public
  content and contains only public GitHub metadata.
- `model_hub_sync_runs` is admin-readable only.
- Writes are performed by the server-side service role from the explicit local
  manual intake script, not by a scheduled production cron.

## Rollout Order

1. Apply `sql/p11_model_hub_github_sync.sql` in the DB-owner migration flow.
2. Add optional `GITHUB_TOKEN` to the local/operator environment when running
   manual intake.
3. Deploy the app code.
4. Run:
   `npm run model-hub:github-sync -- --query-limit=8 --per-page=30`
5. Re-run with `--apply --yes-i-understand-this-writes-to-database` only after
   reviewing the dry-run response.
6. Open `/model-hub` and confirm items render.

## Verification Queries

```sql
select count(*) from public.model_hub_items;

select category, count(*), max(last_synced_at)
from public.model_hub_items
group by category
order by count(*) desc;

select full_name, recommendation_score, stargazers_count, pushed_at
from public.model_hub_items
order by recommendation_score desc
limit 20;

select status, query_count, fetched_count, upserted_count, skipped_count, started_at, finished_at
from public.model_hub_sync_runs
order by started_at desc
limit 10;
```

## Backward Compatibility

The page catches missing-table errors and shows an empty configuration state, so
deploying the application before the SQL does not break the site. The manual
intake script will fail until the tables exist.

## Free Plan Notes

This schema is intentionally small. A few thousand repositories should consume
far less space than the existing `papers` table because it does not store
abstracts, AI analysis bodies, source payloads, or documents.
