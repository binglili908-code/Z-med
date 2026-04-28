# Journal quality / RPC audit proposal

Date: 2026-04-28

This note is for Claude / the DB owner. Codex did not change schema, RPCs, functions, or DDL.

## Why this exists

The application now treats `journal_quality` as the preferred journal-quality master data source in code. However, the database RPC `get_journal_tier_and_weight` still returns journal quality information for journals that are not present in `journal_quality`, and in a few cases appears to return suspicious values.

This creates split-brain behavior:

- Some ingestion paths use `journal_quality`.
- Older keyword sync logic used `get_journal_tier_and_weight`.
- `quality-recompute` uses `journal_quality`.
- Existing `papers` rows can therefore contain IF/tier values that do not match the current master table.

## DB owner checks requested

Please inspect the implementation and source data behind:

```sql
public.get_journal_tier_and_weight(p_journal text)
```

Pay special attention to these probe results observed on 2026-04-28:

| Probe journal | RPC tier | RPC IF | RPC JCR | RPC CAS | Concern |
| --- | --- | ---: | --- | --- | --- |
| The Lancet. Oncology | top | 88.5 | Q1 | 1 区 | Conflicts with `journal_quality` where The Lancet Oncology is IF 35.9 |
| Digital health | top | 24.1 | Q1 | 1 区 | May be confused with The Lancet Digital Health |
| Nature cancer | top | 28.5 | Q1 | 1 区 | RPC knows it, but `journal_quality` does not |
| Scientific reports | core | 3.9 | Q1 | empty | RPC knows it, but `journal_quality` does not |
| Journal of medical Internet research | core | 5 | Q1 | 1 区 | RPC knows it, but `journal_quality` does not |
| European radiology | core | 4.7 | Q1 | 2 区 | RPC knows it, but `journal_quality` does not |
| Communications medicine | core | 6.3 | Q1 | 2 区 | RPC knows it, but `journal_quality` does not |
| PLOS digital health | core | 3.3 | Q1 | 3 区 | RPC knows it, but `journal_quality` does not |

## Suggested DB-side direction

1. Decide whether `journal_quality` should fully replace the RPC's internal journal list.
2. If yes, rewrite or deprecate `get_journal_tier_and_weight` so it reads from `journal_quality` only.
3. If the RPC has a broader curated list, migrate those rows into `journal_quality` with explicit aliases and EasyScholar sync metadata.
4. Correct suspected ambiguous mappings:
   - Do not let plain `Digital health` resolve to `The Lancet Digital Health`.
   - Do not let `The Lancet. Oncology` resolve to IF 88.5 unless that value is intentionally documented.
5. Consider adding canonical-name support in the DB layer, but Codex recommends doing that through a reviewed migration/proposal instead of ad hoc SQL.

## Current app-side guardrail

Codex changed `runKeywordSyncJob` to use `journal_quality` as the source for tier, IF, JCR, CAS, and weight. This prevents obviously suspicious RPC values from being written into new `papers` rows by that path.

The read-only audit script is:

```bash
npx tsx src/scripts/audit-journal-quality.ts
```

It does not update rows. It reports:

- active `journal_quality` missing metrics,
- normalized duplicate keys,
- AI-med papers unmatched to `journal_quality`,
- existing paper snapshots inconsistent with `journal_quality`,
- RPC output for unmatched journals.
