import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { computeDynamicQualityScore } from "@/lib/journal-score";
import {
  buildMedicalQueryInputHash,
  createLayeredMedicalQueryCache,
  defaultMedicalQueryCache,
} from "@/lib/medical-query-cache";
import {
  scoreDynamicMedicalContext,
  type DynamicMedicalContextScore,
} from "@/lib/dynamic-medical-context-scoring";
import { scoreAndUpsertPapers } from "@/lib/pubmed-paper-scoring";
import type { MedicalQueryPlan } from "@/lib/medical-query-plan";
import { planMedicalQuery } from "@/lib/medical-query-planner";
import {
  callMiniMaxKeywordExpansion,
  extractPubmedQueryText,
} from "@/lib/pubmed-keyword-expansion";
import { KeywordSyncStats } from "@/lib/pubmed-keyword-sync-stats";
import { loadPubmedSummariesByIds } from "@/lib/pubmed-summary-loader";
import {
  chunk,
  dedupeIdList,
  pubmedEsearch,
  pubmedEsearchAll,
  randomDelay,
  resolveOpenAccessByDoi,
} from "@/lib/pubmed-sync-client";
import { dedupeTerms } from "@/lib/pubmed-sync-rules";
import { createSupabaseMedicalQueryCache } from "@/lib/supabase-medical-query-cache";
import {
  buildUserPreferenceJournalQueries,
  buildJournalWindowQuery,
  buildQueryFromKeywords,
  buildPlannerKeywordPubmedQueries,
  buildRecentJournalQuery,
  buildTopJournalBackfillQuery,
  buildTopJournalQuery,
  formatPubmedDate,
  monthRangeByOffset,
  toJournalList,
  toKeywordList,
  toKeywordSyncSeedList,
} from "@/lib/pubmed-sync-queries";
import {
  buildPubmedQueryForKeyword,
  calculateAiMedScore,
  getOrFlagKeyword,
  insertJournalSyncLog,
  loadActiveJournalNames,
  loadActiveJournals,
  loadActiveProfileKeywordRows,
  loadExistingPaperPmids,
  loadJournalQualityMap,
  loadProfileSubscriptionKeywordRows,
  loadTopJournalTerms,
  readBackfillMonthOffset,
  resolveJournalQuality,
  saveLlmSynonyms,
  upsertPaperRecommendationContext,
  upsertKeywordSyncedPaper,
  writeBackfillMonthOffset,
  writeSyncStateValue,
} from "@/server/repositories/pubmed-sync";

export type KeywordSyncJobOptions = {
  keywords?: string[];
  keywordLimit?: number;
  windows?: number[];
  maxNewPmids?: number;
  includeExisting?: boolean;
  includeDiagnostics?: boolean;
  includeAbstracts?: boolean;
  resolveOpenAccess?: boolean;
  timeBudgetMs?: number;
};

const DEFAULT_KEYWORD_SYNC_WINDOWS = [7, 30];
const DEFAULT_KEYWORD_SYNC_MAX_NEW_PMIDS = 40;
const DEFAULT_KEYWORD_SYNC_TIME_BUDGET_MS = 45_000;
const KEYWORD_SYNC_PROCESSING_BATCH_SIZE = 3;

function cleanKeywordSyncSeed(input: string) {
  const value = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  return value.length > 0 && value.length <= 120 ? value : "";
}

function normalizePositiveInteger(value: number | undefined, max: number) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.floor(value as number);
  if (rounded <= 0) return null;
  return Math.min(rounded, max);
}

function normalizeSyncWindows(input: number[] | undefined) {
  const values = input?.length ? input : DEFAULT_KEYWORD_SYNC_WINDOWS;
  const windows = Array.from(
    new Set(
      values
        .map((value) => Math.floor(value))
        .filter((value) => [7, 30].includes(value)),
    ),
  );
  return windows.length ? windows : DEFAULT_KEYWORD_SYNC_WINDOWS;
}

export function selectKeywordSyncPmids(args: {
  dedupedPmids: string[];
  existingPmids: Set<string>;
  includeExisting?: boolean;
  maxPmids: number;
}) {
  const newPmids = args.dedupedPmids.filter((id) => !args.existingPmids.has(id));
  const refreshPmids = args.includeExisting
    ? args.dedupedPmids.filter((id) => args.existingPmids.has(id))
    : [];
  const selectedPmids = args.includeExisting ? [...newPmids, ...refreshPmids] : newPmids;
  const pmidsToProcess = selectedPmids.slice(0, args.maxPmids);

  return {
    newPmids,
    selectedPmids,
    pmidsToProcess,
    truncated: pmidsToProcess.length < selectedPmids.length,
  };
}

function bestDynamicContextScore(args: {
  paper: Parameters<typeof scoreDynamicMedicalContext>[0]["paper"];
  matchedKeywords: string[];
  plannerPlansByKeyword: Map<string, MedicalQueryPlan>;
  rpcScore: { isAiMed: boolean; score: number };
}) {
  let best: DynamicMedicalContextScore | null = null;
  for (const keyword of args.matchedKeywords) {
    const plan = args.plannerPlansByKeyword.get(keyword);
    if (!plan) continue;
    const scored = scoreDynamicMedicalContext({
      paper: args.paper,
      plan,
      rpcScore: args.rpcScore,
      plannerQueryVerified: true,
    });
    if (!best || Number(scored.eligible) > Number(best.eligible) || scored.score > best.score) {
      best = scored;
    }
  }
  return best;
}

function buildKeywordSyncedPaperKeywords(args: {
  paperKeywords: string[];
  matchedKeywords: string[];
  plannerPlansByKeyword: Map<string, MedicalQueryPlan>;
  dynamicContext: DynamicMedicalContextScore | null;
}) {
  const planTopics = args.matchedKeywords
    .map((keyword) => args.plannerPlansByKeyword.get(keyword)?.topic)
    .filter((topic): topic is string => Boolean(topic));
  return dedupeTerms([
    ...args.paperKeywords,
    ...planTopics,
    ...(args.dynamicContext?.contextTerms ?? []),
    ...(args.dynamicContext?.meshTerms ?? []),
    ...(args.dynamicContext?.aiTerms ?? []),
  ]).slice(0, 60);
}

function recommendationContextRows(args: {
  pmid: string;
  matchedKeywords: string[];
  plannerPlansByKeyword: Map<string, MedicalQueryPlan>;
  dynamicContext: DynamicMedicalContextScore | null;
  rpcScore: { isAiMed: boolean; score: number };
  isRecommendationEligible: boolean;
  qualityTier: string | null;
}) {
  const syncedAt = new Date().toISOString();
  return args.matchedKeywords.map((keyword) => {
    const plan = args.plannerPlansByKeyword.get(keyword);
    return {
      pmid: args.pmid,
      keyword,
      input_hash: buildMedicalQueryInputHash([keyword]),
      plan_topic: plan?.topic ?? null,
      source: "keyword_sync_dynamic_context",
      rpc_score: args.rpcScore,
      dynamic_context: (args.dynamicContext ?? {}) as unknown as Record<string, unknown>,
      matched_terms: dedupeTerms([
        ...(args.dynamicContext?.aiTerms ?? []),
        ...(args.dynamicContext?.contextTerms ?? []),
        ...(args.dynamicContext?.meshTerms ?? []),
      ]),
      is_recommendation_eligible: args.isRecommendationEligible,
      quality_tier: args.qualityTier,
      synced_at: syncedAt,
      updated_at: syncedAt,
    };
  });
}

export async function runPubmedSyncJob() {
  const supabase = createServiceSupabaseClient();
  const journalMap = await loadJournalQualityMap(supabase);
  const topJournalTerms = await loadTopJournalTerms(supabase);
  const activeJournalNames = await loadActiveJournalNames(supabase);
  const profileRows = await loadActiveProfileKeywordRows(supabase);
  const keywords = toKeywordList(profileRows);
  const profileJournalTerms = toJournalList(profileRows);
  const broadQuery = buildQueryFromKeywords(keywords);
  const broadIds = await pubmedEsearch(broadQuery, 200);
  const topJournalQuery = buildTopJournalQuery(topJournalTerms);
  const topJournalIds = topJournalQuery ? await pubmedEsearch(topJournalQuery, 300) : [];
  const profileJournalIds: string[] = [];
  const profileJournalQueries = buildUserPreferenceJournalQueries(profileJournalTerms, 30);
  for (const query of profileJournalQueries) {
    const ids = await pubmedEsearch(query, 120);
    profileJournalIds.push(...ids);
    await randomDelay(120, 220);
  }
  const byJournalIds: string[] = [];
  for (const name of activeJournalNames) {
    const q = buildRecentJournalQuery(name);
    if (!q) continue;
    const ids = await pubmedEsearch(q, 200);
    byJournalIds.push(...ids);
    await randomDelay(120, 220);
  }
  const ids = dedupeIdList([...topJournalIds, ...broadIds, ...profileJournalIds, ...byJournalIds]);

  const summaries = await loadPubmedSummariesByIds(ids);

  const { upsertRows, aiMedCount } = await scoreAndUpsertPapers({
    supabase,
    summaries,
    journalMap,
  });

  return {
    keywordCount: keywords.length,
    profileJournalTermCount: profileJournalTerms.length,
    topJournalTermCount: topJournalTerms.length,
    topJournalFetchedCount: topJournalIds.length,
    profileJournalFetchedCount: profileJournalIds.length,
    activeJournalCount: activeJournalNames.length,
    byJournalFetchedCount: byJournalIds.length,
    fetchedCount: summaries.length,
    aiMedCount,
    upsertedCount: upsertRows.length,
    query: broadQuery,
    topJournalQuery,
    profileJournalQueries,
  };
}

export async function runPubmedBackfillJob() {
  const supabase = createServiceSupabaseClient();
  const journalMap = await loadJournalQualityMap(supabase);
  const topJournalTerms = await loadTopJournalTerms(supabase);
  const monthOffset = await readBackfillMonthOffset(supabase);
  const { fromDate, toDate } = monthRangeByOffset(monthOffset);

  const query = buildTopJournalBackfillQuery(topJournalTerms, fromDate, toDate);
  if (!query) {
    return {
      monthOffset,
      fromDate,
      toDate,
      fetchedCount: 0,
      aiMedCount: 0,
      upsertedCount: 0,
      query: null,
    };
  }

  const ids = await pubmedEsearch(query, 200);
  const summaries = await loadPubmedSummariesByIds(ids);

  const { upsertRows, aiMedCount } = await scoreAndUpsertPapers({
    supabase,
    summaries,
    journalMap,
  });

  const nextOffset = monthOffset >= 6 ? 1 : monthOffset + 1;
  await writeBackfillMonthOffset(supabase, nextOffset);

  return {
    monthOffset,
    nextOffset,
    fromDate,
    toDate,
    fetchedCount: summaries.length,
    aiMedCount,
    upsertedCount: upsertRows.length,
    query,
  };
}

export async function runJournalSyncJob() {
  const supabase = createServiceSupabaseClient();
  const journalMap = await loadJournalQualityMap(supabase);
  const journals = await loadActiveJournals(supabase);

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const fromDate = formatPubmedDate(weekAgo);
  const toDate = formatPubmedDate(today);

  let totalFound = 0;
  let totalPassed = 0;
  let totalNew = 0;

  for (const journal of journals) {
    let papersFound = 0;
    let papersPassed = 0;
    let papersNew = 0;
    let status = "success";
    let errorMessage: string | null = null;
    try {
      const query = buildJournalWindowQuery(journal.journal_name, fromDate, toDate);
      if (!query) continue;
      const pmids = await pubmedEsearch(query, 100);
      papersFound = pmids.length;
      totalFound += papersFound;

      if (pmids.length) {
        const existingSet = await loadExistingPaperPmids(supabase, pmids);
        const newPmids = pmids.filter((id) => !existingSet.has(id));
        if (newPmids.length) {
          const summaries = await loadPubmedSummariesByIds(newPmids, {
            delayMinMs: 160,
            delayMaxMs: 260,
          });
          const { upsertRows, aiMedCount } = await scoreAndUpsertPapers({
            supabase,
            summaries,
            journalMap,
          });
          papersPassed = aiMedCount;
          papersNew = upsertRows.length;
          totalPassed += papersPassed;
          totalNew += papersNew;
        }
      }
    } catch (error) {
      status = "failed";
      errorMessage = error instanceof Error ? error.message.slice(0, 500) : "unknown";
    }

    await insertJournalSyncLog(supabase, {
      journal_quality_id: journal.id,
      journal_name: journal.journal_name,
      sync_from: weekAgo.toISOString().slice(0, 10),
      sync_to: today.toISOString().slice(0, 10),
      papers_found: papersFound,
      papers_passed: papersPassed,
      papers_new: papersNew,
      status,
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    await randomDelay(350, 500);
  }

  await writeSyncStateValue(supabase, {
    key: "journal_sync_last_run",
    value: today.toISOString().slice(0, 10),
  });

  return {
    journalsSynced: journals.length,
    syncFrom: weekAgo.toISOString().slice(0, 10),
    syncTo: today.toISOString().slice(0, 10),
    totalFound,
    totalPassed,
    totalNew,
  };
}

export async function runKeywordSyncJob(options: KeywordSyncJobOptions = {}) {
  const supabase = createServiceSupabaseClient();
  const journalMap = await loadJournalQualityMap(supabase);
  const plannerCache = createLayeredMedicalQueryCache([
    createSupabaseMedicalQueryCache(supabase),
    defaultMedicalQueryCache,
  ]);

  const allKeywords = new Set<string>();
  if (options.keywords?.length) {
    for (const keyword of options.keywords) {
      const value = cleanKeywordSyncSeed(keyword);
      if (value) allKeywords.add(value);
    }
  } else {
    const profiles = await loadProfileSubscriptionKeywordRows(supabase);
    for (const keyword of toKeywordSyncSeedList(profiles)) {
      const value = cleanKeywordSyncSeed(keyword);
      if (value) allKeywords.add(value);
    }
  }

  const keywordLimit = normalizePositiveInteger(options.keywordLimit, 50);
  const keywordList = Array.from(allKeywords).slice(0, keywordLimit ?? undefined);
  const syncWindows = normalizeSyncWindows(options.windows);
  const maxNewPmids =
    normalizePositiveInteger(options.maxNewPmids, 200) ?? DEFAULT_KEYWORD_SYNC_MAX_NEW_PMIDS;
  const includeAbstracts = options.includeAbstracts ?? true;
  const resolveOpenAccess = options.resolveOpenAccess ?? false;
  const timeBudgetMs =
    normalizePositiveInteger(options.timeBudgetMs, 240_000) ??
    DEFAULT_KEYWORD_SYNC_TIME_BUDGET_MS;
  const startedAt = Date.now();
  const responseOptions = {
    keywordLimit: keywordLimit ?? null,
    maxNewPmids,
    includeExisting: Boolean(options.includeExisting),
    includeAbstracts,
    resolveOpenAccess,
    timeBudgetMs,
  };
  const isTimeBudgetExceeded = () => Date.now() - startedAt >= timeBudgetMs;
  const processedPaperDiagnostics: Array<Record<string, unknown>> = [];
  let processedPmidCount = 0;
  let stoppedEarlyDueToTimeBudget = false;
  if (!keywordList.length) {
    return {
      keywordCount: 0,
      keywords: [] as string[],
      windows: syncWindows,
      totalFound: 0,
      totalNew: 0,
      totalPassed: 0,
      totalDropped: 0,
      estimatedTotalFound: 0,
      llmCalls: 0,
      plannerQueryCount: 0,
      candidatePmidCount: 0,
      existingCandidatePmidCount: 0,
      newPmidCount: 0,
      selectedPmidCount: 0,
      processedPmidCount: 0,
      truncatedNewPmids: false,
      stoppedEarlyDueToTimeBudget,
      elapsedMs: Date.now() - startedAt,
      options: responseOptions,
      processedPapers: options.includeDiagnostics ? processedPaperDiagnostics : undefined,
      keywordStats: [] as Array<{
        keyword: string;
        found: number;
        estimatedFound: number;
        new: number;
        passed: number;
        dropped: number;
        windows: number[];
      }>,
    };
  }

  let llmCalls = 0;
  let plannerQueryCount = 0;
  const stats = new KeywordSyncStats();
  const plannerPlansByKeyword = new Map<string, MedicalQueryPlan>();

  for (const keyword of keywordList) {
    try {
      const plannerQueriesByWindow = new Map<number, string[]>();

      try {
        const plan = await planMedicalQuery([keyword], { cache: plannerCache });
        plannerPlansByKeyword.set(keyword, plan);
        for (const daysBack of syncWindows) {
          const queries = buildPlannerKeywordPubmedQueries(plan, daysBack);
          if (queries.length) {
            plannerQueriesByWindow.set(daysBack, queries);
            plannerQueryCount += queries.length;
          }
        }
      } catch {
        // Keep the legacy keyword expansion path as a fallback.
      }

      const hasPlannerQueries = Array.from(plannerQueriesByWindow.values()).some(
        (queries) => queries.length > 0,
      );
      let hasLegacyQuerySource = false;

      if (!hasPlannerQueries) {
        const { data: keywordFlagData } = await getOrFlagKeyword(supabase, keyword);
        const flagRow = Array.isArray(keywordFlagData)
          ? (keywordFlagData[0] as any)
          : (keywordFlagData as any);
        const status = typeof flagRow?.status === "string" ? flagRow.status : "unknown";

        if (status === "cached") {
          hasLegacyQuerySource = true;
        } else {
          const prompt = typeof flagRow?.prompt === "string" ? flagRow.prompt : "";
          const synonymData = prompt ? await callMiniMaxKeywordExpansion(prompt) : null;
          if (synonymData?.synonyms?.length) {
            llmCalls += 1;
            const titleRequired = synonymData.title_required?.length
              ? synonymData.title_required
              : synonymData.synonyms;
            const { error: saveErr } = await saveLlmSynonyms(supabase, {
              keyword,
              synonyms: synonymData.synonyms,
              titleRequired,
              pubmedQuery: synonymData.pubmed_query ?? null,
            });
            if (saveErr) {
              await saveLlmSynonyms(supabase, {
                keyword,
                synonyms: synonymData.synonyms,
                titleRequired,
              });
            }
            hasLegacyQuerySource = true;
          }
        }
      }

      if (!hasPlannerQueries && !hasLegacyQuerySource) continue;

      for (const daysBack of syncWindows) {
        let windowQueries = plannerQueriesByWindow.get(daysBack) ?? [];
        if (!windowQueries.length) {
          const { data: queryData, error: qErr } = await buildPubmedQueryForKeyword(supabase, {
            keyword,
            daysBack,
          });
          if (qErr) continue;
          const legacyWindowQuery = extractPubmedQueryText(queryData);
          windowQueries = legacyWindowQuery ? [legacyWindowQuery] : [];
        }

        for (const windowQuery of windowQueries) {
          if (!windowQuery) continue;
          const result = await pubmedEsearchAll({
            term: windowQuery,
            pageSize: 100,
            maxPages: daysBack <= 7 ? 6 : 10,
            maxRecords: daysBack <= 7 ? 600 : 1000,
          });
          if (!result.ids.length) {
            await randomDelay(280, 420);
            continue;
          }

          stats.recordSearchWindow({
            keyword,
            daysBack,
            ids: result.ids,
            totalCount: result.totalCount,
          });
          await randomDelay(280, 420);
        }
      }
    } catch {
      continue;
    }
  }

  const deduped = stats.getDedupedPmids();
  if (!deduped.length) {
    return {
      keywordCount: keywordList.length,
      keywords: keywordList,
      windows: syncWindows,
      ...stats.buildSummary(keywordList),
      llmCalls,
      plannerQueryCount,
      candidatePmidCount: 0,
      existingCandidatePmidCount: 0,
      newPmidCount: 0,
      selectedPmidCount: 0,
      processedPmidCount: 0,
      truncatedNewPmids: false,
      stoppedEarlyDueToTimeBudget,
      elapsedMs: Date.now() - startedAt,
      options: responseOptions,
      processedPapers: options.includeDiagnostics ? processedPaperDiagnostics : undefined,
    };
  }

  const existing = await loadExistingPaperPmids(supabase, deduped);
  const { newPmids, selectedPmids, pmidsToProcess, truncated } = selectKeywordSyncPmids({
    dedupedPmids: deduped,
    existingPmids: existing,
    includeExisting: options.includeExisting,
    maxPmids: maxNewPmids,
  });
  if (!selectedPmids.length) {
    return {
      keywordCount: keywordList.length,
      keywords: keywordList,
      windows: syncWindows,
      ...stats.buildSummary(keywordList),
      llmCalls,
      plannerQueryCount,
      candidatePmidCount: deduped.length,
      existingCandidatePmidCount: existing.size,
      newPmidCount: newPmids.length,
      selectedPmidCount: 0,
      processedPmidCount: 0,
      truncatedNewPmids: false,
      stoppedEarlyDueToTimeBudget,
      elapsedMs: Date.now() - startedAt,
      options: responseOptions,
      processedPapers: options.includeDiagnostics ? processedPaperDiagnostics : undefined,
    };
  }

  for (const pmidGroup of chunk(pmidsToProcess, KEYWORD_SYNC_PROCESSING_BATCH_SIZE)) {
    if (isTimeBudgetExceeded()) {
      stoppedEarlyDueToTimeBudget = true;
      break;
    }

    const summaries = await loadPubmedSummariesByIds(pmidGroup, {
      chunkSize: KEYWORD_SYNC_PROCESSING_BATCH_SIZE,
      delayMinMs: 60,
      delayMaxMs: 120,
      includeAbstracts,
    });
    processedPmidCount += summaries.length;

    for (const paper of summaries) {
      if (isTimeBudgetExceeded()) {
        stoppedEarlyDueToTimeBudget = true;
        break;
      }

      const { data: scoreData, error: scoreErr } = await calculateAiMedScore(supabase, {
        title: paper.title,
        abstract: paper.abstract ?? "",
      });
      if (scoreErr) {
        continue;
      }
      const scoreObj = (scoreData ?? {}) as { score?: number | string; is_ai_med?: boolean };
      const rpcIsAiMed = Boolean(scoreObj.is_ai_med);
      const aiScore = Number(scoreObj.score ?? 0);

      const journalRow = resolveJournalQuality(paper, journalMap);
      const tier = (journalRow?.tier ?? "emerging") as "top" | "core" | "emerging";
      const matchedKeywords = stats.getKeywordsForPmid(paper.pmid);
      const dynamicContext = bestDynamicContextScore({
        paper,
        matchedKeywords,
        plannerPlansByKeyword,
        rpcScore: { isAiMed: rpcIsAiMed, score: aiScore },
      });
      const isAiMed = rpcIsAiMed || Boolean(dynamicContext?.eligible);
      const aiScoreForRanking = Math.max(aiScore, dynamicContext?.score ?? 0);
      const dynamic = computeDynamicQualityScore({
        aiMedScore: aiScoreForRanking,
        baseWeight: journalRow?.weight ?? 0.5,
        impactFactor: journalRow?.impact_factor ?? null,
        jcrQuartile: journalRow?.jcr_quartile ?? null,
        casZone: journalRow?.cas_zone ?? null,
      });
      const qualityScore = dynamic.qualityScore;
      const oa = resolveOpenAccess
        ? await resolveOpenAccessByDoi(paper.doi)
        : null;

      const topCoreEligible = tier !== "emerging";
      const recommendationDropReasons = [
        ...(!isAiMed ? ["ai_med_score_below_threshold"] : []),
        ...(!isAiMed && !dynamicContext?.eligible ? ["dynamic_context_not_verified"] : []),
      ];
      const globalFeedExclusionReasons = [
        ...(!topCoreEligible ? ["journal_not_top_or_core"] : []),
      ];
      const paperKeywords = buildKeywordSyncedPaperKeywords({
        paperKeywords: paper.keywords,
        matchedKeywords,
        plannerPlansByKeyword,
        dynamicContext,
      });
      const existingPayload =
        paper.source_payload && typeof paper.source_payload === "object" ? paper.source_payload : {};
      const sourcePayload = {
        ...existingPayload,
        keyword_sync: {
          matched_keywords: matchedKeywords,
          windows: syncWindows,
          rpc_ai_med_score: aiScore,
          ai_med_score: aiScoreForRanking,
          rpc_is_ai_med: rpcIsAiMed,
          dynamic_context: dynamicContext,
          quality_tier: tier,
          top_core_eligible: topCoreEligible,
          recommendation_eligible: isAiMed,
          recommendation_drop_reasons: recommendationDropReasons,
          global_feed_exclusion_reasons: globalFeedExclusionReasons,
          open_access_resolved: Boolean(oa),
          synced_at: new Date().toISOString(),
        },
      };

      const upsertResult = await upsertKeywordSyncedPaper(supabase, {
        pmid: paper.pmid,
        doi: paper.doi ?? null,
        title: paper.title,
        abstract: paper.abstract,
        journal: paper.journal,
        publication_date: paper.publication_date,
        pubmed_url: paper.pubmed_url,
        authors: paper.authors,
        mesh_terms: paper.mesh_terms,
        keywords: paperKeywords,
        ...(oa
          ? {
              is_open_access: oa.is_open_access,
              oa_pdf_url: oa.oa_pdf_url,
            }
          : {}),
        ai_med_score: aiScoreForRanking,
        is_ai_med: isAiMed,
        quality_tier: tier,
        quality_score: qualityScore,
        journal_if: dynamic.impactFactor,
        journal_jcr: dynamic.jcrQuartile,
        journal_cas_zone: dynamic.casZone,
        source_payload: sourcePayload,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (options.includeDiagnostics) {
        processedPaperDiagnostics.push({
          pmid: paper.pmid,
          title: paper.title,
          journal: paper.journal,
          publicationDate: paper.publication_date,
          aiMedScore: aiScore,
          aiMedScoreForRanking: aiScoreForRanking,
          rpcIsAiMed,
          dynamicContext,
          qualityTier: tier,
          topCoreEligible,
          recommendationEligible: isAiMed,
          recommendationDropReasons,
          globalFeedExclusionReasons,
        });
      }
      if (upsertResult.ok) {
        stats.recordUpsert({ matchedKeywords, isAiMed });
        for (const contextRow of recommendationContextRows({
          pmid: paper.pmid,
          matchedKeywords,
          plannerPlansByKeyword,
          dynamicContext,
          rpcScore: { isAiMed: rpcIsAiMed, score: aiScore },
          isRecommendationEligible: isAiMed,
          qualityTier: tier,
        })) {
          await upsertPaperRecommendationContext(supabase, contextRow);
        }
      }
      await randomDelay(resolveOpenAccess ? 120 : 40, resolveOpenAccess ? 220 : 80);
    }
  }

  return {
    keywordCount: keywordList.length,
    keywords: keywordList,
    windows: syncWindows,
    ...stats.buildSummary(keywordList),
    llmCalls,
    plannerQueryCount,
    candidatePmidCount: deduped.length,
    existingCandidatePmidCount: existing.size,
    newPmidCount: newPmids.length,
    selectedPmidCount: selectedPmids.length,
    processedPmidCount,
    truncatedNewPmids: truncated || stoppedEarlyDueToTimeBudget,
    stoppedEarlyDueToTimeBudget,
    elapsedMs: Date.now() - startedAt,
    options: responseOptions,
    processedPapers: options.includeDiagnostics ? processedPaperDiagnostics : undefined,
  };
}
