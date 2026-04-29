-- Model Hub: lightweight GitHub project index.
-- Apply through the externally owned Supabase migration workflow.

create table if not exists public.model_hub_items (
  id uuid primary key default gen_random_uuid(),
  github_id bigint not null unique,
  full_name text not null unique,
  owner text not null,
  name text not null,
  html_url text not null,
  description text,
  language text,
  license_spdx text,
  topics text[] not null default '{}'::text[],
  stargazers_count integer not null default 0,
  forks_count integer not null default 0,
  open_issues_count integer not null default 0,
  watchers_count integer not null default 0,
  pushed_at timestamptz,
  github_created_at timestamptz,
  github_updated_at timestamptz,
  homepage text,
  default_branch text,
  category text not null default 'medical-ai',
  task_types text[] not null default '{}'::text[],
  domain_tags text[] not null default '{}'::text[],
  model_signals text[] not null default '{}'::text[],
  quality_flags text[] not null default '{}'::text[],
  recommendation_score numeric(8,3) not null default 0,
  recommendation_reason text,
  source_queries text[] not null default '{}'::text[],
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.model_hub_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'github',
  status text not null default 'processing',
  query_count integer not null default 0,
  fetched_count integer not null default 0,
  upserted_count integer not null default 0,
  skipped_count integer not null default 0,
  error_message text,
  meta jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint model_hub_sync_runs_status_check
    check (status in ('processing', 'success', 'failed'))
);

create index if not exists idx_model_hub_items_category_score
  on public.model_hub_items (category, recommendation_score desc, stargazers_count desc);

create index if not exists idx_model_hub_items_score
  on public.model_hub_items (recommendation_score desc, stargazers_count desc);

create index if not exists idx_model_hub_items_pushed_at
  on public.model_hub_items (pushed_at desc nulls last);

create index if not exists idx_model_hub_items_topics
  on public.model_hub_items using gin (topics);

create index if not exists idx_model_hub_items_domain_tags
  on public.model_hub_items using gin (domain_tags);

create index if not exists idx_model_hub_sync_runs_started_at
  on public.model_hub_sync_runs (started_at desc);

drop trigger if exists trg_model_hub_items_set_updated_at on public.model_hub_items;
create trigger trg_model_hub_items_set_updated_at
before update on public.model_hub_items
for each row execute function set_updated_at();

alter table public.model_hub_items enable row level security;
alter table public.model_hub_sync_runs enable row level security;

drop policy if exists "model_hub_items_select_public" on public.model_hub_items;
create policy "model_hub_items_select_public"
on public.model_hub_items
as permissive
for select
using (true);

drop policy if exists "model_hub_sync_runs_select_admin" on public.model_hub_sync_runs;
create policy "model_hub_sync_runs_select_admin"
on public.model_hub_sync_runs
as permissive
for select
using (is_admin(auth.uid()));

grant select on public.model_hub_items to anon, authenticated;
grant select on public.model_hub_sync_runs to authenticated;
