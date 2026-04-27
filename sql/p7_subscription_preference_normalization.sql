-- P7: Cache AI-normalized subscription preferences.
-- Purpose:
-- - Preserve raw user input in subscription_keywords/custom_journals.
-- - Store MiniMax-normalized keywords and journal aliases for matching.
-- - Avoid calling MiniMax during every recommendation/email generation.

alter table public.profiles
  add column if not exists subscription_normalized_keywords text[] not null default '{}'::text[],
  add column if not exists subscription_normalized_journals text[] not null default '{}'::text[],
  add column if not exists subscription_normalized_terms jsonb not null default '{}'::jsonb,
  add column if not exists subscription_normalized_at timestamptz,
  add column if not exists subscription_normalization_model text,
  add column if not exists subscription_normalization_error text;

create index if not exists idx_profiles_normalized_keywords_gin
  on public.profiles using gin (subscription_normalized_keywords);

create index if not exists idx_profiles_normalized_journals_gin
  on public.profiles using gin (subscription_normalized_journals);

-- Backfill existing users with raw values so recommendation code has a stable
-- baseline before each user next saves preferences and gets MiniMax enrichment.
update public.profiles
set
  subscription_normalized_keywords = coalesce(subscription_keywords, '{}'::text[]),
  subscription_normalized_journals = coalesce(custom_journals, '{}'::text[]),
  subscription_normalized_terms = jsonb_build_object(
    'source', 'raw_backfill',
    'raw_keywords', coalesce(subscription_keywords, '{}'::text[]),
    'raw_journals', coalesce(custom_journals, '{}'::text[])
  ),
  subscription_normalized_at = coalesce(subscription_normalized_at, now()),
  subscription_normalization_model = coalesce(subscription_normalization_model, 'raw_backfill'),
  subscription_normalization_error = null
where
  cardinality(subscription_normalized_keywords) = 0
  and cardinality(subscription_normalized_journals) = 0
  and (
    cardinality(coalesce(subscription_keywords, '{}'::text[])) > 0
    or cardinality(coalesce(custom_journals, '{}'::text[])) > 0
  );
