-- Model Hub: manual curation fields.
-- Apply through the externally owned Supabase migration workflow.

alter table public.model_hub_items
  add column if not exists curator_summary text,
  add column if not exists curated_recommendation_reason text,
  add column if not exists project_understanding text,
  add column if not exists risk_notes text,
  add column if not exists target_users text[] not null default '{}'::text[],
  add column if not exists curation_tags text[] not null default '{}'::text[],
  add column if not exists curated_score numeric(5,2),
  add column if not exists curation_status text,
  add column if not exists curated_at timestamptz,
  add column if not exists curated_by text,
  add column if not exists curation_notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'model_hub_items_curated_score_check'
      and conrelid = 'public.model_hub_items'::regclass
  ) then
    alter table public.model_hub_items
      add constraint model_hub_items_curated_score_check
      check (curated_score is null or (curated_score >= 0 and curated_score <= 100));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'model_hub_items_curation_status_check'
      and conrelid = 'public.model_hub_items'::regclass
  ) then
    alter table public.model_hub_items
      add constraint model_hub_items_curation_status_check
      check (
        curation_status is null
        or curation_status in ('featured', 'recommended', 'watchlist', 'hold', 'archived')
      );
  end if;
end $$;

create index if not exists idx_model_hub_items_curated_score
  on public.model_hub_items (curated_score desc nulls last, recommendation_score desc);

create index if not exists idx_model_hub_items_curation_status
  on public.model_hub_items (curation_status, curated_score desc nulls last);

comment on column public.model_hub_items.curator_summary is
  'Short public editor summary for manually curated Model Hub cards.';
comment on column public.model_hub_items.curated_recommendation_reason is
  'Manual recommendation reason; displayed before machine-generated recommendation_reason.';
comment on column public.model_hub_items.project_understanding is
  'Curator understanding of what the project provides and how it may be used.';
comment on column public.model_hub_items.risk_notes is
  'Manual risk notes such as license, maintenance, data availability, or clinical claim caveats.';
comment on column public.model_hub_items.target_users is
  'Audience tags for curated Model Hub recommendations.';
comment on column public.model_hub_items.curation_tags is
  'Editorial tags such as active, paper-backed, deployment-ready, or needs-review.';
comment on column public.model_hub_items.curated_score is
  'Manual 0-100 curation score.';
comment on column public.model_hub_items.curation_status is
  'Manual editorial status: featured, recommended, watchlist, hold, or archived.';
