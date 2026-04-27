# Step 6: PubMed Preference Retrieval Enhancement

Date: 2026-04-27

## Goal

Use the user's AI-normalized subscription preferences when searching PubMed, so Chinese terms,
English terms, typos, and journal abbreviations have a better chance of pulling relevant papers
into the local `papers` table.

This step is application-code only. It does not require database DDL or RPC changes.

## What Changed

### 1. PubMed search terms now prefer normalized preferences

`src/lib/pubmed-sync-queries.ts` now reads:

- `subscription_normalized_keywords` before raw `subscription_keywords`
- `subscription_normalized_journals` before raw `custom_journals`

Plain-language effect:

If a user enters `血管外科` and MiniMax normalizes it to `vascular surgery`, PubMed sync now uses
`vascular surgery` instead of trying to search PubMed with the Chinese raw input.

### 2. Compact matching-only terms are filtered out before PubMed search

The recommendation matcher intentionally keeps compact variants such as `vascularsurgery` for local
fuzzy matching. Those are not good PubMed queries.

The PubMed query layer now keeps the readable phrase and drops the compact duplicate.

Example:

- Keep: `vascular surgery`
- Drop for PubMed: `vascularsurgery`

### 3. User custom journals now feed PubMed sync

`runPubmedSyncJob()` now builds extra PubMed searches from user custom journals.

For a journal such as `EJVES`, the query searches both:

- journal title field: `[jour]`
- journal abbreviation field: `[ta]`

Plain-language effect:

If a user subscribes to `EJVES`, the sync job is more likely to fetch papers from
`European Journal of Vascular and Endovascular Surgery`.

### 4. Query builder borrowed PubMed skill patterns

The local `pubmed-search` and `pubmed-database` skill notes were used as references for:

- title/abstract search: `[tiab]`
- MeSH search: `[mh]`
- journal search: `[jour]`
- journal abbreviation search: `[ta]`

## Files Changed

- `src/lib/pubmed-sync-queries.ts`
- `src/lib/pubmed-sync.ts`
- `src/server/repositories/pubmed-sync.ts`
- `tests/pubmed-sync-queries.test.ts`

## Verification

Passed:

- `npm test`
- `npm run lint -- --max-warnings=0`
- `npm run build`
- `git diff --check`

## Remaining Limit

This improves whether relevant papers enter the local database. It does not rewrite the existing
Supabase RPC `get_personalized_feed`. If the home feed still behaves strangely after enough new
papers have been synced, the next follow-up should be to move that feed matching logic from the
database RPC into application code, or ask the DB owner to update the RPC to use normalized fields.
