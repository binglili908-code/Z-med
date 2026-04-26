import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  getRecommendationProfile,
  listRecommendationCandidatePapers,
  upsertFeedRecommendations,
  type RecommendationCandidatePaperRow,
} from "@/server/repositories/recommendations";

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

function normalizeKeywords(values: string[] | null | undefined) {
  const set = new Set<string>();
  for (const raw of values ?? []) {
    const value = raw.trim().toLowerCase();
    if (value) set.add(value);
  }
  return Array.from(set);
}

function matchesKeyword(texts: string[], keywords: string[]) {
  if (!keywords.length) return true;
  const text = texts.join("\n").toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

function filterByJournalTerms(
  papers: RecommendationCandidatePaperRow[],
  journalTerms: Set<string>,
) {
  if (!journalTerms.size) return papers;

  return papers.filter((paper) => {
    const journal = (paper.journal ?? "").trim().toLowerCase();
    if (!journal) return false;
    for (const term of journalTerms) {
      if (journal === term || journal.includes(term) || term.includes(journal)) return true;
    }
    return false;
  });
}

function filterByKeywords(
  papers: RecommendationCandidatePaperRow[],
  profileKeywords: string[],
) {
  if (!profileKeywords.length) return papers;

  return papers.filter((paper) =>
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

export async function generateRecommendations(
  input: RecommendationInput,
): Promise<RecommendationOutput[]> {
  const supabase = createServiceSupabaseClient();
  const { user_id, batch_date } = input;

  const profile = await getRecommendationProfile(supabase, user_id);
  if (profile?.is_active === false) {
    return [];
  }

  const profileKeywords = normalizeKeywords(profile?.subscription_keywords);
  const customJournals = normalizeKeywords(profile?.custom_journals);
  const journalTerms = new Set(customJournals);

  let papers = await listRecommendationCandidatePapers(supabase);
  papers = filterByJournalTerms(papers, journalTerms);
  papers = filterByKeywords(papers, profileKeywords).slice(0, 20);

  const outputs: RecommendationOutput[] = papers.map((paper) => ({
    paper_id: paper.id,
    source_type: "precision",
    recommendation_score: Number(paper.quality_score ?? 0),
    reason: "基于期刊订阅与关键词匹配推荐",
  }));

  await upsertFeedRecommendations(
    supabase,
    outputs.map((row) => ({
      user_id,
      paper_id: row.paper_id,
      source_type: row.source_type,
      recommendation_score: row.recommendation_score,
      reason: row.reason,
      is_consumed: false,
      batch_date,
    })),
  );

  return outputs;
}
