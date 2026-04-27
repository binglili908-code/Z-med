# Step 7: Application-Layer Personalized Feed Plan

Date: 2026-04-27

Implementation status:

- Phase 1 completed: pure ranking module and tests.
- Phase 2 completed: application feed service and candidate loader.
- Phase 3 completed: `PERSONALIZED_FEED_MODE=compare` support.
- Default behavior remains `rpc`, so deploying this code does not immediately change the homepage.

## Plain-Language Goal

Move the homepage personalized feed logic out of the hidden Supabase RPC and into normal TypeScript
code.

In simple terms:

- Database: store papers and user preferences.
- Application code: decide which papers match the user, how to score them, and how to paginate them.

This makes the recommendation logic easier to read, test, debug, and change.

## Why This Is Needed

The current `/api/papers/feed` route calls the Supabase RPC `get_personalized_feed`.

The exported RPC currently reads:

- `profiles.subscription_keywords`
- `profiles.custom_journals`

It does not use the newer normalized fields:

- `profiles.subscription_normalized_keywords`
- `profiles.subscription_normalized_journals`

So even though the app now normalizes Chinese disease/topic names, English terms, typos,
and journal abbreviations such as `EJVES`, the homepage feed can still behave like it only
understands the old raw input.

## Target Architecture

Current flow:

```text
Browser
  -> /api/papers/feed
    -> Supabase RPC get_personalized_feed
      -> raw keywords / raw journals
      -> returns papers
```

Target flow:

```text
Browser
  -> /api/papers/feed
    -> load profile subscription status
    -> load recent quality candidate papers
    -> match with normalized keywords and normalized journals
    -> rank in TypeScript
    -> paginate and return
```

The RPC can stay available as a temporary fallback, but it should no longer be the main owner of
recommendation behavior.

## Proposed Files

### 1. Pure Ranking Module

Create:

`src/lib/personalized-feed-ranking.ts`

Responsibilities:

- Expand normalized keywords and journals.
- Check whether a paper matches the user's interests.
- Score each paper.
- Sort and paginate results.
- Generate a short recommendation reason.

This file should be mostly pure functions, so it can be tested without Supabase.

Suggested functions:

```ts
type FeedProfileTerms = {
  keywords: string[];
  journals: string[];
};

type RankedFeedPaper = DbPaper & {
  final_score: number;
  source_type: "precision" | "trending" | "serendipity";
  recommendation_reason: string;
};

export function buildFeedProfileTerms(status: ProfileSubscriptionStatus): FeedProfileTerms;
export function scorePaperForProfile(
  paper: DbPaper,
  terms: FeedProfileTerms,
): RankedFeedPaper | null;
export function rankPersonalizedFeedPapers(
  papers: DbPaper[],
  terms: FeedProfileTerms,
): RankedFeedPaper[];
export function paginateRankedFeed(
  papers: RankedFeedPaper[],
  page: number,
  pageSize: number,
): PersonalizedFeedResult;
```

### 2. Repository Candidate Loader

Add a repository function in:

`src/server/repositories/papers.ts`

Suggested function:

```ts
export async function listPersonalizedFeedCandidatePapers(
  client: SupabaseDbClient,
  params: { cutoffDate: string; limit: number },
): Promise<DbPaper[]>;
```

Initial query can stay simple:

- `papers.is_ai_med = true`
- `papers.quality_tier in ('top', 'core')`
- `papers.publication_date >= last 30 days`
- order by `quality_score`, `ai_med_score`, `publication_date`
- limit around `300` to `500`

Plain-language reason:

We first pull a manageable pile of good recent papers, then let TypeScript decide which are most
relevant to the user.

### 3. Application Feed Service

Create:

`src/lib/personalized-feed.ts`

Responsibilities:

- Load profile subscription status.
- Load candidate papers.
- Call the ranking module.
- Return `PersonalizedFeedResult`.

Suggested function:

```ts
export async function getPersonalizedFeedInApp(args: {
  userId: string;
  page: number;
  pageSize: number;
}): Promise<PersonalizedFeedResult>;
```

### 4. Route Switch

Update:

`src/app/api/papers/feed/route.ts`

Use an environment switch during rollout:

```text
PERSONALIZED_FEED_MODE=rpc | app | compare
```

Mode behavior:

- `rpc`: current behavior.
- `app`: new TypeScript behavior.
- `compare`: return RPC result to the user, but also compute app result and log differences.

Recommended rollout:

- Default now: `rpc`
- Test mode: `compare`
- Final production mode: `app`

## Ranking Rules

Start simple and explainable.

Suggested scoring:

```text
final_score =
  quality_score
  + keyword match bonus
  + journal match bonus
  + mesh/keyword metadata bonus
  + AI analysis match bonus
  + recency bonus
```

Suggested first version:

- Base quality score: existing `paper.quality_score`
- Journal match: `+25`
- Title match: `+25`
- Abstract match: `+15`
- MeSH/keywords match: `+12`
- AI analysis match: `+8`
- Published within 7 days: `+10`
- Published within 14 days: `+5`

Important rule:

If the user has explicit preferences and a paper matches neither keyword nor journal, do not include
it in the personalized result.

If no personalized papers match, return an empty personalized result and let the route decide whether
to show fallback content.

## Tests To Add

Create:

`tests/personalized-feed-ranking.test.ts`

Cover these cases:

1. Chinese preference normalized to English matches English paper text.
   - Raw user idea: Chinese term for sepsis
   - Normalized term: `sepsis`

2. Journal abbreviation matches full journal name.
   - User input: `EJVES`
   - Paper journal: `European Journal of Vascular and Endovascular Surgery`

3. Medical imaging large model preference matches title/abstract.
   - Terms: `medical imaging`, `large language model`, `foundation model`

4. No-match user should not receive unrelated precision papers.

5. Pagination total is stable.
   - `total` should mean all matched papers, not just current page count.

6. Ranking is explainable.
   - A paper matching journal plus keyword should rank above a paper matching keyword only.

## Rollout Plan

### Phase 1: Pure Ranking Only

Implement `personalized-feed-ranking.ts` and tests.

No route changes yet.

Risk level: low.

### Phase 2: App Feed Service Behind Flag

Implement `getPersonalizedFeedInApp()`.

Keep the existing RPC as default.

Risk level: low to medium.

### Phase 3: Compare Mode

Add `PERSONALIZED_FEED_MODE=compare`.

The user still sees RPC results, but Vercel logs compare:

- RPC paper IDs
- app paper IDs
- overlap count
- app-only matches
- rpc-only matches
- normalized keywords/journals used

Risk level: low.

### Phase 4: Switch Default To App

After compare logs look reasonable, set:

```text
PERSONALIZED_FEED_MODE=app
```

Keep RPC fallback for one release cycle.

Risk level: medium but reversible.

### Phase 5: Deprecate RPC Ownership

Do not delete the RPC immediately.

First mark it as legacy in docs. Later, after enough production confidence, either:

- keep it only as a fallback, or
- ask the DB owner to simplify or remove it.

## Acceptance Criteria

This step is complete when:

- The homepage feed can run without `get_personalized_feed`.
- Tests cover Chinese-to-English normalized interests.
- Tests cover journal abbreviations such as `EJVES`.
- `total` is stable and means the number of matched papers.
- Production can switch between `rpc`, `compare`, and `app` without code changes.
- No database schema change is required.

Current verification:

- `npm test`
- `npm run lint -- --max-warnings=0`
- `npm run build`

## Claude / DB Owner Involvement

No database migration is required for the first implementation.

Claude only needs to be involved later if:

- performance becomes slow and we need new indexes, or
- the old RPC should be formally changed or deprecated.

For now, this is an application-layer refactor.

## Main Risk

The main risk is fetching too many papers into application memory.

Mitigation:

- Start with a candidate limit of `300` to `500`.
- Keep a hard 30-day cutoff.
- Keep only `top` and `core` papers in the first version.
- Add logs for candidate count and matched count.

If traffic grows, we can later add database-side lightweight filters or indexes without moving the
business logic back into a hidden RPC.
