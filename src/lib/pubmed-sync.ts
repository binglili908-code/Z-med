import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { computeDynamicQualityScore } from "@/lib/journal-score";
import { scoreAndUpsertPapers } from "@/lib/pubmed-paper-scoring";
import { planMedicalQuery } from "@/lib/medical-query-planner";
import {
  callMiniMaxKeywordExpansion,
  extractPubmedQueryText,
} from "@/lib/pubmed-keyword-expansion";
import { KeywordSyncStats } from "@/lib/pubmed-keyword-sync-stats";
import { loadPubmedSummariesByIds } from "@/lib/pubmed-summary-loader";
import {
  dedupeIdList,
  pubmedEsearch,
  pubmedEsearchAll,
  randomDelay,
  resolveOpenAccessByDoi,
} from "@/lib/pubmed-sync-client";
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
  upsertKeywordSyncedPaper,
  writeBackfillMonthOffset,
  writeSyncStateValue,
} from "@/server/repositories/pubmed-sync";

export type KeywordSyncJobOptions = {
  keywords?: string[];
  keywordLimit?: number;
  windows?: number[];
  maxNewPmids?: number;
};

const DEFAULT_KEYWORD_SYNC_WINDOWS = [7, 30];
const DEFAULT_KEYWORD_SYNC_MAX_NEW_PMIDS = 40;

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
      newPmidCount: 0,
      processedPmidCount: 0,
      truncatedNewPmids: false,
      options: {
        keywordLimit: keywordLimit ?? null,
        maxNewPmids,
      },
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

  for (const keyword of keywordList) {
    try {
      const plannerQueriesByWindow = new Map<number, string[]>();

      try {
        const plan = await planMedicalQuery([keyword]);
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
      newPmidCount: 0,
      processedPmidCount: 0,
      truncatedNewPmids: false,
      options: {
        keywordLimit: keywordLimit ?? null,
        maxNewPmids,
      },
    };
  }

  const existing = await loadExistingPaperPmids(supabase, deduped);
  const newPmids = deduped.filter((id) => !existing.has(id));
  const pmidsToProcess = newPmids.slice(0, maxNewPmids);
  if (!newPmids.length) {
    return {
      keywordCount: keywordList.length,
      keywords: keywordList,
      windows: syncWindows,
      ...stats.buildSummary(keywordList),
      llmCalls,
      plannerQueryCount,
      candidatePmidCount: deduped.length,
      newPmidCount: 0,
      processedPmidCount: 0,
      truncatedNewPmids: false,
      options: {
        keywordLimit: keywordLimit ?? null,
        maxNewPmids,
      },
    };
  }

  const summaries = await loadPubmedSummariesByIds(pmidsToProcess);
  for (const paper of summaries) {
    const { data: scoreData, error: scoreErr } = await calculateAiMedScore(supabase, {
      title: paper.title,
      abstract: paper.abstract ?? "",
    });
    if (scoreErr) {
      continue;
    }
    const scoreObj = (scoreData ?? {}) as { score?: number | string; is_ai_med?: boolean };
    const aiScore = Number(scoreObj.score ?? 0);

    const journalRow = resolveJournalQuality(paper, journalMap);
    const tier = (journalRow?.tier ?? "emerging") as "top" | "core" | "emerging";
    const isAiMed = Boolean(scoreObj.is_ai_med) && tier !== "emerging";
    const dynamic = computeDynamicQualityScore({
      aiMedScore: aiScore,
      baseWeight: journalRow?.weight ?? 0.5,
      impactFactor: journalRow?.impact_factor ?? null,
      jcrQuartile: journalRow?.jcr_quartile ?? null,
      casZone: journalRow?.cas_zone ?? null,
    });
    const qualityScore = dynamic.qualityScore;
    const oa = await resolveOpenAccessByDoi(paper.doi);

    const matchedKeywords = stats.getKeywordsForPmid(paper.pmid);
    const existingPayload =
      paper.source_payload && typeof paper.source_payload === "object" ? paper.source_payload : {};
    const sourcePayload = {
      ...existingPayload,
      keyword_sync: {
        matched_keywords: matchedKeywords,
        windows: syncWindows,
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
      keywords: paper.keywords,
      is_open_access: oa.is_open_access,
      oa_pdf_url: oa.oa_pdf_url,
      ai_med_score: aiScore,
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
    if (upsertResult.ok) {
      stats.recordUpsert({ matchedKeywords, isAiMed });
    }
    await randomDelay(120, 220);
  }

  return {
    keywordCount: keywordList.length,
    keywords: keywordList,
    windows: syncWindows,
    ...stats.buildSummary(keywordList),
    llmCalls,
    plannerQueryCount,
    candidatePmidCount: deduped.length,
    newPmidCount: newPmids.length,
    processedPmidCount: pmidsToProcess.length,
    truncatedNewPmids: pmidsToProcess.length < newPmids.length,
    options: {
      keywordLimit: keywordLimit ?? null,
      maxNewPmids,
    },
  };
}
