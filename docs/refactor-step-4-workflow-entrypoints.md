# Refactor Step 4: Workflow Entrypoints

## Goal

Review the long-running application workflows after the data-access boundary
was introduced. The first target is the cron/API entry layer: these routes
should only authorize the request, parse shallow options, call the workflow, and
return a predictable JSON envelope.

## Change Made

Added:

- `src/server/cron/run-cron-route.ts`
- `src/server/cron/parse-cron-params.ts`

This helper centralizes the common cron route shell:

- authorize with `authorizeCronRequest`
- return the authorization failure response as-is
- call the workflow handler
- return `{ ok: true, actor, devBypassAuth, ...result }`
- return `{ ok: false, error }` with status 500 on workflow errors

For the legacy keyword route, the helper can preserve the existing
`success: true/false` response key.

The parameter helper currently normalizes integer cron query params such as
`batchSize`, clamps them to the workflow's supported range, and returns a clean
400 error for invalid values instead of passing `NaN` into the job.

## Migrated Cron Routes

- `src/app/api/cron/ai-analysis/route.ts`
- `src/app/api/cron/easyscholar-sync/route.ts`
- `src/app/api/cron/journal-sync/route.ts`
- `src/app/api/cron/keyword-sync/route.ts`
- `src/app/api/cron/pubmed-backfill/route.ts`
- `src/app/api/cron/pubmed-sync/route.ts`
- `src/app/api/cron/quality-recompute/route.ts`
- `src/app/api/cron/weekly-push/route.ts`
- `src/app/api/cron/weekly-spotlight-email/route.ts`

## PubMed Workflow Split

Added:

- `src/lib/pubmed-sync-client.ts`
- `src/lib/pubmed-keyword-expansion.ts`
- `src/lib/pubmed-keyword-sync-stats.ts`
- `src/lib/pubmed-sync-rules.ts`
- `src/lib/pubmed-paper-scoring.ts`

This module now owns the external PubMed/Unpaywall client details:

- PubMed `esearch`
- paged PubMed `esearch`
- PubMed `esummary`
- PubMed `efetch` abstract enrichment
- Unpaywall DOI lookup
- small helpers for chunking, de-duplicating PubMed IDs, and rate-limit delays

`src/lib/pubmed-sync.ts` now keeps more of the workflow-level logic:

- building sync queries
- scoring candidate papers
- assigning research topics
- coordinating normal sync, backfill, journal sync, and keyword sync jobs

The MiniMax-backed keyword expansion helper also moved out of
`src/lib/pubmed-sync.ts`. `src/lib/pubmed-keyword-expansion.ts` now owns:

- normalizing the `build_pubmed_query_for_keyword` RPC response shape
- calling MiniMax for keyword synonyms when the keyword has not been cached
- parsing JSON returned by the model

The paper scoring/upsert path also moved out of `src/lib/pubmed-sync.ts`.
`src/lib/pubmed-paper-scoring.ts` now owns:

- local AI/medical signal extraction for stored paper keywords
- research topic rule matching
- dynamic quality signal construction for regular PubMed sync/backfill paths
- open-access DOI lookup during scored paper creation
- `papers` upsert and `paper_research_topics` association writes through the
  existing repository boundary

Shared rule vocabulary now lives in `src/lib/pubmed-sync-rules.ts` so the query
builder and scoring path use the same AI/medical/topic term lists.

Keyword-sync aggregation now lives in `src/lib/pubmed-keyword-sync-stats.ts`.
That file owns the in-memory bookkeeping for:

- PubMed IDs discovered per keyword
- matched keywords per PMID
- per-keyword found/estimated/new/passed/dropped counts
- per-keyword sync windows

This is a low-risk split: behavior should remain the same, but the largest
workflow file no longer also owns HTTP parsing for PubMed XML/JSON or MiniMax
keyword expansion calls, and regular sync scoring is no longer embedded in the
cron orchestration file. Keyword-sync statistics are now isolated from the
workflow body as well.

## Email Sending Configuration

Added:

- `src/lib/resend-email.ts`

This helper centralizes Resend configuration and sending:

- reads `RESEND_API_KEY`
- reads `RESEND_FROM_EMAIL`
- rejects Resend's testing sender domain before sending
- converts Resend API errors into thrown workflow errors
- creates a reusable sender for batch jobs such as weekly push

Migrated:

- `src/lib/spotlight-email.ts`
- `src/lib/weekly-push.ts`
- `src/app/api/send-pdf/route.ts`
- `src/app/api/dev/self-check/route.ts`

The immediate production fix is that local `RESEND_FROM_EMAIL` now points to
the verified project domain sender:

- `Z-Lab <noreply@zlab-med.com>`

The same value must also be set in Vercel/production environment variables.
Otherwise deployed routes will keep using the old sender even if local
development works.

## External Service Request Guardrails

Added:

- `src/lib/external-fetch.ts`

This helper gives server-side external HTTP calls a consistent request shell:

- timeout handling
- optional retry for safe read-only requests
- clearer labels in timeout/error messages
- a `tryFetchWithRetry` variant for workflows where "skip this source and keep
  going" is safer than crashing the whole job

Migrated:

- `src/lib/minimax.ts`
- `src/lib/llm-client.ts`
- `src/lib/pubmed-sync-client.ts`
- `src/lib/pubmed.ts`
- `src/lib/pubmed-keyword-expansion.ts`

Policy:

- PubMed and Unpaywall GET requests now have short retries and timeouts.
- MiniMax and BYOK LLM POST requests have timeouts but no automatic retry, to
  avoid accidental duplicate paid generations.
- EasyScholar already had its own timeout/retry/rate-limit logic, so it was
  left in place for now.

## Spotlight Personalization Fix

Updated:

- `src/lib/supabase/browser.ts`
- `src/components/home/daily-paper-module.tsx`
- `src/lib/spotlight.ts`
- `src/server/repositories/papers.ts`
- `src/app/api/send-spotlight-email/route.ts`

The browser Supabase client now accepts either of these public client keys:

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

This matters because the homepage needs a browser session token before the API
can know which user's subscription keywords to use. If the browser client only
looks for the legacy anon key while production only has the newer publishable
key, the homepage falls back to the anonymous/global spotlight list.

The seven-paper spotlight builder also now ranks from the recent quality-paper
pool in application code and includes `journal`, `keywords`, and `mesh_terms`
in keyword matching. This keeps the seven-paper email personalized without
requiring a database function change.

## Behavior Notes

- The response shapes are intended to remain compatible with existing callers.
- `keyword-sync` still returns `success` instead of `ok`.
- `weekly-push`, `weekly-spotlight-email`, and `pubmed-sync` now use the same
  cron authorization path as the other scheduled jobs.
- This means scheduled production calls using `CRON_SECRET`, developer email
  calls, and local dev-bypass calls are handled consistently.
- `easyscholar-sync` and `quality-recompute` now reject invalid `batchSize`
  values before they reach workflow code.
- PubMed/Unpaywall external API calls moved out of `pubmed-sync.ts` and into
  `pubmed-sync-client.ts`; no database behavior changed.
- MiniMax keyword expansion moved out of `pubmed-sync.ts` and into
  `pubmed-keyword-expansion.ts`; no prompt or model behavior changed.
- Regular PubMed sync/backfill paper scoring moved into
  `pubmed-paper-scoring.ts`; database access still goes through the existing
  `src/server/repositories/pubmed-sync.ts` functions.
- Keyword-sync statistics moved into `pubmed-keyword-sync-stats.ts`; response
  fields are intended to stay the same.
- Daily spotlight email, weekly push email, and PDF-link email now share the
  same Resend configuration path.
- Resend's testing domain is now treated as not production-ready. This turns
  the previous external 403 into an earlier, clearer configuration error.
- PubMed, Unpaywall, MiniMax, and BYOK LLM calls now have bounded wait time.
  This reduces the chance that one slow outside service holds an entire cron or
  API request open indefinitely.
- Homepage and spotlight-email personalization now work when the project uses
  Supabase's newer publishable key env var instead of the legacy anon key env
  var.
- The seven-paper spotlight email no longer depends on the hidden
  `get_personalized_feed` RPC to decide which papers are personalized.
- No database schema or RPC changes were made.

## Why This Matters

Before this step, every cron route carried its own small copy of:

- auth handling
- try/catch
- success response shape
- failure response shape

That makes future cron changes easy to drift. For example, one route may accept
`CRON_SECRET` while another route only accepts the developer panel token. The
new wrapper makes the boundary explicit and keeps route files focused on the
business workflow they trigger.

## Remaining Workflow Review Targets

- Separate the largest workflow files into smaller internal units:
  - `src/lib/pubmed-sync.ts`
  - `src/lib/weekly-push.ts`
  - `src/lib/weekly-spotlight-email.ts`
- Review user-facing error messages around failed external services.
