-- =============================================================================
-- Migration: create_user_weekly_push_deliveries
-- Applied to production: 2026-04-26
-- DB owner: Claude
--
-- Purpose:
--   Persistence for the weekly-push delivery flow. Tracks which user has been
--   sent which paper in which issue, so the cron job can avoid resending the
--   same paper to the same user across weeks.
--
-- Relationship to other tables:
--   - user_weekly_spotlight_deliveries: per-user-per-week email send status
--     (one row per user per week)
--   - user_weekly_push_deliveries (this table): per-user-per-paper delivery
--     history (one row per paper per user, ever)
--   The two tables serve different business flows and should not be merged.
--
-- Differences from sql/p3_weekly_push_no_repeat.sql draft:
--   - Removed `created_at` column: redundant with `delivered_at`.
--   - Index on (user_id, issue_week_start DESC) instead of (user_id, created_at):
--     business queries align by issue week, not by insert time.
--   - RLS allows own-row select only; admin-readable policy deferred until
--     admin tooling exists.
-- =============================================================================

CREATE TABLE public.user_weekly_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.push_issues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paper_id uuid NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
  issue_week_start date NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),

  -- Same paper to same user in the same issue cannot be inserted twice
  -- (protects retry scenarios within a single cron run).
  CONSTRAINT user_weekly_push_deliveries_issue_user_paper_key
    UNIQUE (issue_id, user_id, paper_id),

  -- Same paper to same user across all issues cannot be inserted twice.
  -- This is the core no-repeat guarantee for the weekly-push flow.
  CONSTRAINT user_weekly_push_deliveries_user_paper_key
    UNIQUE (user_id, paper_id)
);

-- Lookup: a user's recent delivery history, ordered by issue week.
CREATE INDEX user_weekly_push_deliveries_user_idx
  ON public.user_weekly_push_deliveries (user_id, issue_week_start DESC);

-- Lookup: all deliveries within an issue (for ops reports).
CREATE INDEX user_weekly_push_deliveries_issue_idx
  ON public.user_weekly_push_deliveries (issue_id);

-- Enable Row Level Security.
ALTER TABLE public.user_weekly_push_deliveries ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own delivery records.
-- Cron writes via service_role, which bypasses RLS.
-- No INSERT/UPDATE/DELETE policies for non-service roles.
CREATE POLICY user_weekly_push_deliveries_select_own
  ON public.user_weekly_push_deliveries
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.user_weekly_push_deliveries IS
  'Weekly-push flow delivery history. Per-user-per-paper grain. Distinct from user_weekly_spotlight_deliveries which is per-user-per-week.';

COMMENT ON CONSTRAINT user_weekly_push_deliveries_user_paper_key ON public.user_weekly_push_deliveries IS
  'Core guarantee: a paper is delivered to a user at most once across all issues.';
