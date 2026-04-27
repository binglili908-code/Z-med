# PubMed Query Assist

Date: 2026-04-27

## Goal

Improve subscription matching for user-entered biomedical terms without integrating the full
`pubmed-mcp-server-main` project into the production app.

This is an application-layer enhancement only. No database schema change is required.

## What It Does

When a user saves subscription preferences:

1. MiniMax still normalizes the raw user input first.
2. The new PubMed query assist layer then checks normalized keyword terms with NCBI:
   - PubMed ESpell for obvious spelling corrections.
   - MeSH lookup for official biomedical headings and entry terms.
3. The app stores the expanded terms in the existing normalized keyword field.

Example:

```text
panceratic cancer
-> pancreatic cancer
-> Pancreatic Neoplasms
-> Pancreatic Cancer
-> Cancer of the Pancreas
```

## Why Not Integrate the Full MCP Server

The downloaded MCP project is useful as a reference, but it is designed to expose tools to AI agents.
The production app does not need another server process for the first step.

Instead, the app borrows the two highest-value ideas:

- spell correction;
- MeSH vocabulary expansion.

This keeps the deployment simpler and avoids pulling full-text/PDF parsing dependencies into the main
Next.js runtime.

## Safety Behavior

The feature is fail-open:

- If NCBI is slow, rate-limited, or unavailable, subscription saving still succeeds.
- Errors are recorded under `normalizedTerms.pubmed_assist.errors`.
- Existing MiniMax and local alias expansion still work.

The feature can be disabled with:

```text
PUBMED_QUERY_ASSIST_ENABLED=false
```

## Main Files

- `src/lib/pubmed-query-assist.ts`
- `src/lib/subscription-preference-normalizer.ts`
- `tests/pubmed-query-assist.test.ts`

## Verification

- `npm test`
- `npm run lint -- --max-warnings=0`
- `npm run build`
