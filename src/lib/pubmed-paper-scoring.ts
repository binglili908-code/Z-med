import type { createServiceSupabaseClient } from "@/lib/supabase/service";
import { computeDynamicQualityScore } from "@/lib/journal-score";
import {
  randomDelay,
  resolveOpenAccessByDoi,
  type PubmedSummary,
} from "@/lib/pubmed-sync-client";
import {
  AI_TERMS,
  MED_TERMS,
  TOPIC_KEYWORD_LIBRARY,
  dedupeTerms,
  findTermMatches,
} from "@/lib/pubmed-sync-rules";
import {
  calculateAiMedScore,
  loadPaperIdsByPmids,
  loadResearchTopicRefs,
  resolveJournalQuality,
  upsertPaperResearchTopicRows,
  upsertScoredPaperRows,
  type JournalQualityMatcher,
  type JournalQualityRow,
  type PaperTopicRelationRow,
} from "@/server/repositories/pubmed-sync";

type TopicRule = {
  slug: string;
  keywords: string[];
};

function aiMedSignals(paper: PubmedSummary, userKeywords: string[]) {
  const aiTerms = dedupeTerms(AI_TERMS);
  const medTerms = dedupeTerms([...MED_TERMS, ...userKeywords]);
  const sourceText = `${paper.title} ${(paper.mesh_terms ?? []).join(" ")}`.toLowerCase();
  const aiMatched = findTermMatches(sourceText, aiTerms);
  const medMatched = findTermMatches(sourceText, medTerms);
  const isAiMed = aiMatched.length > 0 && medMatched.length > 0;
  const scoreRaw =
    Math.min(aiMatched.length, 4) * 0.15 + Math.min(medMatched.length, 4) * 0.1;
  const aiMedScore = Number(Math.min(1, scoreRaw).toFixed(4));
  const topicKeywords = dedupeTerms([...aiMatched, ...medMatched]).slice(0, 16);
  return { isAiMed, aiMedScore, topicKeywords };
}

function buildTopicRulesFromSlugs(topicSlugs: string[]) {
  const rules: TopicRule[] = [];
  for (const slug of topicSlugs) {
    const parts = slug.toLowerCase().split(/[-_]/g);
    const terms = new Set<string>();
    for (const p of parts) {
      for (const kw of TOPIC_KEYWORD_LIBRARY[p] ?? []) terms.add(kw);
    }
    if (!terms.size) {
      for (const kw of TOPIC_KEYWORD_LIBRARY.decision) terms.add(kw);
    }
    rules.push({ slug, keywords: Array.from(terms) });
  }
  return rules;
}

function assignResearchTopics(paper: PubmedSummary, topicRules: TopicRule[]) {
  const sourceText = `${paper.title} ${(paper.mesh_terms ?? []).join(" ")} ${paper.journal ?? ""}`.toLowerCase();
  const topics: Array<{ slug: string; confidence: number; matchedTerms: string[] }> = [];

  for (const rule of topicRules) {
    const matchedTerms = findTermMatches(sourceText, rule.keywords);
    if (!matchedTerms.length) continue;
    const confidence = Number(
      Math.min(1, 0.35 + Math.min(0.65, matchedTerms.length * 0.18)).toFixed(4),
    );
    topics.push({
      slug: rule.slug,
      confidence,
      matchedTerms: matchedTerms.slice(0, 8),
    });
  }

  return topics;
}

function qualitySignals(args: {
  aiMedScore: number;
  journalMatched: JournalQualityRow | null;
}) {
  const dynamic = computeDynamicQualityScore({
    aiMedScore: args.aiMedScore,
    baseWeight: args.journalMatched?.weight ?? 0.5,
    impactFactor: args.journalMatched?.impact_factor ?? null,
    jcrQuartile: args.journalMatched?.jcr_quartile ?? null,
    casZone: args.journalMatched?.cas_zone ?? null,
  });
  const qualityTier = args.journalMatched?.tier ?? "emerging";
  return {
    qualityScore: dynamic.qualityScore,
    qualityTier,
    journalIf: dynamic.impactFactor,
    journalJcr: dynamic.jcrQuartile,
    journalCasZone: dynamic.casZone,
  };
}

export async function scoreAndUpsertPapers(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  summaries: PubmedSummary[];
  journalMap: JournalQualityMatcher;
}) {
  const upsertRows: Record<string, unknown>[] = [];
  const topicRefRows = await loadResearchTopicRefs(args.supabase);
  const topicIdMap = new Map<string, string>();
  const topicRules = buildTopicRulesFromSlugs((topicRefRows ?? []).map((r) => r.slug));
  for (const r of topicRefRows ?? []) {
    topicIdMap.set(r.slug, r.id);
  }

  const researchTopicsByPmid = new Map<
    string,
    Array<{ slug: string; confidence: number; matchedTerms: string[] }>
  >();

  for (const paper of args.summaries) {
    const keywordSignals = aiMedSignals(paper, []);
    const { data: rpcScore, error: rpcErr } = await calculateAiMedScore(args.supabase, {
      title: paper.title,
      abstract: paper.abstract ?? "",
    });
    if (rpcErr) {
      throw new Error(`Failed to score paper via calculate_ai_med_score: ${rpcErr.message}`);
    }
    const scoreObj = (rpcScore ?? {}) as { is_ai_med?: boolean; score?: number | string };
    const isAiMed = Boolean(scoreObj.is_ai_med);
    const aiMedScore = Number(scoreObj.score ?? 0);
    if (!isAiMed) continue;
    const journalMatched = resolveJournalQuality(paper, args.journalMap);
    const quality = qualitySignals({
      aiMedScore,
      journalMatched,
    });
    const oa = await resolveOpenAccessByDoi(paper.doi);
    upsertRows.push({
      pmid: paper.pmid,
      doi: paper.doi ?? null,
      title: paper.title,
      abstract: paper.abstract,
      journal: paper.journal,
      publication_date: paper.publication_date,
      pubmed_url: paper.pubmed_url,
      authors: paper.authors,
      mesh_terms: paper.mesh_terms,
      keywords: keywordSignals.topicKeywords,
      is_ai_med: true,
      ai_med_score: aiMedScore,
      quality_score: quality.qualityScore,
      quality_tier: quality.qualityTier,
      journal_if: quality.journalIf,
      journal_jcr: quality.journalJcr,
      journal_cas_zone: quality.journalCasZone,
      is_open_access: oa.is_open_access,
      oa_pdf_url: oa.oa_pdf_url,
      source_payload: paper.source_payload,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const assignedTopics = assignResearchTopics(paper, topicRules);
    if (assignedTopics.length) {
      researchTopicsByPmid.set(paper.pmid, assignedTopics);
    }
    await randomDelay(120, 220);
  }

  if (!upsertRows.length) {
    return { upsertRows, aiMedCount: 0 };
  }

  await upsertScoredPaperRows(args.supabase, upsertRows);

  const pmids = upsertRows.map((r) => String(r.pmid));
  const paperRows = await loadPaperIdsByPmids(args.supabase, pmids);

  const relationRows: PaperTopicRelationRow[] = [];

  for (const row of paperRows ?? []) {
    const assigned = researchTopicsByPmid.get(row.pmid) ?? [];
    for (const t of assigned) {
      const topicId = topicIdMap.get(t.slug);
      if (!topicId) continue;
      relationRows.push({
        paper_id: row.id,
        topic_id: topicId,
        confidence: t.confidence,
        source: "rule",
        matched_terms: t.matchedTerms,
        updated_at: new Date().toISOString(),
      });
    }
  }

  await upsertPaperResearchTopicRows(args.supabase, relationRows);

  return { upsertRows, aiMedCount: upsertRows.length };
}
