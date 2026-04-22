-- P0 easyScholar integration: journal_quality sync fields and indexes.
-- Run this script in Supabase SQL Editor before enabling cron in production.

alter table public.journal_quality
  add column if not exists impact_factor numeric(8,4),
  add column if not exists jcr_quartile text,
  add column if not exists cas_zone text,
  add column if not exists es_last_sync_at timestamptz,
  add column if not exists es_sync_status text
    check (es_sync_status in ('success', 'failed', 'not_found')),
  add column if not exists es_error text,
  add column if not exists es_raw jsonb;

create index if not exists idx_journal_quality_if_desc
  on public.journal_quality (impact_factor desc nulls last);

create index if not exists idx_journal_quality_es_status
  on public.journal_quality (es_sync_status);

create index if not exists idx_journal_quality_es_last_sync
  on public.journal_quality (es_last_sync_at desc nulls last);
