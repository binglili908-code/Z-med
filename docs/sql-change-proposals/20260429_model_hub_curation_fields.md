# Model Hub Manual Curation Fields

## Why

The Model Hub is moving from automatic GitHub aggregation toward a manually curated medical AI project radar. The app needs separate fields for editor summaries, recommendation reasons, project understanding, risk notes, target audiences, and a manual curation score.

## App Dependencies

- `src/shared/contracts/model-hub.ts`
- `src/shared/contracts/model-hub.schema.ts`
- `src/server/repositories/model-hub.ts`
- `src/app/model-hub/page.tsx`
- `src/scripts/upsert-confirmed-model-hub-curation.ts`

## Proposed SQL

Use `sql/p12_model_hub_curation_fields.sql`.

## Rollout Order

1. Deploy app code. The repository layer falls back to the legacy column list if curation columns do not exist yet.
2. Apply `sql/p12_model_hub_curation_fields.sql` through the externally owned Supabase workflow.
3. Run a dry-run curation update with a confirmed JSON file.
4. Apply the curation update only after review.
5. Verify `/model-hub` renders curated summaries and risk notes.

## Backward Compatibility

The app can still render the existing Model Hub before the SQL is applied because curation fields are optional and the data repository has a legacy select fallback.

## Verification Queries

```sql
select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'model_hub_items'
  and column_name in (
    'curator_summary',
    'curated_recommendation_reason',
    'project_understanding',
    'risk_notes',
    'target_users',
    'curation_tags',
    'curated_score',
    'curation_status',
    'curated_at',
    'curated_by',
    'curation_notes'
  )
order by column_name;

select
  full_name,
  curation_status,
  curated_score,
  curator_summary,
  curated_at
from public.model_hub_items
where curation_status is not null
order by curated_score desc nulls last
limit 20;
```
