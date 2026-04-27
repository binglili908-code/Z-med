# Weekly Push Email Fix

Date: 2026-04-27

## What Happened

The Monday automatic email comes from `/api/cron/weekly-push`, not from the homepage daily
spotlight email.

The old weekly push behavior could send fewer papers because it:

- looked only at the previous week's papers;
- kept only high-quality AI+medical candidates;
- filtered those candidates by each user's subscription preferences;
- removed papers that had already been sent to that user before;
- capped the final personalized list at 5 papers.

That combination made it possible for one user to receive 1 paper and another user to receive
5 papers.

The email body also used a simpler legacy template, so it showed only title, journal, date, score,
and PubMed link.

## Application Fix

- Default weekly push target changed to 7 papers. It can be overridden with
  `WEEKLY_PUSH_TARGET_COUNT`.
- Weekly push now selects strict journal+keyword matches first.
- If strict matches are not enough and the user has both journal and keyword preferences, it fills
  the remaining slots with topic fallback papers.
- Topic fallback papers must match the user's keyword/topic. Journal-only papers are not used to
  fill the list.
- Weekly push email now uses a richer card template with:
  - Chinese and English title when available;
  - Chinese summary when available;
  - English abstract when Chinese summary is missing;
  - clear `precision` vs `topic fallback` labels;
  - no raw score line in the user-facing email.

## Database Impact

No schema change is required.

The existing `user_weekly_push_deliveries` table continues to prevent repeated papers from being
sent to the same user.

## Verification

- `npm test`
- `npm run lint -- --max-warnings=0`
- `npm run build`
