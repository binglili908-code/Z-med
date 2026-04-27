# Checkpoint: Refactor Stabilization - 2026-04-27

## Status

This checkpoint closes the current architecture cleanup batch before the next
round of deeper workflow tests.

The project currently passes:

```bash
npm test
npm run lint -- --max-warnings=0
npm run build
```

The production build uses:

- `next@15.5.15`

## What Changed

Architecture and workflow cleanup:

- Cron routes now share common authorization and response handling.
- PubMed sync was split into smaller modules for:
  - PubMed client calls
  - query construction
  - summary loading
  - scoring/upsert logic
  - keyword-sync statistics
- Weekly push was split into smaller modules for:
  - article selection
  - email rendering
  - ISO-week date handling
- Shared email template helpers were added.
- Weekly push now exposes clearer counters for email failures and no-fresh-paper
  skips.

Product fixes:

- Resend sender configuration rejects the testing domain before sending.
- Spotlight and weekly-push emails fall back to English abstracts when Chinese
  abstracts are missing.
- Subscription matching handles common medical/journal acronyms and small
  acronym typos.
- MiniMax-backed subscription preference normalization was added with backward
  compatibility when optional database columns are absent.

Testing:

- `npm test` was added.
- 16 initial tests cover:
  - subscription matching
  - journal acronym matching
  - MiniMax-style JSON parsing
  - ISO-week date calculation
  - weekly-push article selection

Dependency security:

- Next.js was upgraded from `15.5.8` to `15.5.15`.
- Resend was upgraded from `6.9.4` to `6.12.2`.
- `resend -> svix` is overridden to `1.92.2`.
- Development-only audit issues were fixed with non-force `npm audit fix`.
- Residual audit output is documented in
  `docs/dependency-security-audit-20260427.md`.

## Database Scope

Codex did not execute production schema changes or modify Supabase RPCs.

Database/schema-related changes remain governed by the SQL Change Workflow:

- Codex may generate SQL proposals.
- Claude or the database owner applies production DDL/migrations.
- Application code should remain backward compatible when optional columns are
  not present.

## Current Residual Risk

- `npm audit --omit=dev` still reports 2 moderate advisories from
  `next -> postcss@8.4.31`.
- This is a Next upstream dependency declaration issue. The npm force fix would
  downgrade to `next@9.3.3`, which is not acceptable.
- Monitor future Next releases for a patch that upgrades internal PostCSS.

## Recommended Next Step

Add workflow-level tests around weekly push:

- already-delivered papers should not be resent
- email send failure increments `failedEmailUsers`
- explicit no-match preferences should not fall back to unrelated papers
- matched papers that were all previously delivered should increment
  `skippedNoFreshPapersUsers`
