# SQL Change Proposal: Subscription Preference Normalization

## Summary

Add cached normalized subscription preference fields to `public.profiles`.

The application will keep the user's raw input in the existing columns:

- `subscription_keywords`
- `custom_journals`

MiniMax-normalized matching terms will be stored separately:

- `subscription_normalized_keywords`
- `subscription_normalized_journals`
- `subscription_normalized_terms`
- `subscription_normalized_at`
- `subscription_normalization_model`
- `subscription_normalization_error`

## Why

Users may enter abbreviations, typos, shorthand journal names, or natural
language such as:

- `ejves`
- `vascular surgrey`
- `LLM in ICU`

The app should not call MiniMax for every paper match. Instead, it should call
MiniMax once when the user saves preferences, cache the normalized terms, and
reuse those terms for homepage spotlight, weekly push, and search matching.

## SQL

Canonical local draft:

- `sql/p7_subscription_preference_normalization.sql`

## Safety

- Existing raw preference columns are preserved.
- Existing RLS policies on `profiles` continue to govern row access.
- No RPC changes are required.
- The app code is backward compatible: if these columns do not exist yet, it
  falls back to the old raw columns and local alias matching.

## Verification Queries

```sql
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in (
    'subscription_normalized_keywords',
    'subscription_normalized_journals',
    'subscription_normalized_terms',
    'subscription_normalized_at',
    'subscription_normalization_model',
    'subscription_normalization_error'
  )
order by column_name;
```

```sql
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'profiles'
  and indexname in (
    'idx_profiles_normalized_keywords_gin',
    'idx_profiles_normalized_journals_gin'
  );
```

## Message To Claude

Please apply `sql/p7_subscription_preference_normalization.sql`.

Do not change existing RPCs. Do not overwrite `subscription_keywords` or
`custom_journals`; those remain the raw user-facing preferences. The new fields
are only a cached AI-normalized matching layer.
