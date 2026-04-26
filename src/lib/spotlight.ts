import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  getPaperEmailInteractions,
  listRecentQualityPapers,
  mapPaperToPaperCard,
  type DbPaper,
} from "@/server/repositories/papers";
import { getProfileSubscriptionStatus } from "@/server/repositories/profiles";
import type { PaperCard, RecommendationSourceType } from "@/shared/contracts/papers";

export type SpotlightSourceType = RecommendationSourceType;

export type SpotlightPaper = PaperCard;

function normalizeList(values: string[] | null | undefined) {
  const set = new Set<string>();
  for (const raw of values ?? []) {
    const value = raw.trim().toLowerCase();
    if (value) set.add(value);
  }
  return Array.from(set);
}

function includesAnyKeyword(paper: DbPaper, keywords: string[]) {
  if (!keywords.length) return true;
  const text = [
    paper.title ?? "",
    paper.title_zh ?? "",
    paper.abstract ?? "",
    paper.abstract_zh ?? "",
    paper.journal ?? "",
    (paper.keywords ?? []).join(" "),
    (paper.mesh_terms ?? []).join(" "),
    paper.ai_analysis ? JSON.stringify(paper.ai_analysis) : "",
  ]
    .join("\n")
    .toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

export async function buildSpotlightPapers(params: {
  userId: string | null;
  service?: ReturnType<typeof createServiceSupabaseClient>;
}) {
  const service = params.service ?? createServiceSupabaseClient();
  const { userId } = params;

  let hasProfileConfig = false;
  const journalTerms = new Set<string>();
  const keywords: string[] = [];

  if (userId) {
    const subscriptionStatus = await getProfileSubscriptionStatus(service, userId);
    if (subscriptionStatus.subscriptionEnabled) {
      for (const keyword of normalizeList(subscriptionStatus.keywords)) keywords.push(keyword);
      for (const journal of normalizeList(subscriptionStatus.customJournals)) {
        journalTerms.add(journal);
      }
      hasProfileConfig = subscriptionStatus.hasSubscriptionConfig;
    }
  }

  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  let papers: DbPaper[] = [];

  papers = await listRecentQualityPapers(service, {
    cutoffDate,
    limit: 240,
  });

  papers = papers.filter((paper) => {
    const date = paper.publication_date;
    if (!date) return false;
    const tier = (paper.quality_tier ?? "").toLowerCase();
    return date >= cutoffDate && (tier === "top" || tier === "core");
  });

  const scored = papers.map((paper) => {
    const journal = (paper.journal ?? "").trim().toLowerCase();
    const journalMatch =
      !journalTerms.size
        ? false
        : Array.from(journalTerms).some(
            (term) => journal === term || journal.includes(term) || term.includes(journal),
          );
    const keywordMatch = keywords.length ? includesAnyKeyword(paper, keywords) : false;
    const relevanceScore =
      (journalMatch ? 2 : 0) + (keywordMatch ? 2 : 0) + Number(paper.quality_score ?? 0) / 100;
    return { paper, journalMatch, keywordMatch, relevanceScore };
  });

  const used = new Set<string>();
  const choose = (candidates: typeof scored, count: number) => {
    const picked: typeof scored = [];
    for (const item of candidates) {
      if (picked.length >= count) break;
      if (used.has(item.paper.id)) continue;
      used.add(item.paper.id);
      picked.push(item);
    }
    return picked;
  };

  let relevantPool = scored;
  if (hasProfileConfig) {
    relevantPool = scored
      .filter((item) => item.relevanceScore > Number(item.paper.quality_score ?? 0) / 100)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
  const relevant = choose(relevantPool, 5);

  const remaining = scored
    .filter((item) => !used.has(item.paper.id))
    .sort((a, b) => Number(b.paper.quality_score ?? 0) - Number(a.paper.quality_score ?? 0));
  const trending = choose(remaining, 1);

  const serendipityPool = scored
    .filter((item) => !used.has(item.paper.id))
    .sort((a, b) => {
      if (a.relevanceScore !== b.relevanceScore) return a.relevanceScore - b.relevanceScore;
      return Number(b.paper.quality_score ?? 0) - Number(a.paper.quality_score ?? 0);
    });
  const serendipity = choose(serendipityPool, 1);

  const spotlight = [
    ...relevant.map((item) => ({
      paper: item.paper,
      source_type: "precision" as const,
      reason: "与您的期刊订阅与关键词偏好高度相关",
    })),
    ...trending.map((item) => ({
      paper: item.paper,
      source_type: "trending" as const,
      reason: "全局高质量热点文献",
    })),
    ...serendipity.map((item) => ({
      paper: item.paper,
      source_type: "serendipity" as const,
      reason: "与您的主方向交叉，可拓宽研究边界",
    })),
  ];

  if (spotlight.length < 7) {
    for (const item of remaining) {
      if (spotlight.length >= 7) break;
      if (used.has(item.paper.id)) continue;
      used.add(item.paper.id);
      spotlight.push({
        paper: item.paper,
        source_type: "precision" as const,
        reason: hasProfileConfig ? "与您的订阅偏好相关" : "近30天高分文献",
      });
    }
  }

  const interactions = await getPaperEmailInteractions(
    service,
    userId,
    spotlight.map((item) => item.paper.id),
  );

  const items = spotlight.map((item) =>
    mapPaperToPaperCard(item.paper, {
      sourceType: item.source_type,
      recommendationReason: item.reason,
      emailedAt: interactions.get(item.paper.id)?.pdf_emailed_at ?? null,
    }),
  );

  return { items, hasProfileConfig };
}
