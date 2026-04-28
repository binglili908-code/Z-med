import {
  buildSearchText,
  expandSubscriptionTerms,
  hasBroadTopicTerm,
  journalMatchesAnyTerm,
  textMatchesAnyTerm,
} from "@/lib/subscription-matching";
import type { DbPaper, PersonalizedFeedResult } from "@/server/repositories/papers";
import type { ProfileSubscriptionStatus } from "@/server/repositories/profiles";
import type { RecommendationSourceType } from "@/shared/contracts/papers";

export type FeedProfileTerms = {
  keywords: string[];
  journals: string[];
};

export type RankedFeedPaper = DbPaper & {
  final_score: number;
  source_type: RecommendationSourceType;
  recommendation_reason: string;
};

type MatchSignals = {
  journal: boolean;
  title: boolean;
  abstract: boolean;
  metadata: boolean;
  aiAnalysis: boolean;
};

type RankingOptions = {
  now?: Date;
};

const REASON = "Matched your subscription preferences";
const TOPIC_FALLBACK_REASON =
  "No exact journal+keyword match this week; topic-related fallback";

export function buildFeedProfileTerms(status: ProfileSubscriptionStatus): FeedProfileTerms {
  return {
    keywords: expandSubscriptionTerms(status.matchingKeywords),
    journals: expandSubscriptionTerms(status.matchingJournals),
  };
}

function numberOrZero(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isWithinDays(dateString: string | null | undefined, now: Date, days: number) {
  if (!dateString) return false;
  const time = new Date(dateString).getTime();
  if (!Number.isFinite(time)) return false;
  const diffMs = now.getTime() - time;
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

function paperMatchSignals(paper: DbPaper, terms: FeedProfileTerms): MatchSignals {
  const titleText = buildSearchText([paper.title, paper.title_zh]);
  const abstractText = buildSearchText([paper.abstract, paper.abstract_zh]);
  const metadataText = buildSearchText([
    ...(paper.keywords ?? []),
    ...(paper.mesh_terms ?? []),
  ]);
  const aiAnalysisText = paper.ai_analysis ? buildSearchText([JSON.stringify(paper.ai_analysis)]) : "";

  return {
    journal: terms.journals.length > 0 && journalMatchesAnyTerm(paper.journal, terms.journals),
    title: terms.keywords.length > 0 && textMatchesAnyTerm(titleText, terms.keywords),
    abstract: terms.keywords.length > 0 && textMatchesAnyTerm(abstractText, terms.keywords),
    metadata: terms.keywords.length > 0 && textMatchesAnyTerm(metadataText, terms.keywords),
    aiAnalysis:
      terms.keywords.length > 0 && textMatchesAnyTerm(aiAnalysisText, terms.keywords),
  };
}

function hasAnySignal(signals: MatchSignals) {
  return signals.journal || signals.title || signals.abstract || signals.metadata || signals.aiAnalysis;
}

function hasKeywordSignal(signals: MatchSignals) {
  return signals.title || signals.abstract || signals.metadata || signals.aiAnalysis;
}

function hasStrongKeywordSignal(signals: MatchSignals) {
  return signals.title || signals.metadata;
}

function matchesRequiredPreferenceGroups(signals: MatchSignals, terms: FeedProfileTerms) {
  const requiresKeyword = terms.keywords.length > 0;
  const requiresJournal = terms.journals.length > 0;
  if (!requiresKeyword && !requiresJournal) return true;
  if (requiresKeyword && hasBroadTopicTerm(terms.keywords) && !hasStrongKeywordSignal(signals)) {
    return false;
  }
  return (!requiresKeyword || hasKeywordSignal(signals)) && (!requiresJournal || signals.journal);
}

function matchBonus(signals: MatchSignals) {
  let bonus = 0;
  if (signals.journal) bonus += 25;
  if (signals.title) bonus += 25;
  if (signals.abstract) bonus += 15;
  if (signals.metadata) bonus += 12;
  if (signals.aiAnalysis) bonus += 8;
  return bonus;
}

function keywordMatchBonus(signals: MatchSignals) {
  let bonus = 0;
  if (signals.title) bonus += 25;
  if (signals.abstract) bonus += 15;
  if (signals.metadata) bonus += 12;
  if (signals.aiAnalysis) bonus += 8;
  return bonus;
}

function recencyBonus(paper: DbPaper, now: Date) {
  if (isWithinDays(paper.publication_date, now, 7)) return 10;
  if (isWithinDays(paper.publication_date, now, 14)) return 5;
  return 0;
}

export function scorePaperForProfile(
  paper: DbPaper,
  terms: FeedProfileTerms,
  options: RankingOptions = {},
): RankedFeedPaper | null {
  const hasExplicitPreferences = terms.keywords.length > 0 || terms.journals.length > 0;
  const signals = paperMatchSignals(paper, terms);

  if (hasExplicitPreferences && !hasAnySignal(signals)) return null;
  if (!matchesRequiredPreferenceGroups(signals, terms)) return null;

  const now = options.now ?? new Date();
  const finalScore = numberOrZero(paper.quality_score) + matchBonus(signals) + recencyBonus(paper, now);

  return {
    ...paper,
    final_score: finalScore,
    source_type: hasExplicitPreferences ? "precision" : "trending",
    recommendation_reason: hasExplicitPreferences ? REASON : "Recent high-quality paper",
  };
}

export function rankPersonalizedFeedPapers(
  papers: DbPaper[],
  terms: FeedProfileTerms,
  options: RankingOptions = {},
) {
  return papers
    .map((paper) => scorePaperForProfile(paper, terms, options))
    .filter((paper): paper is RankedFeedPaper => Boolean(paper))
    .sort((a, b) => {
      const scoreDiff = b.final_score - a.final_score;
      if (scoreDiff !== 0) return scoreDiff;
      return String(b.publication_date ?? "").localeCompare(String(a.publication_date ?? ""));
    });
}

export function scoreTopicFallbackPaperForProfile(
  paper: DbPaper,
  terms: FeedProfileTerms,
  options: RankingOptions = {},
): RankedFeedPaper | null {
  if (!terms.keywords.length) return null;
  const signals = paperMatchSignals(paper, terms);
  if (!hasKeywordSignal(signals)) return null;
  if (hasBroadTopicTerm(terms.keywords) && !hasStrongKeywordSignal(signals)) return null;

  const now = options.now ?? new Date();
  const finalScore =
    numberOrZero(paper.quality_score) + keywordMatchBonus(signals) + recencyBonus(paper, now);

  return {
    ...paper,
    final_score: finalScore,
    source_type: "serendipity",
    recommendation_reason: TOPIC_FALLBACK_REASON,
  };
}

export function rankTopicFallbackFeedPapers(
  papers: DbPaper[],
  terms: FeedProfileTerms,
  options: RankingOptions = {},
) {
  return papers
    .map((paper) => scoreTopicFallbackPaperForProfile(paper, terms, options))
    .filter((paper): paper is RankedFeedPaper => Boolean(paper))
    .sort((a, b) => {
      const scoreDiff = b.final_score - a.final_score;
      if (scoreDiff !== 0) return scoreDiff;
      return String(b.publication_date ?? "").localeCompare(String(a.publication_date ?? ""));
    });
}

export function paginateRankedFeed(
  papers: RankedFeedPaper[],
  page: number,
  pageSize: number,
  meta: Omit<PersonalizedFeedResult, "paperRows" | "total" | "page" | "pageSize"> = {},
): PersonalizedFeedResult {
  const fromIndex = (page - 1) * pageSize;
  return {
    paperRows: papers.slice(fromIndex, fromIndex + pageSize),
    total: papers.length,
    page,
    pageSize,
    ...meta,
  };
}
