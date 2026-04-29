import {
  fetchSemanticScholarPaperBatch,
  fetchSemanticScholarRecommendations,
  type SemanticScholarPaper,
} from "@/lib/semantic-scholar-client";
import {
  isReviewLikePublicationType,
  isReviewLikePaper,
  isReviewLikeTitle,
} from "@/lib/paper-article-type";
import { loadPubmedSummariesByIds } from "@/lib/pubmed-summary-loader";
import {
  pubmedEsearch,
  randomDelay,
  type PubmedSummary,
} from "@/lib/pubmed-sync-client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  listSemanticScholarCandidatesForQualityRefresh,
  listSemanticScholarCandidatesForPromotionDryRun,
  listPapersForSemanticScholarEnrichment,
  listSemanticScholarRecommendationSeeds,
  loadKnownPaperDois,
  loadKnownSemanticScholarIds,
  loadSemanticScholarEnrichmentPaperIdsByS2Ids,
  purgeExpiredSemanticScholarCandidates,
  updateSemanticScholarCandidateQualityRows,
  updateSemanticScholarCandidatePromotionRows,
  upsertSemanticScholarCandidates,
  upsertSemanticScholarEnrichments,
  type PaperForSemanticScholarEnrichment,
  type SemanticScholarCandidateRow,
  type SemanticScholarCandidatePromotionRow,
  type SemanticScholarCandidatePromotionUpdate,
  type SemanticScholarCandidateQualityRefreshRow,
  type SemanticScholarCandidateQualityUpdate,
  type SemanticScholarEnrichmentRow,
} from "@/server/repositories/semantic-scholar";
import { calculateAiMedScore } from "@/server/repositories/pubmed-sync";

export type SemanticScholarEnrichmentOptions = {
  batchSize?: number;
  staleDays?: number;
};

export type SemanticScholarDiscoveryOptions = {
  seedLimit?: number;
  recommendationLimit?: number;
  minSeedCitationCount?: number;
  candidateTtlDays?: number;
};

export type SemanticScholarCandidateQualityOptions = {
  limit?: number;
};

export type SemanticScholarPromotionDryRunOptions = {
  limit?: number;
  includeRejected?: boolean;
  updateCandidates?: boolean;
};

export type SemanticScholarCandidateQuality = {
  score: number;
  eligibleForPromotion: boolean;
  isReviewLike: boolean;
  reasons: string[];
  signals: {
    hasDoi: boolean;
    hasPmid: boolean;
    hasMedicalField: boolean;
    hasAiField: boolean;
    hasSubstantialAbstract: boolean;
    citationCount: number;
    influentialCitationCount: number;
  };
};

export type SemanticScholarPromotionDecision = {
  wouldPromote: boolean;
  promotionScore: number;
  reasons: string[];
};

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDoi(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "") ?? "";
}

function normalizeDoiLikeIdentifier(value: string | null | undefined) {
  const doi = normalizeDoi(value);
  return /^10\.\d{4,9}\//i.test(doi) ? doi : "";
}

function normalizePmid(value: string | number | null | undefined) {
  return String(value ?? "").trim();
}

function isNumericPmid(value: string | null | undefined) {
  return Boolean(value && /^\d+$/.test(value));
}

function dedupeStrings(values: Array<string | null | undefined>, maxItems = 50) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function addDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function buildSemanticScholarLookupId(paper: {
  doi?: string | null;
  pmid: string;
}) {
  const doi = normalizeDoi(paper.doi) || normalizeDoiLikeIdentifier(paper.pmid);
  return doi ? `DOI:${doi}` : `PMID:${paper.pmid}`;
}

function externalIds(paper: SemanticScholarPaper) {
  return paper.externalIds && typeof paper.externalIds === "object"
    ? paper.externalIds
    : {};
}

function semanticScholarPaperMatchesSource(
  candidate: SemanticScholarPaper | null,
  source: PaperForSemanticScholarEnrichment,
) {
  if (!candidate) return false;
  const ids = externalIds(candidate);
  const pmid = normalizePmid(ids.PMID);
  const doi = normalizeDoi(asString(ids.DOI));
  const sourcePmid = normalizePmid(source.pmid);
  const sourceDoi = normalizeDoi(source.doi) || normalizeDoiLikeIdentifier(sourcePmid);
  return (
    (isNumericPmid(sourcePmid) && pmid === sourcePmid) ||
    Boolean(sourceDoi && doi === sourceDoi)
  );
}

function fieldsOfStudy(paper: SemanticScholarPaper) {
  return dedupeStrings([
    ...(Array.isArray(paper.fieldsOfStudy) ? paper.fieldsOfStudy : []),
    ...(Array.isArray(paper.s2FieldsOfStudy)
      ? paper.s2FieldsOfStudy.map((field) => field.category ?? null)
      : []),
  ]);
}

function publicationTypes(paper: SemanticScholarPaper) {
  return dedupeStrings(Array.isArray(paper.publicationTypes) ? paper.publicationTypes : []);
}

function hasField(fields: string[], pattern: RegExp) {
  return fields.some((field) => pattern.test(field));
}

function countWords(text: string | null | undefined) {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function clampQualityScore(value: number) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function quotePubmedSearchLiteral(value: string) {
  return `"${value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

export function buildPubmedLookupTermsForSemanticScholarCandidate(input: {
  doi?: string | null;
  pmid?: string | null;
}) {
  const doi = normalizeDoi(input.doi) || normalizeDoiLikeIdentifier(input.pmid);
  if (!doi) return [] as string[];
  const literal = quotePubmedSearchLiteral(doi);
  return [`${literal}[AID]`, `${literal}[DOI]`];
}

export function evaluateSemanticScholarPromotionDecision(args: {
  candidateEligible: boolean;
  candidateReviewLike: boolean;
  candidateQualityScore: number;
  pubmedVerified: boolean;
  isAiMed: boolean;
  aiMedScore: number;
  pubmedReviewLike: boolean;
}): SemanticScholarPromotionDecision {
  const reasons: string[] = [];
  if (args.candidateEligible) {
    reasons.push("candidate_quality_pass");
  } else {
    reasons.push("candidate_quality_hold");
  }
  if (args.candidateReviewLike) reasons.push("candidate_review_like");
  if (args.pubmedVerified) {
    reasons.push("pubmed_verified");
  } else {
    reasons.push("pubmed_not_verified");
  }
  if (args.isAiMed) {
    reasons.push("ai_med_score_pass");
  } else {
    reasons.push("ai_med_score_fail");
  }
  if (args.pubmedReviewLike) {
    reasons.push("pubmed_review_like");
  } else if (args.pubmedVerified) {
    reasons.push("pubmed_original_candidate");
  }

  const promotionScore = clampQualityScore(
    args.candidateQualityScore * 0.45 +
      args.aiMedScore * 0.45 +
      (args.pubmedVerified ? 0.1 : 0),
  );
  const wouldPromote =
    args.candidateEligible &&
    args.pubmedVerified &&
    args.isAiMed &&
    !args.candidateReviewLike &&
    !args.pubmedReviewLike &&
    promotionScore >= 0.6;

  reasons.push(wouldPromote ? "would_promote_after_review" : "dry_run_hold");

  return {
    wouldPromote,
    promotionScore,
    reasons: Array.from(new Set(reasons)),
  };
}

function qualityFromCandidateFields(input: {
  title: string | null;
  abstract: string | null;
  doi: string | null;
  pmid: string | null;
  openAccessPdfUrl: string | null;
  fieldsOfStudy: string[];
  publicationTypes: string[];
  citationCount: number;
  influentialCitationCount: number;
}): SemanticScholarCandidateQuality {
  const reasons: string[] = [];
  let score = 0;
  const abstractWords = countWords(input.abstract);
  const hasSubstantialAbstract = abstractWords >= 100;
  const hasMedicalField = hasField(input.fieldsOfStudy, /\bmedicine\b|\bhealth\b/i);
  const hasAiField = hasField(input.fieldsOfStudy, /\bcomputer science\b|\bengineering\b/i);
  const hasDoi = Boolean(input.doi);
  const hasPmid = Boolean(input.pmid);
  const isReviewLike =
    input.publicationTypes.some(isReviewLikePublicationType) ||
    isReviewLikeTitle(input.title);

  if (hasMedicalField) {
    score += 0.25;
    reasons.push("medical_field");
  } else {
    reasons.push("missing_medical_field");
  }

  if (hasAiField) {
    score += 0.12;
    reasons.push("ai_adjacent_field");
  }

  if (hasSubstantialAbstract) {
    score += 0.2;
    reasons.push("substantial_abstract");
  } else {
    reasons.push("weak_or_missing_abstract");
  }

  if (hasDoi) {
    score += 0.14;
    reasons.push("has_doi");
  }

  if (hasPmid) {
    score += 0.16;
    reasons.push("has_pmid");
  } else {
    reasons.push("needs_pubmed_verification");
  }

  if (input.citationCount >= 10) {
    score += 0.08;
    reasons.push("citation_signal");
  } else if (input.influentialCitationCount > 0) {
    score += 0.06;
    reasons.push("influential_citation_signal");
  }

  if (input.openAccessPdfUrl) {
    score += 0.05;
    reasons.push("has_oa_pdf");
  }

  if (isReviewLike) {
    score -= 0.3;
    reasons.push("review_like");
  }

  const normalizedScore = clampQualityScore(score);
  const eligibleForPromotion =
    normalizedScore >= 0.55 &&
    hasMedicalField &&
    hasSubstantialAbstract &&
    (hasDoi || hasPmid) &&
    !isReviewLike;

  if (!eligibleForPromotion) reasons.push("hold_for_review");

  return {
    score: normalizedScore,
    eligibleForPromotion,
    isReviewLike,
    reasons: Array.from(new Set(reasons)),
    signals: {
      hasDoi,
      hasPmid,
      hasMedicalField,
      hasAiField,
      hasSubstantialAbstract,
      citationCount: input.citationCount,
      influentialCitationCount: input.influentialCitationCount,
    },
  };
}

export function scoreSemanticScholarCandidatePaper(
  paper: SemanticScholarPaper,
): SemanticScholarCandidateQuality {
  const ids = externalIds(paper);
  return qualityFromCandidateFields({
    title: asString(paper.title),
    abstract: asString(paper.abstract),
    doi: normalizeDoi(asString(ids.DOI)) || null,
    pmid: normalizePmid(ids.PMID) || null,
    openAccessPdfUrl: asString(paper.openAccessPdf?.url),
    fieldsOfStudy: fieldsOfStudy(paper),
    publicationTypes: publicationTypes(paper),
    citationCount: asNumber(paper.citationCount) ?? 0,
    influentialCitationCount: asNumber(paper.influentialCitationCount) ?? 0,
  });
}

function scoreSemanticScholarCandidateRow(
  row: SemanticScholarCandidateQualityRefreshRow,
): SemanticScholarCandidateQuality {
  return qualityFromCandidateFields({
    title: row.title,
    abstract: row.abstract,
    doi: normalizeDoi(row.doi) || null,
    pmid: normalizePmid(row.pmid) || null,
    openAccessPdfUrl: row.open_access_pdf_url,
    fieldsOfStudy: dedupeStrings(row.fields_of_study ?? []),
    publicationTypes: dedupeStrings(row.publication_types ?? []),
    citationCount: asNumber(row.citation_count) ?? 0,
    influentialCitationCount: asNumber(row.influential_citation_count) ?? 0,
  });
}

async function resolvePubmedIdsForCandidate(candidate: Pick<SemanticScholarCandidatePromotionRow, "doi" | "pmid">) {
  const pmid = normalizePmid(candidate.pmid);
  if (isNumericPmid(pmid)) return [pmid];

  const terms = buildPubmedLookupTermsForSemanticScholarCandidate(candidate);
  const ids: string[] = [];
  for (const term of terms) {
    const found = await pubmedEsearch(term, 5);
    ids.push(...found);
    if (ids.length) break;
    await randomDelay(120, 220);
  }
  return dedupeStrings(ids, 5);
}

function chooseVerifiedPubmedSummary(
  candidate: Pick<SemanticScholarCandidatePromotionRow, "doi" | "pmid">,
  summaries: PubmedSummary[],
) {
  const candidatePmid = normalizePmid(candidate.pmid);
  const candidateDoi = normalizeDoi(candidate.doi) || normalizeDoiLikeIdentifier(candidate.pmid);
  return (
    summaries.find((summary) => isNumericPmid(candidatePmid) && summary.pmid === candidatePmid) ??
    summaries.find((summary) => candidateDoi && normalizeDoi(summary.doi) === candidateDoi) ??
    null
  );
}

function skippedPromotionUpdate(args: {
  candidate: SemanticScholarCandidatePromotionRow;
  checkedAt: string;
  reasons: string[];
}) {
  const decision = evaluateSemanticScholarPromotionDecision({
    candidateEligible: Boolean(args.candidate.eligible_for_promotion),
    candidateReviewLike: Boolean(args.candidate.is_review_like),
    candidateQualityScore: asNumber(args.candidate.quality_score) ?? 0,
    pubmedVerified: false,
    isAiMed: false,
    aiMedScore: 0,
    pubmedReviewLike: false,
  });
  return {
    s2_paper_id: args.candidate.s2_paper_id,
    pubmed_verification_status: "skipped" as const,
    pubmed_verified_pmid: null,
    pubmed_verified_at: null,
    promotion_score: decision.promotionScore,
    promotion_reasons: Array.from(new Set([...args.reasons, ...decision.reasons])),
    promotion_checked_at: args.checkedAt,
    promotion_dry_run_payload: {
      dryRun: true,
      wouldPromote: false,
      candidateTitle: args.candidate.title,
    },
    updated_at: args.checkedAt,
  };
}

export function mapSemanticScholarPaperToEnrichmentRow(args: {
  source: PaperForSemanticScholarEnrichment;
  paper: SemanticScholarPaper;
  enrichedAt?: string;
}): SemanticScholarEnrichmentRow {
  const paper = args.paper;
  const ids = externalIds(paper);
  return {
    paper_id: args.source.id,
    pmid: args.source.pmid,
    doi:
      normalizeDoi(asString(ids.DOI) ?? args.source.doi) ||
      normalizeDoiLikeIdentifier(args.source.pmid) ||
      null,
    s2_paper_id: asString(paper.paperId),
    corpus_id: paper.corpusId == null ? null : String(paper.corpusId),
    s2_url: asString(paper.url),
    title: asString(paper.title),
    venue: asString(paper.venue) ?? asString(paper.journal?.name),
    year: asNumber(paper.year),
    publication_date: asString(paper.publicationDate),
    reference_count: asNumber(paper.referenceCount),
    citation_count: asNumber(paper.citationCount) ?? 0,
    influential_citation_count: asNumber(paper.influentialCitationCount) ?? 0,
    is_open_access:
      typeof paper.isOpenAccess === "boolean" ? paper.isOpenAccess : null,
    open_access_pdf_url: asString(paper.openAccessPdf?.url),
    open_access_pdf_status: asString(paper.openAccessPdf?.status),
    fields_of_study: fieldsOfStudy(paper),
    publication_types: publicationTypes(paper),
    external_ids: ids,
    raw_payload: paper as Record<string, unknown>,
    last_enriched_at: args.enrichedAt ?? new Date().toISOString(),
  };
}

export function mapSemanticScholarUnmatchedToEnrichmentRow(args: {
  source: PaperForSemanticScholarEnrichment;
  lookupId: string;
  enrichedAt?: string;
}): SemanticScholarEnrichmentRow {
  const enrichedAt = args.enrichedAt ?? new Date().toISOString();
  return {
    paper_id: args.source.id,
    pmid: args.source.pmid,
    doi: normalizeDoi(args.source.doi) || normalizeDoiLikeIdentifier(args.source.pmid) || null,
    s2_paper_id: null,
    corpus_id: null,
    s2_url: null,
    title: args.source.title,
    venue: null,
    year: null,
    publication_date: null,
    reference_count: null,
    citation_count: 0,
    influential_citation_count: 0,
    is_open_access: null,
    open_access_pdf_url: null,
    open_access_pdf_status: null,
    fields_of_study: [],
    publication_types: [],
    external_ids: {},
    raw_payload: {
      unmatched: true,
      lookupId: args.lookupId,
      markedAt: enrichedAt,
    },
    last_enriched_at: enrichedAt,
  };
}

function mapSemanticScholarDuplicateToEnrichmentRow(args: {
  row: SemanticScholarEnrichmentRow;
  duplicateS2PaperId: string;
  enrichedAt: string;
}): SemanticScholarEnrichmentRow {
  return {
    ...args.row,
    s2_paper_id: null,
    corpus_id: null,
    s2_url: null,
    reference_count: null,
    citation_count: 0,
    influential_citation_count: 0,
    is_open_access: null,
    open_access_pdf_url: null,
    open_access_pdf_status: null,
    raw_payload: {
      duplicate: true,
      duplicateS2PaperId: args.duplicateS2PaperId,
      markedAt: args.enrichedAt,
    },
    last_enriched_at: args.enrichedAt,
  };
}

async function filterDuplicateSemanticScholarEnrichmentRows(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  rows: SemanticScholarEnrichmentRow[],
  enrichedAt: string,
) {
  const s2Ids = rows
    .map((row) => row.s2_paper_id)
    .filter((id): id is string => Boolean(id));
  const existingByS2Id = await loadSemanticScholarEnrichmentPaperIdsByS2Ids(supabase, s2Ids);
  const seenByS2Id = new Map<string, string>();
  const safeRows: SemanticScholarEnrichmentRow[] = [];
  let duplicateS2Count = 0;

  for (const row of rows) {
    const s2PaperId = row.s2_paper_id;
    if (!s2PaperId) {
      safeRows.push(row);
      continue;
    }

    const existingPaperId = existingByS2Id.get(s2PaperId);
    const seenPaperId = seenByS2Id.get(s2PaperId);
    if (
      (existingPaperId && existingPaperId !== row.paper_id) ||
      (seenPaperId && seenPaperId !== row.paper_id)
    ) {
      duplicateS2Count += 1;
      safeRows.push(
        mapSemanticScholarDuplicateToEnrichmentRow({
          row,
          duplicateS2PaperId: s2PaperId,
          enrichedAt,
        }),
      );
      continue;
    }

    seenByS2Id.set(s2PaperId, row.paper_id);
    safeRows.push(row);
  }

  return { rows: safeRows, duplicateS2Count };
}

function mapSemanticScholarPaperToCandidateRow(args: {
  paper: SemanticScholarPaper;
  seeds: Array<{ paper_id: string; pmid: string; s2_paper_id: string }>;
  expiresAt: string;
  updatedAt?: string;
}): SemanticScholarCandidateRow | null {
  const s2PaperId = asString(args.paper.paperId);
  const title = asString(args.paper.title);
  if (!s2PaperId || !title) return null;
  const ids = externalIds(args.paper);
  const doi = normalizeDoi(asString(ids.DOI)) || null;
  const pmid = normalizePmid(ids.PMID) || null;
  const quality = scoreSemanticScholarCandidatePaper(args.paper);
  return {
    s2_paper_id: s2PaperId,
    corpus_id: args.paper.corpusId == null ? null : String(args.paper.corpusId),
    doi,
    pmid,
    title,
    abstract: asString(args.paper.abstract),
    venue: asString(args.paper.venue) ?? asString(args.paper.journal?.name),
    year: asNumber(args.paper.year),
    publication_date: asString(args.paper.publicationDate),
    s2_url: asString(args.paper.url),
    open_access_pdf_url: asString(args.paper.openAccessPdf?.url),
    fields_of_study: fieldsOfStudy(args.paper),
    publication_types: publicationTypes(args.paper),
    citation_count: asNumber(args.paper.citationCount) ?? 0,
    influential_citation_count: asNumber(args.paper.influentialCitationCount) ?? 0,
    seed_s2_paper_ids: args.seeds.map((seed) => seed.s2_paper_id),
    seed_paper_ids: args.seeds.map((seed) => seed.paper_id),
    seed_pmids: args.seeds.map((seed) => seed.pmid),
    quality_score: quality.score,
    quality_reasons: quality.reasons,
    is_review_like: quality.isReviewLike,
    eligible_for_promotion: quality.eligibleForPromotion,
    status: quality.eligibleForPromotion ? "pending" : "rejected",
    raw_payload: args.paper as Record<string, unknown>,
    expires_at: args.expiresAt,
    updated_at: args.updatedAt ?? new Date().toISOString(),
  };
}

export async function runSemanticScholarEnrichmentJob(
  options: SemanticScholarEnrichmentOptions = {},
) {
  const batchSize = Math.max(1, Math.min(300, Math.floor(options.batchSize ?? 100)));
  const staleDays = Math.max(1, Math.min(180, Math.floor(options.staleDays ?? 30)));
  const supabase = createServiceSupabaseClient();
  const papers = await listPapersForSemanticScholarEnrichment(supabase, {
    limit: batchSize,
    staleBefore: dateDaysAgo(staleDays),
  });
  if (!papers.length) {
    return {
      selectedCount: 0,
      matchedCount: 0,
      upsertedCount: 0,
      unmatchedCount: 0,
      batchSize,
      staleDays,
    };
  }

  const ids = papers.map(buildSemanticScholarLookupId);
  const results = await fetchSemanticScholarPaperBatch(ids);
  const enrichedAt = new Date().toISOString();
  const rows: SemanticScholarEnrichmentRow[] = [];
  const unmatched: Array<{ pmid: string; lookupId: string }> = [];
  let matchedCount = 0;

  papers.forEach((paper, index) => {
    const result = results[index] ?? null;
    if (!result || !semanticScholarPaperMatchesSource(result, paper)) {
      unmatched.push({ pmid: paper.pmid, lookupId: ids[index] });
      if (!paper.previous_s2_paper_id) {
        rows.push(
          mapSemanticScholarUnmatchedToEnrichmentRow({
            source: paper,
            lookupId: ids[index],
            enrichedAt,
          }),
        );
      }
      return;
    }
    matchedCount += 1;
    rows.push(
      mapSemanticScholarPaperToEnrichmentRow({
        source: paper,
        paper: result,
        enrichedAt,
      }),
    );
  });

  const deduped = await filterDuplicateSemanticScholarEnrichmentRows(
    supabase,
    rows,
    enrichedAt,
  );
  const upsert = await upsertSemanticScholarEnrichments(supabase, deduped.rows);
  return {
    selectedCount: papers.length,
    matchedCount,
    upsertedCount: upsert.upsertedCount,
    duplicateS2Count: deduped.duplicateS2Count,
    unmatchedCount: unmatched.length,
    unmatched: unmatched.slice(0, 20),
    batchSize,
    staleDays,
  };
}

export async function runSemanticScholarDiscoveryJob(
  options: SemanticScholarDiscoveryOptions = {},
) {
  const seedLimit = Math.max(1, Math.min(30, Math.floor(options.seedLimit ?? 10)));
  const recommendationLimit = Math.max(
    1,
    Math.min(200, Math.floor(options.recommendationLimit ?? 50)),
  );
  const minSeedCitationCount = Math.max(
    0,
    Math.min(10_000, Math.floor(options.minSeedCitationCount ?? 5)),
  );
  const candidateTtlDays = Math.max(1, Math.min(90, Math.floor(options.candidateTtlDays ?? 30)));
  const supabase = createServiceSupabaseClient();
  await purgeExpiredSemanticScholarCandidates(supabase);

  const seeds = await listSemanticScholarRecommendationSeeds(supabase, {
    limit: seedLimit,
    minCitationCount: minSeedCitationCount,
  });
  if (!seeds.length) {
    return {
      seedCount: 0,
      fetchedCount: 0,
      candidateCount: 0,
      upsertedCount: 0,
      recommendationLimit,
    };
  }

  const recommendations = await fetchSemanticScholarRecommendations({
    positivePaperIds: seeds.map((seed) => seed.s2_paper_id),
    limit: recommendationLimit,
  });
  const s2Ids = recommendations
    .map((paper) => asString(paper.paperId))
    .filter((id): id is string => Boolean(id));
  const knownS2Ids = await loadKnownSemanticScholarIds(supabase, s2Ids);
  const dois = recommendations
    .map((paper) => normalizeDoi(asString(externalIds(paper).DOI)))
    .filter(Boolean);
  const knownDois = await loadKnownPaperDois(supabase, dois);
  const expiresAt = addDays(candidateTtlDays);

  const rows = recommendations
    .filter((paper) => {
      const s2PaperId = asString(paper.paperId);
      const doi = normalizeDoi(asString(externalIds(paper).DOI));
      if (!s2PaperId || knownS2Ids.has(s2PaperId)) return false;
      if (doi && knownDois.has(doi)) return false;
      return true;
    })
    .map((paper) =>
      mapSemanticScholarPaperToCandidateRow({
        paper,
        seeds,
        expiresAt,
      }),
    )
    .filter((row): row is SemanticScholarCandidateRow => Boolean(row));

  const upsert = await upsertSemanticScholarCandidates(supabase, rows);
  const eligibleCandidateCount = rows.filter((row) => row.eligible_for_promotion).length;
  const rejectedCandidateCount = rows.filter((row) => row.status === "rejected").length;
  const reviewLikeCandidateCount = rows.filter((row) => row.is_review_like).length;
  return {
    seedCount: seeds.length,
    fetchedCount: recommendations.length,
    candidateCount: rows.length,
    eligibleCandidateCount,
    rejectedCandidateCount,
    reviewLikeCandidateCount,
    upsertedCount: upsert.upsertedCount,
    recommendationLimit,
    candidateTtlDays,
  };
}

export async function runSemanticScholarCandidateQualityRefreshJob(
  options: SemanticScholarCandidateQualityOptions = {},
) {
  const limit = Math.max(1, Math.min(2000, Math.floor(options.limit ?? 500)));
  const supabase = createServiceSupabaseClient();
  const candidates = await listSemanticScholarCandidatesForQualityRefresh(supabase, {
    limit,
  });
  const updatedAt = new Date().toISOString();
  const updates: SemanticScholarCandidateQualityUpdate[] = candidates.map((candidate) => {
    const quality = scoreSemanticScholarCandidateRow(candidate);
    return {
      s2_paper_id: candidate.s2_paper_id,
      quality_score: quality.score,
      quality_reasons: quality.reasons,
      is_review_like: quality.isReviewLike,
      eligible_for_promotion: quality.eligibleForPromotion,
      status: quality.eligibleForPromotion ? "pending" : "rejected",
      updated_at: updatedAt,
    };
  });

  const updateResult = await updateSemanticScholarCandidateQualityRows(supabase, updates);
  return {
    scannedCount: candidates.length,
    updatedCount: updateResult.updatedCount,
    eligibleCount: updates.filter((row) => row.eligible_for_promotion).length,
    rejectedCount: updates.filter((row) => row.status === "rejected").length,
    reviewLikeCount: updates.filter((row) => row.is_review_like).length,
    limit,
  };
}

export async function runSemanticScholarPromotionDryRunJob(
  options: SemanticScholarPromotionDryRunOptions = {},
) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
  const includeRejected = Boolean(options.includeRejected);
  const updateCandidates = options.updateCandidates ?? true;
  const supabase = createServiceSupabaseClient();
  const candidates = await listSemanticScholarCandidatesForPromotionDryRun(supabase, {
    limit,
    includeRejected,
  });
  const checkedAt = new Date().toISOString();
  const updates: SemanticScholarCandidatePromotionUpdate[] = [];
  const results: Array<{
    s2PaperId: string;
    title: string;
    status: string;
    verifiedPmid: string | null;
    wouldPromote: boolean;
    promotionScore: number;
    reasons: string[];
  }> = [];

  for (const candidate of candidates) {
    if (!candidate.eligible_for_promotion || candidate.is_review_like) {
      const update = skippedPromotionUpdate({
        candidate,
        checkedAt,
        reasons: ["skipped_before_pubmed_lookup"],
      });
      updates.push(update);
      results.push({
        s2PaperId: candidate.s2_paper_id,
        title: candidate.title,
        status: update.pubmed_verification_status,
        verifiedPmid: null,
        wouldPromote: false,
        promotionScore: update.promotion_score,
        reasons: update.promotion_reasons,
      });
      continue;
    }

    try {
      const ids = await resolvePubmedIdsForCandidate(candidate);
      if (!ids.length) {
        const decision = evaluateSemanticScholarPromotionDecision({
          candidateEligible: Boolean(candidate.eligible_for_promotion),
          candidateReviewLike: Boolean(candidate.is_review_like),
          candidateQualityScore: asNumber(candidate.quality_score) ?? 0,
          pubmedVerified: false,
          isAiMed: false,
          aiMedScore: 0,
          pubmedReviewLike: false,
        });
        const update: SemanticScholarCandidatePromotionUpdate = {
          s2_paper_id: candidate.s2_paper_id,
          pubmed_verification_status: "not_found",
          pubmed_verified_pmid: null,
          pubmed_verified_at: null,
          promotion_score: decision.promotionScore,
          promotion_reasons: decision.reasons,
          promotion_checked_at: checkedAt,
          promotion_dry_run_payload: {
            dryRun: true,
            wouldPromote: false,
            candidateTitle: candidate.title,
          },
          updated_at: checkedAt,
        };
        updates.push(update);
        results.push({
          s2PaperId: candidate.s2_paper_id,
          title: candidate.title,
          status: update.pubmed_verification_status,
          verifiedPmid: null,
          wouldPromote: false,
          promotionScore: update.promotion_score,
          reasons: update.promotion_reasons,
        });
        continue;
      }

      const summaries = await loadPubmedSummariesByIds(ids, {
        chunkSize: 5,
        includeAbstracts: true,
      });
      const summary = chooseVerifiedPubmedSummary(candidate, summaries);
      if (!summary) {
        const decision = evaluateSemanticScholarPromotionDecision({
          candidateEligible: Boolean(candidate.eligible_for_promotion),
          candidateReviewLike: Boolean(candidate.is_review_like),
          candidateQualityScore: asNumber(candidate.quality_score) ?? 0,
          pubmedVerified: false,
          isAiMed: false,
          aiMedScore: 0,
          pubmedReviewLike: false,
        });
        const update: SemanticScholarCandidatePromotionUpdate = {
          s2_paper_id: candidate.s2_paper_id,
          pubmed_verification_status: "not_found",
          pubmed_verified_pmid: null,
          pubmed_verified_at: null,
          promotion_score: decision.promotionScore,
          promotion_reasons: [...decision.reasons, "pubmed_summary_mismatch"],
          promotion_checked_at: checkedAt,
          promotion_dry_run_payload: {
            dryRun: true,
            wouldPromote: false,
            candidateTitle: candidate.title,
            pubmedIds: ids,
          },
          updated_at: checkedAt,
        };
        updates.push(update);
        results.push({
          s2PaperId: candidate.s2_paper_id,
          title: candidate.title,
          status: update.pubmed_verification_status,
          verifiedPmid: null,
          wouldPromote: false,
          promotionScore: update.promotion_score,
          reasons: update.promotion_reasons,
        });
        continue;
      }

      const { data: rpcScore, error: rpcError } = await calculateAiMedScore(supabase, {
        title: summary.title,
        abstract: summary.abstract ?? candidate.abstract ?? "",
      });
      if (rpcError) {
        throw new Error(`calculate_ai_med_score failed: ${rpcError.message}`);
      }
      const scoreObj = (rpcScore ?? {}) as { is_ai_med?: boolean; score?: number | string };
      const isAiMed = Boolean(scoreObj.is_ai_med);
      const aiMedScore = asNumber(scoreObj.score) ?? 0;
      const pubmedReviewLike = isReviewLikePaper(summary);
      const decision = evaluateSemanticScholarPromotionDecision({
        candidateEligible: Boolean(candidate.eligible_for_promotion),
        candidateReviewLike: Boolean(candidate.is_review_like),
        candidateQualityScore: asNumber(candidate.quality_score) ?? 0,
        pubmedVerified: true,
        isAiMed,
        aiMedScore,
        pubmedReviewLike,
      });
      const update: SemanticScholarCandidatePromotionUpdate = {
        s2_paper_id: candidate.s2_paper_id,
        pubmed_verification_status: "verified",
        pubmed_verified_pmid: summary.pmid,
        pubmed_verified_at: checkedAt,
        promotion_score: decision.promotionScore,
        promotion_reasons: decision.reasons,
        promotion_checked_at: checkedAt,
        promotion_dry_run_payload: {
          dryRun: true,
          wouldPromote: decision.wouldPromote,
          candidateTitle: candidate.title,
          pubmedTitle: summary.title,
          pubmedDoi: summary.doi ?? null,
          aiMedScore,
          isAiMed,
          pubmedReviewLike,
        },
        updated_at: checkedAt,
      };
      updates.push(update);
      results.push({
        s2PaperId: candidate.s2_paper_id,
        title: candidate.title,
        status: update.pubmed_verification_status,
        verifiedPmid: summary.pmid,
        wouldPromote: decision.wouldPromote,
        promotionScore: decision.promotionScore,
        reasons: decision.reasons,
      });
      await randomDelay(120, 220);
    } catch (error) {
      const update: SemanticScholarCandidatePromotionUpdate = {
        s2_paper_id: candidate.s2_paper_id,
        pubmed_verification_status: "failed",
        pubmed_verified_pmid: null,
        pubmed_verified_at: null,
        promotion_score: 0,
        promotion_reasons: [
          "pubmed_lookup_failed",
          error instanceof Error ? error.message.slice(0, 160) : "unknown error",
        ],
        promotion_checked_at: checkedAt,
        promotion_dry_run_payload: {
          dryRun: true,
          wouldPromote: false,
          candidateTitle: candidate.title,
        },
        updated_at: checkedAt,
      };
      updates.push(update);
      results.push({
        s2PaperId: candidate.s2_paper_id,
        title: candidate.title,
        status: update.pubmed_verification_status,
        verifiedPmid: null,
        wouldPromote: false,
        promotionScore: 0,
        reasons: update.promotion_reasons,
      });
    }
  }

  const updateResult = updateCandidates
    ? await updateSemanticScholarCandidatePromotionRows(supabase, updates)
    : { updatedCount: 0 };

  return {
    scannedCount: candidates.length,
    updatedCount: updateResult.updatedCount,
    wouldPromoteCount: results.filter((result) => result.wouldPromote).length,
    verifiedCount: results.filter((result) => result.status === "verified").length,
    notFoundCount: results.filter((result) => result.status === "not_found").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    includeRejected,
    updateCandidates,
    limit,
    sample: results.slice(0, 10),
  };
}
