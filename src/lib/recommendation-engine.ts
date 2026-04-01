import { createServiceSupabaseClient } from "@/lib/supabase/service";

export interface RecommendationInput {
  user_id: string;
  batch_date: string;
}

export interface RecommendationOutput {
  paper_id: string;
  source_type: "precision" | "trending" | "serendipity";
  recommendation_score: number;
  reason: string;
}

type ProfileRow = {
  top_journals_only: boolean | null;
  subscription_min_score: number | string | null;
};

function toMinScore(value: ProfileRow["subscription_min_score"] | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function generateRecommendations(
  input: RecommendationInput,
): Promise<RecommendationOutput[]> {
  const supabase = createServiceSupabaseClient();
  const { user_id, batch_date } = input;

  const { data: profile } = await supabase
    .from("profiles")
    .select("top_journals_only,subscription_min_score")
    .eq("id", user_id)
    .maybeSingle();

  const topOnly = Boolean((profile as ProfileRow | null)?.top_journals_only);
  const minScore = toMinScore((profile as ProfileRow | null)?.subscription_min_score);

  const { data: subRows } = await supabase
    .from("user_topic_subscriptions")
    .select("topic_id")
    .eq("user_id", user_id);
  const topicIds = Array.from(new Set((subRows ?? []).map((row) => row.topic_id)));

  let paperIdFilter: string[] | null = null;
  if (topicIds.length) {
    const { data: relRows } = await supabase
      .from("paper_research_topics")
      .select("paper_id,topic_id")
      .in("topic_id", topicIds);
    paperIdFilter = Array.from(new Set((relRows ?? []).map((row) => row.paper_id)));
    if (!paperIdFilter.length) {
      return [];
    }
  }

  let query = supabase
    .from("papers")
    .select("id,quality_score")
    .eq("is_ai_med", true)
    .gte("quality_score", minScore);

  if (topOnly) {
    query = query.in("quality_tier", ["top", "core"]);
  }
  if (paperIdFilter) {
    query = query.in("id", paperIdFilter);
  }

  const { data: papers, error: paperErr } = await query
    .order("quality_score", { ascending: false })
    .limit(20);
  if (paperErr) {
    throw new Error(`Failed to load papers: ${paperErr.message}`);
  }

  const outputs: RecommendationOutput[] = (papers ?? []).map((paper) => ({
    paper_id: paper.id,
    source_type: "precision",
    recommendation_score: Number(paper.quality_score ?? 0),
    reason: "基于订阅偏好与质量分推荐",
  }));

  if (outputs.length) {
    const rows = outputs.map((row) => ({
      user_id,
      paper_id: row.paper_id,
      source_type: row.source_type,
      recommendation_score: row.recommendation_score,
      reason: row.reason,
      is_consumed: false,
      batch_date,
    }));
    const { error: upsertErr } = await supabase
      .from("feed_recommendations")
      .upsert(rows, { onConflict: "user_id,paper_id,batch_date" });
    if (upsertErr) {
      throw new Error(`Failed to upsert recommendations: ${upsertErr.message}`);
    }
  }

  return outputs;
}
