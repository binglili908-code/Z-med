import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { computeDynamicQualityScore } from "@/lib/journal-score";
import { scoreAndUpsertPapers } from "@/lib/pubmed-paper-scoring";
import {
  callMiniMaxKeywordExpansion,
  extractPubmedQueryText,
} from "@/lib/pubmed-keyword-expansion";
import { KeywordSyncStats } from "@/lib/pubmed-keyword-sync-stats";
import {
  chunk,
  dedupeIdList,
  enrichSummariesWithAbstracts,
  pubmedEsearch,
  pubmedEsearchAll,
  pubmedEsummary,
  randomDelay,
  resolveOpenAccessByDoi,
  type PubmedSummary,
} from "@/lib/pubmed-sync-client";
import {
  AI_TERMS,
  MED_TERMS,
  dedupeTerms,
  normalizeToken,
} from "@/lib/pubmed-sync-rules";
import {
  buildPubmedQueryForKeyword,
  calculateAiMedScore,
  getJournalTierAndWeight,
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
  saveLlmSynonyms,
  upsertKeywordSyncedPaper,
  writeBackfillMonthOffset,
  writeSyncStateValue,
  type JournalTierWeightResult,
  type ProfileKeywordRow,
} from "@/server/repositories/pubmed-sync";

function toKeywordList(rows: ProfileKeywordRow[]) {
  const set = new Set<string>();
  for (const row of rows) {
    for (const k of row.subscription_keywords ?? []) {
      const v = normalizeToken(k);
      if (v) set.add(v);
    }
    for (const m of row.subscription_mesh_terms ?? []) {
      const v = normalizeToken(m);
      if (v) set.add(v);
    }
  }
  return Array.from(set);
}

function buildQueryFromKeywords(keywords: string[]) {
  const aiTerms = dedupeTerms(AI_TERMS);
  const medTerms = dedupeTerms([...MED_TERMS, ...keywords]).slice(0, 25);
  const aiJoined = aiTerms
    .map((k) => `"${k.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");
  const medJoined = medTerms
    .map((k) => `"${k.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");
  return `((${aiJoined}) AND (${medJoined})) AND ("last 7 days"[EDat])`;
}

function buildTopJournalQuery(journalTerms: string[]) {
  const topJournalTerms = dedupeTerms(journalTerms).slice(0, 40);
  if (!topJournalTerms.length) return null;
  const journalJoined = topJournalTerms
    .map((j) => `"${j.replace(/"/g, "")}"[jour]`)
    .join(" OR ");
  const aiJoined = dedupeTerms(AI_TERMS)
    .map((k) => `"${k.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");
  return `((${journalJoined}) AND (${aiJoined})) AND ("last 30 days"[EDat])`;
}

function buildTopJournalBackfillQuery(journalTerms: string[], fromDate: string, toDate: string) {
  const topJournalTerms = dedupeTerms(journalTerms).slice(0, 40);
  if (!topJournalTerms.length) return null;
  const journalJoined = topJournalTerms
    .map((j) => `"${j.replace(/"/g, "")}"[jour]`)
    .join(" OR ");
  const aiJoined = dedupeTerms(AI_TERMS)
    .map((k) => `"${k.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");
  return `((${journalJoined}) AND (${aiJoined})) AND ("${fromDate}"[Date - Publication] : "${toDate}"[Date - Publication])`;
}

function buildRecentJournalQuery(journalName: string) {
  const j = journalName.replace(/"/g, "").trim();
  if (!j) return null;
  return `"${j}"[Journal] AND ("last 30 days"[EDat])`;
}

function formatPubmedDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function buildJournalWindowQuery(journalName: string, fromDate: string, toDate: string) {
  const j = journalName.replace(/"/g, "").trim();
  if (!j) return null;
  return `"${j}"[Journal] AND (${fromDate}:${toDate}[dp])`;
}

function monthRangeByOffset(monthOffset: number) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  start.setUTCMonth(start.getUTCMonth() - monthOffset);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const fmt = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
  };
  return { fromDate: fmt(start), toDate: fmt(end) };
}

export async function runPubmedSyncJob() {
  const supabase = createServiceSupabaseClient();
  const journalMap = await loadJournalQualityMap(supabase);
  const topJournalTerms = await loadTopJournalTerms(supabase);
  const activeJournalNames = await loadActiveJournalNames(supabase);
  const profileRows = await loadActiveProfileKeywordRows(supabase);
  const keywords = toKeywordList(profileRows);
  const broadQuery = buildQueryFromKeywords(keywords);
  const broadIds = await pubmedEsearch(broadQuery, 200);
  const topJournalQuery = buildTopJournalQuery(topJournalTerms);
  const topJournalIds = topJournalQuery ? await pubmedEsearch(topJournalQuery, 300) : [];
  const byJournalIds: string[] = [];
  for (const name of activeJournalNames) {
    const q = buildRecentJournalQuery(name);
    if (!q) continue;
    const ids = await pubmedEsearch(q, 200);
    byJournalIds.push(...ids);
    await randomDelay(120, 220);
  }
  const ids = dedupeIdList([...topJournalIds, ...broadIds, ...byJournalIds]);

  const summaryChunks = chunk(ids, 20);
  const summaries: PubmedSummary[] = [];
  for (const group of summaryChunks) {
    const part = await pubmedEsummary(group);
    summaries.push(...part);
    await randomDelay(180, 320);
  }
  await enrichSummariesWithAbstracts(summaries);

  const { upsertRows, aiMedCount } = await scoreAndUpsertPapers({
    supabase,
    summaries,
    journalMap,
  });

  return {
    keywordCount: keywords.length,
    topJournalTermCount: topJournalTerms.length,
    topJournalFetchedCount: topJournalIds.length,
    activeJournalCount: activeJournalNames.length,
    byJournalFetchedCount: byJournalIds.length,
    fetchedCount: summaries.length,
    aiMedCount,
    upsertedCount: upsertRows.length,
    query: broadQuery,
    topJournalQuery,
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
  const summaryChunks = chunk(ids, 20);
  const summaries: PubmedSummary[] = [];
  for (const group of summaryChunks) {
    const part = await pubmedEsummary(group);
    summaries.push(...part);
    await randomDelay(180, 320);
  }
  await enrichSummariesWithAbstracts(summaries);

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
          const chunks = chunk(newPmids, 20);
          const summaries: PubmedSummary[] = [];
          for (const g of chunks) {
            const part = await pubmedEsummary(g);
            summaries.push(...part);
            await randomDelay(160, 260);
          }
          await enrichSummariesWithAbstracts(summaries);
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

export async function runKeywordSyncJob() {
  const supabase = createServiceSupabaseClient();

  const profiles = await loadProfileSubscriptionKeywordRows(supabase);

  const allKeywords = new Set<string>();
  for (const row of profiles) {
    for (const kw of row.subscription_keywords ?? []) {
      const v = kw.trim();
      if (v) allKeywords.add(v);
    }
  }

  const keywordList = Array.from(allKeywords);
  const syncWindows = [7, 30] as const;
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
  const stats = new KeywordSyncStats();

  for (const keyword of keywordList) {
    try {
      let pubmedQuery = "";

      const { data: keywordFlagData } = await getOrFlagKeyword(supabase, keyword);
      const flagRow = Array.isArray(keywordFlagData)
        ? (keywordFlagData[0] as any)
        : (keywordFlagData as any);
      const status = typeof flagRow?.status === "string" ? flagRow.status : "unknown";

      if (status === "cached") {
        const { data: queryData, error: qErr } = await buildPubmedQueryForKeyword(supabase, {
          keyword,
          daysBack: 7,
        });
        if (!qErr) pubmedQuery = extractPubmedQueryText(queryData);
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
          const { data: queryData, error: qErr } = await buildPubmedQueryForKeyword(supabase, {
            keyword,
            daysBack: 7,
          });
          if (!qErr) pubmedQuery = extractPubmedQueryText(queryData);
        }
      }

      if (!pubmedQuery) continue;

      for (const daysBack of syncWindows) {
        const { data: queryData, error: qErr } = await buildPubmedQueryForKeyword(supabase, {
          keyword,
          daysBack,
        });
        if (qErr) continue;
        const windowQuery = extractPubmedQueryText(queryData);
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
    };
  }

  const existing = await loadExistingPaperPmids(supabase, deduped);
  const newPmids = deduped.filter((id) => !existing.has(id));
  if (!newPmids.length) {
    return {
      keywordCount: keywordList.length,
      keywords: keywordList,
      windows: syncWindows,
      ...stats.buildSummary(keywordList),
      llmCalls,
    };
  }

  const summaryChunks = chunk(newPmids, 20);
  const summaries: PubmedSummary[] = [];
  for (const group of summaryChunks) {
    const part = await pubmedEsummary(group);
    summaries.push(...part);
    await randomDelay(180, 320);
  }
  await enrichSummariesWithAbstracts(summaries);
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

    const { data: journalInfoData } = await getJournalTierAndWeight(supabase, paper.journal ?? "");
    const journalRow = (Array.isArray(journalInfoData) ? journalInfoData[0] : journalInfoData) as
      | JournalTierWeightResult
      | undefined;
    const tier = (journalRow?.tier ?? "emerging") as "top" | "core" | "emerging";
    const isAiMed = Boolean(scoreObj.is_ai_med) && tier !== "emerging";
    const dynamic = computeDynamicQualityScore({
      aiMedScore: aiScore,
      baseWeight: journalRow?.weight == null ? 0.5 : Number(journalRow.weight),
      impactFactor: journalRow?.impact_factor ?? null,
      jcrQuartile: journalRow?.jcr ?? null,
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
  };
}
