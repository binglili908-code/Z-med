import {
  buildSearchText,
  expandSubscriptionTerms,
  hasBroadTopicTerm,
  journalMatchesAnyTerm,
  textMatchesAnyTerm,
} from "@/lib/subscription-matching";
import type {
  WeeklyPushCandidatePaper,
  WeeklyPushProfileRow,
} from "@/server/repositories/weekly-push";

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchJournal(paper: WeeklyPushCandidatePaper, journalTerms: string[]) {
  if (!journalTerms.length) return true;
  return journalMatchesAnyTerm(paper.journal, journalTerms);
}

function matchKeyword(paper: WeeklyPushCandidatePaper, keywords: string[]) {
  if (!keywords.length) return true;
  const titleMatch = textMatchesAnyTerm(buildSearchText([paper.title ?? "", paper.title_zh ?? ""]), keywords);
  const metadataMatch = textMatchesAnyTerm(
    buildSearchText([(paper.keywords ?? []).join(" "), (paper.mesh_terms ?? []).join(" ")]),
    keywords,
  );
  const abstractMatch = textMatchesAnyTerm(
    buildSearchText([paper.abstract ?? "", paper.abstract_zh ?? ""]),
    keywords,
  );
  const aiAnalysisMatch =
    Boolean(paper.ai_analysis) && textMatchesAnyTerm(buildSearchText([JSON.stringify(paper.ai_analysis)]), keywords);

  if (hasBroadTopicTerm(keywords)) {
    return titleMatch || metadataMatch;
  }
  return titleMatch || metadataMatch || abstractMatch || aiAnalysisMatch;
}

function keywordMatchScore(paper: WeeklyPushCandidatePaper, keywords: string[]) {
  if (!keywords.length) return 0;
  let score = 0;
  if (textMatchesAnyTerm(buildSearchText([paper.title ?? "", paper.title_zh ?? ""]), keywords)) score += 30;
  if (
    textMatchesAnyTerm(
      buildSearchText([(paper.keywords ?? []).join(" "), (paper.mesh_terms ?? []).join(" ")]),
      keywords,
    )
  ) {
    score += 25;
  }
  if (textMatchesAnyTerm(buildSearchText([paper.abstract ?? "", paper.abstract_zh ?? ""]), keywords)) score += 8;
  if (
    paper.ai_analysis &&
    textMatchesAnyTerm(buildSearchText([JSON.stringify(paper.ai_analysis)]), keywords)
  ) {
    score += 3;
  }
  return score;
}

function sortWeeklyPushMatches(
  candidates: WeeklyPushCandidatePaper[],
  keywords: string[],
) {
  return [...candidates].sort((a, b) => {
    const matchDiff = keywordMatchScore(b, keywords) - keywordMatchScore(a, keywords);
    if (matchDiff !== 0) return matchDiff;
    const scoreDiff = Number(b.quality_score ?? 0) - Number(a.quality_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(b.publication_date ?? "").localeCompare(String(a.publication_date ?? ""));
  });
}

export function buildWeeklyPushProfileTerms(profile: WeeklyPushProfileRow) {
  const rawKeywords = profile.subscription_normalized_keywords?.length
    ? profile.subscription_normalized_keywords
    : profile.subscription_keywords;
  const rawJournals = profile.subscription_normalized_journals?.length
    ? profile.subscription_normalized_journals
    : profile.custom_journals;

  return {
    keywords: expandSubscriptionTerms(rawKeywords),
    journals: expandSubscriptionTerms(rawJournals),
  };
}

export function sortWeeklyPushCandidates(candidates: WeeklyPushCandidatePaper[]) {
  return [...candidates].sort((a, b) => {
    const scoreDiff = Number(b.quality_score ?? 0) - Number(a.quality_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(b.publication_date ?? "").localeCompare(String(a.publication_date ?? ""));
  });
}

export function diversifyWeeklyPushCandidates(
  candidates: WeeklyPushCandidatePaper[],
  maxCount: number,
) {
  const selected: WeeklyPushCandidatePaper[] = [];
  const usedTitle = new Set<string>();
  const journalCount = new Map<string, number>();

  for (const paper of candidates) {
    const titleKey = normalizeTitle(paper.title);
    if (usedTitle.has(titleKey)) continue;
    const journalKey = (paper.journal ?? "general").trim().toLowerCase() || "general";
    if ((journalCount.get(journalKey) ?? 0) >= 1) continue;
    selected.push(paper);
    usedTitle.add(titleKey);
    journalCount.set(journalKey, (journalCount.get(journalKey) ?? 0) + 1);
    if (selected.length >= maxCount) return selected;
  }

  for (const paper of candidates) {
    const titleKey = normalizeTitle(paper.title);
    if (usedTitle.has(titleKey)) continue;
    const journalKey = (paper.journal ?? "general").trim().toLowerCase() || "general";
    if ((journalCount.get(journalKey) ?? 0) >= 2) continue;
    selected.push(paper);
    usedTitle.add(titleKey);
    journalCount.set(journalKey, (journalCount.get(journalKey) ?? 0) + 1);
    if (selected.length >= maxCount) return selected;
  }

  return selected;
}

export function selectPersonalizedWeeklyPushPool(
  candidates: WeeklyPushCandidatePaper[],
  profile: WeeklyPushProfileRow,
) {
  const { keywords, journals } = buildWeeklyPushProfileTerms(profile);
  const hasKeywords = keywords.length > 0;
  const hasJournals = journals.length > 0;

  const filtered = candidates.filter((paper) => {
    if (hasJournals && !matchJournal(paper, journals)) return false;
    if (hasKeywords && !matchKeyword(paper, keywords)) return false;
    return true;
  });

  if (!filtered.length && (hasKeywords || hasJournals)) {
    return [];
  }

  return keywords.length
    ? sortWeeklyPushMatches(filtered.length ? filtered : candidates, keywords)
    : sortWeeklyPushCandidates(filtered.length ? filtered : candidates);
}

export function selectTopicFallbackWeeklyPushPool(
  candidates: WeeklyPushCandidatePaper[],
  profile: WeeklyPushProfileRow,
) {
  const { keywords, journals } = buildWeeklyPushProfileTerms(profile);
  if (!keywords.length || !journals.length) return [];

  return sortWeeklyPushMatches(
    candidates.filter((paper) => matchKeyword(paper, keywords) && !matchJournal(paper, journals)),
    keywords,
  );
}
