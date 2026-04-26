# Supabase Schema/RPC Handoff

Generated at: 2026-04-26T02:16:43.453Z

## Safety Boundary

- Codex performed read-only catalog queries inside `BEGIN READ ONLY`.
- Codex did not run DDL against the remote database.
- Treat the SQL export as a review artifact. Claude/DB owner should decide how to split it into real migrations.

## Files

- SQL export: `sql/exports/20260426T021646Z_remote_public_schema.sql`

## Export Summary

- Public tables: 23
- Public functions/RPCs: 19
- RLS policies: 33
- Non-constraint indexes: 51
- Triggers: 6

## Application RPC Coverage

- [x] `get_personalized_feed`
- [x] `calculate_ai_med_score`
- [x] `get_journal_tier_and_weight`
- [x] `get_or_flag_keyword`
- [x] `build_pubmed_query_for_keyword`
- [x] `save_llm_synonyms`

All application RPCs listed in the review findings were found in the remote public schema export.

## Request For Claude/DB Owner

1. Review the SQL export and confirm it matches the intended production database contract.
2. Convert the accepted parts into ordered, idempotent Supabase migrations.
3. Keep production DDL ownership outside Codex unless explicitly approved.
4. Pay special attention to the RPCs used by app code and the `feed_recommendations` upsert constraint.
