-- Optional user preference for excluding review-like articles from
-- personalized recommendations and weekly subscription emails.
--
-- Safe to run in Supabase SQL Editor. Existing users keep the default behavior
-- because the default is false.

alter table public.profiles
  add column if not exists exclude_reviews boolean not null default false;

comment on column public.profiles.exclude_reviews is
  'When true, personalized recommendations and weekly subscription emails exclude Review/Systematic Review/Meta-Analysis style papers when detectable.';
