-- Dynamic medical query planner persistence and recommendation context.
-- Apply in Supabase SQL editor after reviewing with the DB owner.
-- The application code works without this script; these tables make planner
-- output, atomic term mapping, and keyword recommendation diagnostics durable.

create table if not exists public.medical_query_plan_cache (
  input_hash text primary key,
  raw_input text[] not null,
  normalized_input text[] not null,
  plan jsonb not null,
  source text not null default 'minimax_pubmed',
  usage_count integer not null default 0,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.medical_term_mapping_cache (
  term_hash text primary key,
  raw_term text not null,
  normalized_term text not null,
  role_hint text not null,
  language text not null,
  mapping jsonb not null,
  source text not null default 'pubmed_mesh',
  usage_count integer not null default 0,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medical_term_mapping_cache_role_check
    check (role_hint in ('domain', 'disease', 'method', 'journal', 'broad', 'frontier')),
  constraint medical_term_mapping_cache_language_check
    check (language in ('zh', 'en', 'mixed', 'unknown'))
);

create table if not exists public.paper_recommendation_contexts (
  id uuid primary key default gen_random_uuid(),
  pmid text not null,
  keyword text not null,
  input_hash text,
  plan_topic text,
  source text not null default 'keyword_sync_dynamic_context',
  rpc_score jsonb not null default '{}'::jsonb,
  dynamic_context jsonb not null default '{}'::jsonb,
  matched_terms text[] not null default '{}',
  is_recommendation_eligible boolean not null default false,
  quality_tier text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_recommendation_contexts_pmid_keyword_key unique (pmid, keyword),
  constraint paper_recommendation_contexts_pmid_fkey
    foreign key (pmid) references public.papers(pmid) on delete cascade
);

create index if not exists medical_query_plan_cache_expires_at_idx
  on public.medical_query_plan_cache (expires_at);

create index if not exists medical_term_mapping_cache_lookup_idx
  on public.medical_term_mapping_cache (normalized_term, language, role_hint);

create index if not exists medical_term_mapping_cache_expires_at_idx
  on public.medical_term_mapping_cache (expires_at);

create index if not exists paper_recommendation_contexts_keyword_eligible_idx
  on public.paper_recommendation_contexts (keyword, is_recommendation_eligible, synced_at desc);

create index if not exists paper_recommendation_contexts_pmid_idx
  on public.paper_recommendation_contexts (pmid);

create index if not exists paper_recommendation_contexts_dynamic_context_gin_idx
  on public.paper_recommendation_contexts using gin (dynamic_context);

alter table public.medical_query_plan_cache enable row level security;
alter table public.medical_term_mapping_cache enable row level security;
alter table public.paper_recommendation_contexts enable row level security;

revoke all on table public.medical_query_plan_cache from anon, authenticated;
revoke all on table public.medical_term_mapping_cache from anon, authenticated;
revoke all on table public.paper_recommendation_contexts from anon, authenticated;

comment on table public.medical_query_plan_cache is
  'Server-only cache for complete dynamic medical query plans.';
comment on table public.medical_term_mapping_cache is
  'Server-only atomic PubMed/MeSH mapping cache for planner terms.';
comment on table public.paper_recommendation_contexts is
  'Server-only diagnostics and eligibility facts for keyword-sync recommendations.';

-- Optional cleanup; keep as a manual operation or wire to a cron later.
-- delete from public.medical_query_plan_cache where expires_at is not null and expires_at < now();
-- delete from public.medical_term_mapping_cache where expires_at is not null and expires_at < now();
-- delete from public.paper_recommendation_contexts where synced_at < now() - interval '180 days';
