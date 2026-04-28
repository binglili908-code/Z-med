# Dynamic Medical Query Planner Design - 2026-04-27

## Background

Users can type broad Chinese medical topics such as:

- 眼科
- 心血管
- 肺癌
- 血管
- 医学影像大模型

These topics are effectively unlimited. We should not maintain a giant hand-written alias table.

The current lightweight alias approach is useful only as a safety net for very common abbreviations and known terms. It is not enough for broad biomedical discovery.

## Goal

Build a dynamic medical query planner that turns user input into structured, PubMed-friendly search and recommendation terms.

The planner should:

- understand Chinese and English biomedical topics;
- expand broad domains into useful English biomedical terms;
- use PubMed/MeSH as a grounding and validation source;
- keep terms grouped by meaning instead of mixing everything together;
- help both PubMed retrieval and local recommendation matching;
- avoid overmatching papers that mention a term only incidentally.

## Non-Goals

- Do not modify Supabase schema directly in this implementation.
- Do not rely on a giant manual dictionary of all medical fields.
- Do not let MiniMax freely generate unvalidated search strings as the single source of truth.
- Do not pass raw database row shapes into UI components.

## Proposed Architecture

```text
User keyword(s)
  ↓
MiniMax intent expansion
  ↓
PubMed ESpell / MeSH validation
  ↓
Structured query plan JSON
  ↓
Recommendation matching + PubMed retrieval
  ↓
Optional cache for repeated inputs
```

## Responsibilities

### MiniMax

MiniMax should understand natural language intent.

Example input:

```text
眼科
```

Expected MiniMax output candidates:

```json
{
  "language": "zh",
  "topic": "ophthalmology",
  "core_terms": ["ophthalmology", "eye diseases"],
  "subtopics": ["retina", "fundus", "glaucoma", "diabetic retinopathy", "macular degeneration", "OCT"],
  "related_methods": [],
  "broad_terms": ["eye"],
  "notes": ["User appears to be asking for the ophthalmology domain."]
}
```

For input:

```text
AI + 眼科
```

Expected MiniMax output candidates:

```json
{
  "language": "mixed",
  "topic": "AI in ophthalmology",
  "domain_terms": ["ophthalmology", "eye diseases", "retina", "fundus", "glaucoma", "OCT"],
  "method_terms": ["artificial intelligence", "machine learning", "deep learning", "foundation model", "large language model"],
  "broad_terms": ["eye", "AI"],
  "suggested_intents": [
    {
      "name": "broad_ai_ophthalmology",
      "must_match_groups": [
        ["artificial intelligence", "machine learning", "deep learning"],
        ["ophthalmology", "eye diseases", "retina", "fundus", "glaucoma", "OCT"]
      ]
    },
    {
      "name": "oculomics_frontier",
      "must_match_groups": [
        ["artificial intelligence", "deep learning", "machine learning"],
        ["retinal imaging", "fundus photograph", "retinal microvasculature"],
        ["systemic disease", "cardiovascular", "Alzheimer", "dementia", "biomarker"]
      ]
    },
    {
      "name": "foundation_models_ophthalmology",
      "must_match_groups": [
        ["large language model", "foundation model", "multimodal", "vision-language model"],
        ["ophthalmology", "retina", "fundus", "glaucoma", "OCT"]
      ]
    }
  ]
}
```

MiniMax must return strict JSON only.

### PubMed / MeSH

PubMed and MeSH should ground and validate the candidate terms.

Use existing lightweight PubMed helpers:

- ESpell: spelling correction.
- MeSH search: find standard subject headings.
- MeSH summary: extract heading names and entry terms.

For example:

```text
pancreatic cancer -> Pancreatic Neoplasms
ophthalmology -> Ophthalmology / Eye Diseases
lung cancer -> Lung Neoplasms
```

If a candidate term has no PubMed/MeSH support, keep it only as a weak term unless it appears to be a modern technical phrase such as `foundation model` or `vision-language model`.

### System Rules

The system should turn candidates into a structured plan:

```ts
type MedicalQueryPlan = {
  rawInput: string[];
  topic: string | null;
  language: "zh" | "en" | "mixed" | "unknown";
  groups: Array<{
    name: string;
    role: "domain" | "disease" | "method" | "journal" | "broad" | "frontier";
    terms: string[];
    meshHeadings: string[];
    entryTerms: string[];
    strength: "required" | "strong" | "weak";
  }>;
  intents: Array<{
    name: string;
    description: string;
    mustMatchGroupNames: string[];
    optionalGroupNames: string[];
    pubmedQuery: string;
  }>;
  warnings: string[];
};
```

## Matching Policy

Do not treat every term equally.

Recommended signal strength:

- Strong signal:
  - title match
  - PubMed keywords match
  - MeSH terms match
  - journal match when user explicitly configured journals
- Medium signal:
  - abstract match for specific disease names
- Weak signal:
  - abstract-only match for broad words
  - AI analysis text match
  - generic words like `eye`, `vascular`, `cancer`, `AI`

For broad domain terms, require strong signals.

Example:

```text
User keyword: 血管 / vascular
```

Do not recommend a psychiatry paper merely because its abstract mentions `vascular risk factors`.

Require one of:

- title contains vascular/endovascular;
- MeSH/keywords contain vascular-related terms;
- journal matches a vascular journal preference.

For combined intent such as `AI + 眼科`, require at least one term from each required group:

```text
AI group + ophthalmology group
```

This avoids recommending a generic AI paper with no ophthalmology content, or a generic ophthalmology paper with no AI content.

## PubMed Query Generation

The system can generate PubMed queries from the structured plan.

Example broad AI ophthalmology query:

```text
("Artificial Intelligence"[Mesh] OR "Machine Learning"[Mesh] OR "Deep Learning"[Mesh] OR "artificial intelligence"[tiab] OR "machine learning"[tiab] OR "deep learning"[tiab] OR "neural network*"[tiab])
AND
("Ophthalmology"[Mesh] OR "Eye Diseases"[Mesh] OR "ophthalmology"[tiab] OR "eye disease*"[tiab] OR "retina*"[tiab] OR "fundus"[tiab] OR "glaucoma"[tiab] OR "diabetic retinopathy"[tiab] OR "macular degeneration"[tiab] OR "OCT"[tiab])
```

These queries should be generated from groups, not hand-authored per topic.

## Caching Strategy

Short term:

- Cache in application memory for local requests.
- Useful for tests and development, but not enough for production.

Medium term:

- Store normalized query plans in Supabase.
- Because database schema is owned by DB owner, do not add tables directly.
- If needed, generate a SQL proposal document for the DB owner.

Possible future table:

```sql
-- Proposal only, not to be applied directly by Codex
create table public.medical_query_plans (
  id uuid primary key default gen_random_uuid(),
  input_hash text not null unique,
  raw_input text[] not null,
  plan jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Failure Handling

If MiniMax is unavailable:

1. Use PubMed ESpell / MeSH with the raw user terms.
2. Use the small safe alias table for high-confidence abbreviations.
3. Mark the plan as degraded.
4. Avoid broad fallback matches that can create noisy recommendations.

If PubMed is unavailable:

1. Use MiniMax candidates but mark them unverified.
2. Prefer title/keyword/MeSH matches already present in local paper rows.
3. Avoid broad abstract-only matches.

## Minimal Implementation Plan

### Step 1: Define Types And Parser

Add:

```text
src/lib/medical-query-plan.ts
```

Include:

- TypeScript types.
- Zod schema for MiniMax output.
- parser that rejects non-JSON or malformed model output.

### Step 2: Add MiniMax Planner

Add:

```text
src/lib/medical-query-planner.ts
```

Function:

```ts
planMedicalQuery(input: string[]): Promise<MedicalQueryPlan>
```

It should:

- call MiniMax;
- parse strict JSON;
- call PubMed assist for candidate terms;
- return grouped terms.

### Step 3: Add Tests

Tests should cover:

- `眼科` expands to ophthalmology-related terms.
- `AI + 眼科` creates two required groups.
- non-JSON model output fails cleanly.
- PubMed assist terms are merged without duplicates.

### Step 4: Integrate With Subscription Normalization

Use the planner inside the existing subscription preference normalizer.

Do not replace all matching logic at once.

Start by enriching:

- `subscription_normalized_keywords`
- `subscription_normalized_terms`

### Step 5: Integrate With Matching

Use query plan groups to improve:

- weekly push selection;
- personalized feed ranking;
- PubMed retrieval queries.

Keep the current matching behavior as fallback.

## Rollout Recommendation

This should be implemented behind a feature flag:

```text
MEDICAL_QUERY_PLANNER_ENABLED=false
```

Initial rollout:

1. Enable locally.
2. Test with known inputs:
   - 眼科
   - AI + 眼科
   - 心血管
   - 肺癌
   - 血管
3. Compare old normalized terms vs new query plans.
4. Enable in Vercel only after manual review.

## Open Questions

- Should the generated query plan be shown to users in settings?
- Should users choose between broad, frontier, and technical intents?
- Should the weekly email mention which group each paper matched?
- Should old user preferences be backfilled automatically or only when users update settings?

## Recommendation

Build this as a staged enhancement, not a one-shot rewrite.

The highest-value first milestone is:

```text
Generate and test MedicalQueryPlan for user subscription keywords, but do not yet change delivery behavior.
```

After we trust the plans, integrate them into matching and PubMed retrieval.

