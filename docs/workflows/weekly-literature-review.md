# Weekly Literature Review Workflow

Use this workflow when the user asks Codex to update, review, screen, or prepare the weekly literature push pool.

## Commands

Generate a compact review packet without changing remote data:

```bash
npm run literature:review
```

Run the weekly refresh pipeline, then generate the same packet:

```bash
npm run literature:refresh -- --enrichment-batches=1 --recommendation-limit=50 --review-limit=20
```

Use JSON if the next step needs programmatic parsing:

```bash
npm run literature:review -- --json
```

## Review Rules

1. Read only the generated review packet first.
2. Treat `Would Promote After Review` as candidates for human/Codex editorial review, not automatic insertion.
3. Treat `Verified But Held` as tuning material for scoring or review-like rules.
4. Treat `Pending PubMed Not Found` as external-only candidates; do not promote them.
5. Treat `Rejected Review-Like Sample` as quality-control samples.
6. Do not scan all users or all papers in context. Ask for targeted follow-up queries when needed.
7. Do not write to `papers`, push tables, or user-facing recommendation pools without explicit user approval.

## Intended Division Of Labor

The backend does broad retrieval, dedupe, enrichment, first-pass scoring, and report compression.

Codex reviews the compressed packet, explains why candidates should or should not be promoted, and suggests threshold/rule adjustments.
