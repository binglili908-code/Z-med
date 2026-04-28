# Medical Query Planner Cache SQL Proposal - 2026-04-27

This document is a proposal only. Do not apply it directly without DB owner
review. The current implementation must not modify Supabase schema.

## Goals

- Cache complete `MedicalQueryPlan` results by normalized input hash.
- Cache atomic term mappings such as `肺癌 -> Lung Neoplasms / lung cancer`.
- Add optional shadow logs for planner QA and future prompt tuning.
- Keep all cache and log data server-only, with no anonymous or authenticated
  client access.

## Recommended Access Model

- Prefer a non-exposed schema such as `internal`.
- Do not grant `anon` or `authenticated` access.
- Enable RLS as defense in depth.
- Access these tables only from server-side jobs or API routes using a service
  role key.
- Keep prompt logs behind `MEDICAL_QUERY_SHADOW_LOGGING_ENABLED=false` by
  default.
- Apply a short retention period to prompt logs because raw medical search
  interests may be sensitive.

## Proposed SQL

```sql
-- Proposal only. DB owner should review before applying.

create schema if not exists internal;

create table if not exists internal.medical_query_plans (
  id uuid primary key default gen_random_uuid(),
  input_hash text not null unique,
  raw_input text[] not null,
  normalized_input text not null,
  plan jsonb not null,
  model text,
  source text not null default 'minimax_pubmed',
  usage_count integer not null default 0,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists internal.medical_term_mappings (
  id uuid primary key default gen_random_uuid(),
  term_hash text not null unique,
  raw_term text not null,
  normalized_term text not null,
  language text not null default 'unknown'
    check (language in ('zh', 'en', 'mixed', 'unknown')),
  role_hint text not null default 'unknown'
    check (role_hint in (
      'domain',
      'disease',
      'method',
      'journal',
      'broad',
      'frontier',
      'unknown'
    )),
  canonical_terms text[] not null default '{}',
  mesh_headings text[] not null default '{}',
  entry_terms text[] not null default '{}',
  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low')),
  source text not null default 'pubmed_mesh'
    check (source in ('pubmed_mesh', 'minimax_pubmed', 'local_fallback')),
  verification_errors text[] not null default '{}',
  usage_count integer not null default 0,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists medical_term_mappings_lookup_idx
  on internal.medical_term_mappings (normalized_term, language, role_hint);

create index if not exists medical_query_plans_expires_at_idx
  on internal.medical_query_plans (expires_at);

create index if not exists medical_term_mappings_expires_at_idx
  on internal.medical_term_mappings (expires_at);

create table if not exists internal.medical_query_prompt_logs (
  id uuid primary key default gen_random_uuid(),
  request_hash text not null,
  user_hash text,
  raw_input text[] not null,
  minimax_output jsonb,
  validated_plan jsonb,
  pubmed_assist jsonb,
  model text,
  parser_error text,
  planner_warnings text[] not null default '{}',
  latency_ms integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists medical_query_prompt_logs_created_at_idx
  on internal.medical_query_prompt_logs (created_at);

create index if not exists medical_query_prompt_logs_expires_at_idx
  on internal.medical_query_prompt_logs (expires_at);

alter table internal.medical_query_plans enable row level security;
alter table internal.medical_term_mappings enable row level security;
alter table internal.medical_query_prompt_logs enable row level security;

-- Intentionally no anon/authenticated grants or permissive RLS policies.
-- Service-role server code can manage these rows while client access remains closed.
```

## Lookup Flow

1. Normalize raw input and compute `input_hash`.
2. Check `internal.medical_query_plans` for a fresh complete plan.
3. If complete plan misses, split the MiniMax candidate groups into atomic terms.
4. For each atomic term, compute `term_hash` and check
   `internal.medical_term_mappings`.
5. Only call PubMed ESpell / MeSH for atomic cache misses or expired rows.
6. Merge cached and fresh atomic mappings back into the final
   `MedicalQueryPlan`.
7. Store the full plan cache after validation.

## Retention And Privacy Notes

- Full query plan cache can have a longer TTL, for example 30-180 days.
- Atomic term mappings can have a longer TTL, for example 180-365 days, because
  MeSH headings change slowly.
- Shadow logs should be short-lived, for example 30 days, unless the product has
  explicit administrator review and deletion workflows.
- `user_hash` should be a one-way hash or omitted. Do not store email addresses
  in prompt logs.
- If prompt logs are used for few-shot updates, examples should be manually
  reviewed and stripped of user-identifying context before being copied into
  code.

## Future Implementation Notes

- Start with read-through atomic cache only; do not change recommendation
  ranking at the same time.
- Keep the existing strict JSON parser. Shadow logs should help identify whether
  prompt examples are enough before considering any parser relaxation.
- Add a cleanup job before enabling shadow logging in production:

```sql
delete from internal.medical_query_prompt_logs
where expires_at < now();

delete from internal.medical_query_plans
where expires_at is not null and expires_at < now();

delete from internal.medical_term_mappings
where expires_at is not null and expires_at < now();
```
