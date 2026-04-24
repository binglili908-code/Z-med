-- Weekly homepage spotlight email delivery history.
-- Run this script in Supabase SQL Editor before enabling the weekly spotlight cron.

create table if not exists public.user_weekly_spotlight_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  issue_week_start date not null,
  email_to text not null,
  spotlight_count integer not null default 0,
  paper_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed')),
  trigger_source text not null default 'cron' check (trigger_source in ('cron', 'manual')),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, issue_week_start)
);

create index if not exists idx_uwsd_issue_week_status
  on public.user_weekly_spotlight_deliveries (issue_week_start desc, status);

create index if not exists idx_uwsd_user_sent_at
  on public.user_weekly_spotlight_deliveries (user_id, sent_at desc);

alter table public.user_weekly_spotlight_deliveries enable row level security;

drop policy if exists uwsd_select_own_or_admin on public.user_weekly_spotlight_deliveries;
create policy uwsd_select_own_or_admin
on public.user_weekly_spotlight_deliveries
for select
to authenticated
using (user_id = auth.uid() or public.is_admin(auth.uid()));
