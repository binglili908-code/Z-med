# Refactor Step 5: Regression Tests

## Goal

Add a small test safety net around the highest-risk pure business rules before
continuing deeper refactors. These tests do not connect to Supabase, call
MiniMax, send emails, or touch production data.

## Test Runner

Added:

- `tsx` as a development dependency
- `npm test`

The test command uses Node's built-in test runner with `tsx`:

```bash
npm test
```

This keeps the setup lightweight while allowing tests to import the existing
TypeScript modules directly.

## Initial Test Coverage

Added:

- `tests/subscription-matching.test.ts`
- `tests/model-json.test.ts`
- `tests/iso-week.test.ts`
- `tests/weekly-push-selection.test.ts`

Covered behaviors:

- `EJVES`, `LLM`, and `ICU` style user inputs expand into useful matching terms.
- Journal acronym matching tolerates a small typo such as `EJVSE`.
- Search text matching works across normalized English terms.
- MiniMax-style JSON can be parsed when wrapped in markdown fences or surrounded
  by short explanatory text.
- Invalid model JSON raises a labeled error.
- Weekly issue dates normalize to ISO week Monday.
- Weekly push candidates sort by quality/date.
- Weekly push selection avoids taking too many papers from the same journal
  before diversifying.
- Weekly push personalization can match normalized journal acronyms.
- Explicit user preferences with no matching papers return an empty pool instead
  of silently falling back to unrelated papers.

## Why This Matters

The previous refactor split large workflow files into smaller modules. The most
important risk after that kind of change is not syntax breakage; `lint` and
`build` already catch that. The harder risk is accidentally changing business
meaning later, especially around:

- subscription keyword matching
- journal acronym handling
- MiniMax JSON parsing
- weekly push article selection
- weekly issue date calculation

These tests are intentionally small and fast so they can run before every deploy.

## Verification

Current checks:

```bash
npm test
npm run lint -- --max-warnings=0
npm run build
```

## Remaining Test Targets

- Add tests for weekly-push counters around send failure and already-delivered
  papers.
- Add tests for `buildSpotlightPapers` once its data loading can be mocked
  cleanly.
- Add tests for subscription save normalization fallback when MiniMax is missing
  or returns invalid JSON.
