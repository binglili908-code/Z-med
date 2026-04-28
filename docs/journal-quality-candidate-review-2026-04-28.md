# Journal Quality Candidate Review - 2026-04-28

This file tracks the manual review before adding missing journals to `journal_quality`.
RPC output is treated as a clue only. The user-provided iikx page family is used as the confirmation source for the rows marked confirmed in `docs/journal-quality-candidates-2026-04-28.json`.

## Current State

- AI-med papers checked: 505
- Papers whose journal does not match active `journal_quality`: 23
- Unmatched journal names: 12
- EasyScholar local API key: not present in `.env.local` during this review
- iikx source family checked after the user provided `https://www.iikx.com/sci/medcine/12364.html`

## Write Flow

Dry-run first:

```bash
npx tsx src/scripts/upsert-confirmed-journal-quality.ts docs/journal-quality-candidates-2026-04-28.json
```

Apply only after reviewing dry-run output:

```bash
npx tsx src/scripts/upsert-confirmed-journal-quality.ts docs/journal-quality-candidates-2026-04-28.json --apply --yes-i-understand-this-writes-to-database
```

After main-table updates, refresh paper snapshots:

```bash
npx tsx src/scripts/fix-journal-quality-snapshots.ts
npx tsx src/scripts/fix-journal-quality-snapshots.ts --apply --yes-i-understand-this-writes-to-database
npx tsx src/scripts/audit-journal-quality.ts
```

## Confirmed Candidate Table

| Journal in papers | AI-med papers | Current paper IF | Confirmed IF | JCR | CAS | Planned tier | Note |
|---|---:|---:|---:|---|---|---|---|
| Scientific reports | 6 | 3.9 | 3.9 | Q1 | 3区 | core | Add main-table row. |
| Digital health | 3 | 24.1 | 3.3 | Q1 | 3区 | core | iikx confirms this is SAGE Digital Health, not The Lancet Digital Health. Correct stale paper IF. |
| European radiology | 2 | 4.7 | 4.7 | Q1 | 2区 | core | Add main-table row. |
| Journal of medical Internet research | 2 | 5.0 | 6.0 | Q1 | 2区 | core | Add main-table row and correct stale paper IF. |
| Communications medicine | 2 | 6.3 | 6.3 | Q1 | 2区 | core | Add main-table row. |
| JMIR medical informatics | 2 | 3.8 | 3.8 | Q2 | 3区 | core | Add main-table row. |
| Intensive care medicine experimental | 1 | 21.2 | 3.1 | Q2 | 3区 | core | Correct suspicious RPC-derived IF. |
| Critical care explorations | 1 | 9.3 | 2.7 | Q2 | null | emerging | Correct suspicious RPC-derived IF; database CAS constraint does not accept "not indexed", so store null. |
| Medical teacher | 1 | 4.4 | 4.4 | Q1 | 3区 | core | Add main-table row. |
| PLOS digital health | 1 | 3.3 | 7.7 | Q1 | null | core | Correct stale paper IF; database CAS constraint does not accept "not indexed", so store null. |
| Nature cancer | 1 | 28.5 | 28.5 | Q1 | 1区 | top | Add main-table row. |
| iScience | 1 | 4.1 | 4.1 | Q1 | 2区 | core | Add main-table row. |

## Existing Main-Table Gap

`Nature Cardiovascular Research` already exists in `journal_quality`, but `jcr_quartile` is missing.
iikx confirms IF 10.8/Q1 and CAS medical 1区, so the JSON marks it as a confirmed update that fills `jcr_quartile` while keeping the existing platform weight.
