-- Semantic Scholar sidecar tables.
-- These are server-only tables used to enrich existing PubMed papers and hold
-- short-lived recommendation candidates. Do not expose them to browser clients.

create table if not exists public.semantic_scholar_paper_enrichments (
  paper_id uuid primary key references public.papers(id) on delete cascade,
  pmid text not null,
  doi text,
  s2_paper_id text,
  corpus_id text,
  s2_url text,
  title text,
  venue text,
  year integer,
  publication_date date,
  reference_count integer,
  citation_count integer not null default 0,
  influential_citation_count integer not null default 0,
  is_open_access boolean,
  open_access_pdf_url text,
  open_access_pdf_status text,
  fields_of_study text[] not null default '{}',
  publication_types text[] not null default '{}',
  external_ids jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  last_enriched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists semantic_scholar_paper_enrichments_pmid_key
  on public.semantic_scholar_paper_enrichments (pmid);

create unique index if not exists semantic_scholar_paper_enrichments_s2_paper_id_key
  on public.semantic_scholar_paper_enrichments (s2_paper_id)
  where s2_paper_id is not null;

create index if not exists semantic_scholar_paper_enrichments_last_enriched_idx
  on public.semantic_scholar_paper_enrichments (last_enriched_at);

create index if not exists semantic_scholar_paper_enrichments_citation_idx
  on public.semantic_scholar_paper_enrichments (citation_count desc);

create index if not exists semantic_scholar_paper_enrichments_fields_gin_idx
  on public.semantic_scholar_paper_enrichments using gin (fields_of_study);

create table if not exists public.semantic_scholar_candidates (
  id uuid primary key default gen_random_uuid(),
  s2_paper_id text not null,
  corpus_id text,
  doi text,
  pmid text,
  title text not null,
  abstract text,
  venue text,
  year integer,
  publication_date date,
  s2_url text,
  open_access_pdf_url text,
  fields_of_study text[] not null default '{}',
  publication_types text[] not null default '{}',
  citation_count integer not null default 0,
  influential_citation_count integer not null default 0,
  seed_s2_paper_ids text[] not null default '{}',
  seed_paper_ids uuid[] not null default '{}',
  seed_pmids text[] not null default '{}',
  quality_score numeric(6,4) not null default 0,
  quality_reasons text[] not null default '{}',
  is_review_like boolean not null default false,
  eligible_for_promotion boolean not null default false,
  pubmed_verification_status text not null default 'not_checked',
  pubmed_verified_pmid text,
  pubmed_verified_at timestamptz,
  promotion_score numeric(6,4) not null default 0,
  promotion_reasons text[] not null default '{}',
  promotion_checked_at timestamptz,
  promotion_dry_run_payload jsonb not null default '{}'::jsonb,
  source text not null default 'semantic_scholar_recommendations',
  status text not null default 'pending',
  raw_payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint semantic_scholar_candidates_s2_paper_id_key unique (s2_paper_id),
  constraint semantic_scholar_candidates_status_check
    check (status in ('pending', 'promoted', 'rejected', 'expired')),
  constraint semantic_scholar_candidates_pubmed_verification_status_check
    check (pubmed_verification_status in ('not_checked', 'verified', 'not_found', 'failed', 'skipped'))
);

create index if not exists semantic_scholar_candidates_status_expires_idx
  on public.semantic_scholar_candidates (status, expires_at);

create index if not exists semantic_scholar_candidates_citation_idx
  on public.semantic_scholar_candidates (citation_count desc);

create index if not exists semantic_scholar_candidates_fields_gin_idx
  on public.semantic_scholar_candidates using gin (fields_of_study);

create index if not exists semantic_scholar_candidates_promotion_idx
  on public.semantic_scholar_candidates
  (status, eligible_for_promotion, quality_score desc, expires_at);

create index if not exists semantic_scholar_candidates_pubmed_verification_idx
  on public.semantic_scholar_candidates
  (pubmed_verification_status, promotion_score desc, promotion_checked_at desc);

alter table public.semantic_scholar_candidates
  add column if not exists quality_score numeric(6,4) not null default 0,
  add column if not exists quality_reasons text[] not null default '{}',
  add column if not exists is_review_like boolean not null default false,
  add column if not exists eligible_for_promotion boolean not null default false,
  add column if not exists pubmed_verification_status text not null default 'not_checked',
  add column if not exists pubmed_verified_pmid text,
  add column if not exists pubmed_verified_at timestamptz,
  add column if not exists promotion_score numeric(6,4) not null default 0,
  add column if not exists promotion_reasons text[] not null default '{}',
  add column if not exists promotion_checked_at timestamptz,
  add column if not exists promotion_dry_run_payload jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.semantic_scholar_candidates
    add constraint semantic_scholar_candidates_pubmed_verification_status_check
    check (pubmed_verification_status in ('not_checked', 'verified', 'not_found', 'failed', 'skipped'));
exception
  when duplicate_object then null;
end $$;

alter table public.semantic_scholar_paper_enrichments enable row level security;
alter table public.semantic_scholar_candidates enable row level security;

revoke all on table public.semantic_scholar_paper_enrichments from anon, authenticated;
revoke all on table public.semantic_scholar_candidates from anon, authenticated;

drop trigger if exists trg_semantic_scholar_paper_enrichments_set_updated_at
  on public.semantic_scholar_paper_enrichments;
create trigger trg_semantic_scholar_paper_enrichments_set_updated_at
before update on public.semantic_scholar_paper_enrichments
for each row execute function public.set_updated_at();

drop trigger if exists trg_semantic_scholar_candidates_set_updated_at
  on public.semantic_scholar_candidates;
create trigger trg_semantic_scholar_candidates_set_updated_at
before update on public.semantic_scholar_candidates
for each row execute function public.set_updated_at();
