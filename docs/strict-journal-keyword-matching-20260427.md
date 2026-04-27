# Strict Journal + Keyword Matching

Date: 2026-04-27

## Problem

For a query such as `nature` plus the Chinese term for pancreatic cancer, the old matching behavior
was too loose:

- Nature-family journal papers could appear even if they were about other diseases.
- Pancreatic cancer papers could appear even if they were not in Nature-family journals.

That was caused by OR-style matching: journal match OR keyword match.

## Decision

When a user provides both a journal preference and a keyword/topic preference, matching must use AND:

```text
journal group must match
AND
keyword/topic group must match
```

If no papers satisfy both groups, the product should be honest first: say no exact match was found.
When there are strong topic matches, it may then show those as fallback recommendations, clearly labeled
as topic-related rather than exact journal+keyword matches.

## Changes

- Personalized app feed now requires both preference groups when both are present.
- Personalized app feed falls back to keyword/topic-matched papers only after exact matches are empty.
- Spotlight homepage selection now uses the same strict rule for subscribed users.
- Spotlight homepage shows the same fallback explanation before topic-related fallback papers.
- Literature search now treats separate query groups as AND conditions.
- The Chinese term for pancreatic cancer expands to English aliases such as:
  - `pancreatic cancer`
  - `pancreatic ductal adenocarcinoma`
  - `pancreatic neoplasms`
- Homepage shows an explicit empty exact-match message when a subscribed user has no exact matches.
- Topic fallback rejects journal-only matches, so `Nature` papers about unrelated diseases are not used
  just to fill the list.

## Verification

Added tests for:

- `nature` plus pancreatic cancer should reject Nature papers about other diseases.
- `nature` plus pancreatic cancer should reject pancreatic cancer papers from non-Nature journals.
- `nature` plus pancreatic cancer should keep papers satisfying both groups.
- Topic fallback should keep pancreatic-cancer papers when no exact Nature-family match exists.
- Topic fallback should still reject Nature-family papers about unrelated diseases.

Commands passed:

- `npm test`
- `npm run lint -- --max-warnings=0`
- `npm run build`
