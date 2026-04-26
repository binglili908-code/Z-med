# Refactor Step 3: Data Access Boundary

## Goal

Move high-traffic Supabase reads/writes out of route handlers and UI-facing
services into server-side repositories. Route handlers should compose auth,
request parsing, and response shapes; repositories own table/RPC access and
database row mapping.

## Added Repositories

- `src/server/repositories/profiles.ts`
  - profile subscription status
  - user subscription read/write
  - dev-bypass profile lookup by email
  - contact-email lookup by profile id
- `src/server/repositories/papers.ts`
  - personalized feed RPC access
  - fallback feed query with exact total count
  - recent quality paper query for spotlight
  - paper interaction lookup
  - DB row to shared paper DTO mapping
- `src/server/repositories/ai-analysis.ts`
  - platform AI analysis queue enqueueing
  - runnable queue job loading
  - queue status transitions
  - translation field updates on `papers`
- `src/server/repositories/pubmed-sync.ts`
  - PubMed sync reads from `profiles`, `journal_quality`, `research_topics`,
    and `sync_state`
  - PubMed sync writes to `papers`, `paper_research_topics`,
    `journal_sync_log`, and `sync_state`
  - PubMed sync RPC calls for AI/medical scoring, journal weighting, and
    keyword query generation
- `src/server/repositories/weekly-spotlight-email.ts`
  - active recipient lookup from `profiles`
  - weekly spotlight delivery claim/read/update/delete operations
- `src/server/repositories/weekly-push.ts`
  - weekly candidate paper lookup from `papers`
  - weekly issue and issue-item writes
  - weekly push delivery history reads/writes
- `src/server/repositories/paper-translation.ts`
  - paper lookup for translation requests
  - translated title/abstract updates
  - BYOK translation usage logging
- `src/server/repositories/pdf-email.ts`
  - paper lookup for open-access PDF email requests
  - PDF email interaction logging
- `src/server/repositories/byok-settings.ts`
  - BYOK provider/model/key status lookup
  - BYOK settings save/upsert
- `src/server/repositories/reference-data.ts`
  - active journal quality list lookup
  - active research topic list lookup
- `src/server/repositories/dev-self-check.ts`
  - developer self-check profile lookup
  - open-access PDF paper count and sample lookup
- `src/server/repositories/recommendations.ts`
  - recommendation profile lookup
  - recommendation candidate paper lookup
  - feed recommendation upsert
- `src/server/repositories/easyscholar.ts`
  - EasyScholar sync cursor read/write
  - active journal batch lookup
  - EasyScholar result update on `journal_quality`
- `src/server/repositories/quality-recompute.ts`
  - quality recompute cursor read/write
  - active journal quality lookup
  - recompute paper batch lookup and paper quality updates

## Migrated Call Sites

- `src/app/api/papers/feed/route.ts`
- `src/lib/spotlight.ts`
- `src/app/api/user/subscription/route.ts`
- `src/app/settings/page.tsx` now imports the shared subscription DTO.
- `src/lib/ai-analysis.ts`
- `src/lib/pubmed-sync.ts`
- `src/lib/weekly-spotlight-email.ts`
- `src/lib/weekly-push.ts`
- `src/app/api/papers/[id]/translate/route.ts`
- `src/app/api/send-pdf/route.ts`
- `src/app/api/send-spotlight-email/route.ts`
- `src/app/api/user/ai-settings/route.ts`
- `src/app/api/journal-quality/route.ts`
- `src/app/api/research-topics/route.ts`
- `src/app/api/papers/search/route.ts`
- `src/app/api/papers/spotlight/route.ts`
- `src/app/api/dev/self-check/route.ts`
- `src/lib/recommendation-engine.ts`
- `src/lib/easyscholar.ts`
- `src/lib/quality-recompute.ts`

## Behavior Notes

- AI analysis completion now records `completed_at`.
- AI analysis failures now record `error_message`.
- Both fields already exist in the exported production schema.
- PubMed sync behavior is intended to remain the same; the change only moves
  table/RPC access into a repository so the long sync workflow is easier to
  read and change later.
- Weekly spotlight email behavior is intended to remain the same; the change
  only moves recipient and delivery-table access into a repository.
- Weekly push behavior is intended to remain the same; the change only moves
  issue, issue-item, profile, and delivery-table access into a repository.
- Paper translation behavior is intended to remain the same; the change only
  moves paper reads, translation updates, and BYOK usage logging into a
  repository.
- Manual PDF and spotlight email behavior is intended to remain the same; the
  change only moves profile, paper, and interaction-table access into
  repositories.
- Email subject/body copy for spotlight and weekly push emails was repaired
  from mojibake to readable Chinese text.
- BYOK settings behavior is intended to remain the same; the change only moves
  profile reads/writes into a repository. The connection-test prompt was also
  repaired from mojibake to readable Chinese text.
- Reference-data, search, spotlight, and developer self-check routes now call
  repositories instead of directly querying Supabase from route handlers.
- Recommendation generation now calls a repository for profile, paper, and
  `feed_recommendations` access. The recommendation reason text was repaired
  from mojibake to readable Chinese.
- EasyScholar sync and quality recompute behavior is intended to remain the
  same; their cursor, journal, and paper reads/writes now live in repositories.

## Boundary Rules

- Client components may import shared DTOs from `src/shared/contracts/*`.
- Client components should not import `src/server/*`.
- Server routes/services may import repositories.
- Repository functions may throw typed `Error` messages; routes convert them to
  API responses.
- Production DDL remains outside Codex and follows `docs/sql-change-workflow.md`.

## Next Candidates

- `src/app/api/send-pdf/route.ts`, `src/app/api/send-spotlight-email/route.ts`,
  and BYOK routes can now share a small auth helper in a later cleanup.
- `src/app/api` has no remaining direct Supabase `.from()` / `.rpc()` calls
  aside from non-database `Array.from` usage in search parsing.
- Remaining direct Supabase access is mostly in repositories and a few
  specialized long-running service modules.
