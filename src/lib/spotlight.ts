import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  buildSearchText,
  expandSubscriptionTerms,
  journalMatchesAnyTerm,
  textMatchesAnyTerm,
} from "@/lib/subscription-matching";
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

type ScoredSpotlightPaper = {
  paper: DbPaper;
  journalMatch: boolean;
  keywordMatch: boolean;
  relevanceScore: number;
};

type SpotlightSelection = {
  paper: DbPaper;
  source_type: RecommendationSourceType;
  reason: string;
};

const PRECISION_SPOTLIGHT_TARGET = 5;
const SPOTLIGHT_TOTAL_TARGET = 7;
const STRICT_MATCH_REASON =
  "\u4e0e\u60a8\u7684\u671f\u520a\u8ba2\u9605\u548c\u5173\u952e\u8bcd\u504f\u597d\u540c\u65f6\u5339\u914d";
const TRENDING_REASON = "\u5168\u5c40\u9ad8\u8d28\u91cf\u70ed\u70b9\u6587\u732e";
const SERENDIPITY_REASON =
  "\u7cbe\u51c6\u547d\u4e2d\u6587\u732e\u4e0d\u8db3\u65f6\u8865\u5145\u7684\u4ea4\u53c9\u65b9\u5411\u53c2\u8003\u6587\u732e";
const PRECISION_SHORTAGE_MESSAGE =
  "\u672c\u5468\u4e0e\u60a8\u7814\u7a76\u9886\u57df\u7cbe\u51c6\u547d\u4e2d\u6587\u732e\u4e0d\u8db35\u7bc7\uff0c\u5df2\u8865\u5145\u76f8\u5173\u4ea4\u53c9\u65b9\u5411\u6587\u732e\u3002";
const RECENT_HIGH_SCORE_REASON = "\u8fd1 30 \u5929\u9ad8\u5206\u6587\u732e";

function includesAnyKeyword(paper: DbPaper, keywords: string[]) {
  if (!keywords.length) return true;
  return textMatchesAnyTerm(
    buildSearchText([
      paper.title ?? "",
      paper.title_zh ?? "",
      paper.abstract ?? "",
      paper.abstract_zh ?? "",
      paper.journal ?? "",
      (paper.keywords ?? []).join(" "),
      (paper.mesh_terms ?? []).join(" "),
      paper.ai_analysis ? JSON.stringify(paper.ai_analysis) : "",
    ]),
    keywords,
  );
}

export function buildGlobalSpotlightSelection(
  scored: ScoredSpotlightPaper[],
  limit = 7,
): SpotlightSelection[] {
  return [...scored]
    .sort((a, b) => {
      const qualityDiff =
        Number(b.paper.quality_score ?? 0) - Number(a.paper.quality_score ?? 0);
      if (qualityDiff !== 0) return qualityDiff;
      return String(b.paper.publication_date ?? "").localeCompare(
        String(a.paper.publication_date ?? ""),
      );
    })
    .slice(0, limit)
    .map((item, index) => ({
      paper: item.paper,
      source_type: "trending" as const,
      reason: index === 0 ? TRENDING_REASON : RECENT_HIGH_SCORE_REASON,
    }));
}

function sortByQualityThenDate(scored: ScoredSpotlightPaper[]) {
  return [...scored].sort((a, b) => {
    const qualityDiff =
      Number(b.paper.quality_score ?? 0) - Number(a.paper.quality_score ?? 0);
    if (qualityDiff !== 0) return qualityDiff;
    return String(b.paper.publication_date ?? "").localeCompare(
      String(a.paper.publication_date ?? ""),
    );
  });
}

function sortByRelevanceThenQuality(scored: ScoredSpotlightPaper[]) {
  return [...scored].sort((a, b) => {
    const relevanceDiff = b.relevanceScore - a.relevanceScore;
    if (relevanceDiff !== 0) return relevanceDiff;
    const qualityDiff =
      Number(b.paper.quality_score ?? 0) - Number(a.paper.quality_score ?? 0);
    if (qualityDiff !== 0) return qualityDiff;
    return String(b.paper.publication_date ?? "").localeCompare(
      String(a.paper.publication_date ?? ""),
    );
  });
}

export function buildPersonalizedSpotlightSelection(args: {
  scored: ScoredSpotlightPaper[];
  requiresJournalMatch: boolean;
  requiresKeywordMatch: boolean;
}) {
  const matchesRequiredPreferenceGroups = (item: ScoredSpotlightPaper) => {
    return (
      (!args.requiresJournalMatch || item.journalMatch) &&
      (!args.requiresKeywordMatch || item.keywordMatch)
    );
  };
  const used = new Set<string>();
  const choose = (candidates: ScoredSpotlightPaper[], count: number) => {
    const picked: ScoredSpotlightPaper[] = [];
    for (const item of candidates) {
      if (picked.length >= count) break;
      if (used.has(item.paper.id)) continue;
      used.add(item.paper.id);
      picked.push(item);
    }
    return picked;
  };

  const precisionPool = sortByRelevanceThenQuality(
    args.scored.filter(matchesRequiredPreferenceGroups),
  );
  const precision = choose(precisionPool, PRECISION_SPOTLIGHT_TARGET);
  const precisionShortage = Math.max(0, PRECISION_SPOTLIGHT_TARGET - precision.length);
  const trending = choose(sortByQualityThenDate(args.scored), 1);

  const relatedCrossPool =
    args.requiresJournalMatch && args.requiresKeywordMatch
      ? sortByRelevanceThenQuality(
          args.scored.filter((item) => !matchesRequiredPreferenceGroups(item) && item.keywordMatch),
        )
      : [];
  const crossTarget = Math.max(0, SPOTLIGHT_TOTAL_TARGET - precision.length - trending.length);
  const cross = choose(relatedCrossPool, crossTarget);
  if (cross.length < crossTarget) {
    cross.push(
      ...choose(
        sortByQualityThenDate(args.scored).filter((item) => !used.has(item.paper.id)),
        crossTarget - cross.length,
      ),
    );
  }

  const spotlight: SpotlightSelection[] = [
    ...precision.map((item) => ({
      paper: item.paper,
      source_type: "precision" as const,
      reason: STRICT_MATCH_REASON,
    })),
    ...trending.map((item) => ({
      paper: item.paper,
      source_type: "trending" as const,
      reason: TRENDING_REASON,
    })),
    ...cross.map((item) => ({
      paper: item.paper,
      source_type: "serendipity" as const,
      reason: SERENDIPITY_REASON,
    })),
  ];

  return {
    spotlight,
    exactMatchTotal: precision.length,
    precisionShortage,
    strictMatchFallback: precisionShortage > 0,
    strictMatchMessage: precisionShortage > 0 ? PRECISION_SHORTAGE_MESSAGE : null,
  };
}

export async function buildSpotlightPapers(params: {
  userId: string | null;
  service?: ReturnType<typeof createServiceSupabaseClient>;
}) {
  const service = params.service ?? createServiceSupabaseClient();
  const { userId } = params;

  let hasProfileConfig = false;
  let journalTerms: string[] = [];
  const keywords: string[] = [];

  if (userId) {
    const subscriptionStatus = await getProfileSubscriptionStatus(service, userId);
    if (subscriptionStatus.subscriptionEnabled) {
      keywords.push(...expandSubscriptionTerms(subscriptionStatus.matchingKeywords));
      journalTerms = expandSubscriptionTerms(subscriptionStatus.matchingJournals);
      hasProfileConfig = subscriptionStatus.hasSubscriptionConfig;
    }
  }

  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let papers = await listRecentQualityPapers(service, {
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
    const journalMatch = journalTerms.length
      ? journalMatchesAnyTerm(paper.journal, journalTerms)
      : false;
    const keywordMatch = keywords.length ? includesAnyKeyword(paper, keywords) : false;
    const relevanceScore =
      (journalMatch ? 2 : 0) + (keywordMatch ? 2 : 0) + Number(paper.quality_score ?? 0) / 100;
    return { paper, journalMatch, keywordMatch, relevanceScore };
  });

  if (!hasProfileConfig) {
    const spotlight = buildGlobalSpotlightSelection(scored, 7);
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

    return { items, hasProfileConfig, strictMatchFallback: false, strictMatchMessage: null };
  }

  const selection = buildPersonalizedSpotlightSelection({
    scored,
    requiresJournalMatch: journalTerms.length > 0,
    requiresKeywordMatch: keywords.length > 0,
  });
  const { spotlight, exactMatchTotal, strictMatchFallback, strictMatchMessage } = selection;

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

  return { items, hasProfileConfig, exactMatchTotal, strictMatchFallback, strictMatchMessage };
}
