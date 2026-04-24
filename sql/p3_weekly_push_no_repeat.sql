-- Weekly push delivery history to guarantee user-level non-repetition.
-- Run this script in Supabase SQL Editor before enabling the new weekly push logic.

create table if not exists public.user_weekly_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.push_issues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references public.papers(id) on delete cascade,
  issue_week_start date not null,
  delivered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (issue_id, user_id, paper_id),
  unique (user_id, paper_id)
);

create index if not exists idx_uwpd_user_issue
  on public.user_weekly_push_deliveries (user_id, issue_id);

create index if not exists idx_uwpd_user_created
  on public.user_weekly_push_deliveries (user_id, created_at desc);

alter table public.user_weekly_push_deliveries enable row level security;

drop policy if exists uwpd_select_own_or_admin on public.user_weekly_push_deliveries;
create policy uwpd_select_own_or_admin
on public.user_weekly_push_deliveries
for select
to authenticated
using (user_id = auth.uid() or public.is_admin(auth.uid()));
