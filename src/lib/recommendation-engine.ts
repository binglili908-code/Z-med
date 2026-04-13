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
  subscription_keywords: string[] | null;
  custom_journals: string[] | null;
};

function normalizeKeywords(values: string[] | null | undefined) {
  const set = new Set<string>();
  for (const raw of values ?? []) {
    const v = raw.trim().toLowerCase();
    if (v) set.add(v);
  }
  return Array.from(set);
}

function matchesKeyword(texts: string[], keywords: string[]) {
  if (!keywords.length) return true;
  const text = texts.join("\n").toLowerCase();
  return keywords.some((kw) => text.includes(kw));
}

export async function generateRecommendations(
  input: RecommendationInput,
): Promise<RecommendationOutput[]> {
  const supabase = createServiceSupabaseClient();
  const { user_id, batch_date } = input;

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_keywords,custom_journals")
    .eq("id", user_id)
    .maybeSingle();

  const profileKeywords = normalizeKeywords((profile as ProfileRow | null)?.subscription_keywords);
  const customJournals = normalizeKeywords((profile as ProfileRow | null)?.custom_journals);
  const journalTerms = new Set<string>();
  for (const item of customJournals) {
    journalTerms.add(item);
  }

  let query = supabase
    .from("papers")
    .select("id,title,abstract,abstract_zh,journal,quality_score,quality_tier,ai_analysis")
    .eq("is_ai_med", true);

  const { data: papers, error: paperErr } = await query
    .order("quality_score", { ascending: false });
  if (paperErr) {
    throw new Error(`Failed to load papers: ${paperErr.message}`);
  }

  let rows = papers ?? [];
  if (journalTerms.size) {
    rows = rows.filter((paper) => {
      const j = (paper.journal ?? "").trim().toLowerCase();
      if (!j) return false;
      for (const term of journalTerms) {
        if (j === term || j.includes(term) || term.includes(j)) return true;
      }
      return false;
    });
  }
  if (profileKeywords.length) {
    rows = rows.filter((paper) =>
      matchesKeyword(
        [
          paper.title ?? "",
          paper.abstract ?? "",
          paper.abstract_zh ?? "",
          paper.ai_analysis ? JSON.stringify(paper.ai_analysis) : "",
        ],
        profileKeywords,
      ),
    );
  }
  rows = rows.slice(0, 20);

  const outputs: RecommendationOutput[] = rows.map((paper) => ({
    paper_id: paper.id,
    source_type: "precision",
    recommendation_score: Number(paper.quality_score ?? 0),
    reason: "基于期刊订阅与关键词匹配推荐",
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
