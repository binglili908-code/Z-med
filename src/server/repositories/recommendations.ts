import type { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isMissingColumnError } from "@/server/repositories/schema-compat";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type RecommendationProfileRow = {
  is_active: boolean | null;
  subscription_keywords: string[] | null;
  custom_journals: string[] | null;
  subscription_normalized_keywords?: string[] | null;
  subscription_normalized_journals?: string[] | null;
};

export type RecommendationCandidatePaperRow = {
  id: string;
  title: string | null;
  abstract: string | null;
  abstract_zh: string | null;
  journal: string | null;
  quality_score: number | null;
  quality_tier: string | null;
  ai_analysis: Record<string, unknown> | null;
};

export type FeedRecommendationUpsertRow = {
  user_id: string;
  paper_id: string;
  source_type: "precision" | "trending" | "serendipity";
  recommendation_score: number;
  reason: string;
  is_consumed: boolean;
  batch_date: string;
};

const RECOMMENDATION_PROFILE_SELECT =
  "is_active,subscription_keywords,custom_journals";
const RECOMMENDATION_PROFILE_NORMALIZED_SELECT =
  "is_active,subscription_keywords,custom_journals,subscription_normalized_keywords,subscription_normalized_journals";

export async function getRecommendationProfile(
  client: SupabaseDbClient,
  userId: string,
) {
  const normalizedQuery = await client
    .from("profiles")
    .select(RECOMMENDATION_PROFILE_NORMALIZED_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (normalizedQuery.error && isMissingColumnError(normalizedQuery.error)) {
    const legacyQuery = await client
      .from("profiles")
      .select(RECOMMENDATION_PROFILE_SELECT)
      .eq("id", userId)
      .maybeSingle();
    if (legacyQuery.error) {
      throw new Error(`Failed to load recommendation profile: ${legacyQuery.error.message}`);
    }
    return (legacyQuery.data as RecommendationProfileRow | null) ?? null;
  }

  if (normalizedQuery.error) {
    throw new Error(`Failed to load recommendation profile: ${normalizedQuery.error.message}`);
  }

  return (normalizedQuery.data as RecommendationProfileRow | null) ?? null;
}

export async function listRecommendationCandidatePapers(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("papers")
    .select("id,title,abstract,abstract_zh,journal,quality_score,quality_tier,ai_analysis")
    .eq("is_ai_med", true)
    .order("quality_score", { ascending: false });
  if (error) {
    throw new Error(`Failed to load papers: ${error.message}`);
  }

  return (data ?? []) as RecommendationCandidatePaperRow[];
}

export async function upsertFeedRecommendations(
  client: SupabaseDbClient,
  rows: FeedRecommendationUpsertRow[],
) {
  if (!rows.length) return;

  const { error } = await client
    .from("feed_recommendations")
    .upsert(rows, { onConflict: "user_id,paper_id,batch_date" });
  if (error) {
    throw new Error(`Failed to upsert recommendations: ${error.message}`);
  }
}
