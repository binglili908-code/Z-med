import {
  fetchSemanticScholarPaperBatch,
  fetchSemanticScholarRecommendations,
  type SemanticScholarPaper,
} from "@/lib/semantic-scholar-client";
import {
  isReviewLikePublicationType,
  isReviewLikeTitle,
} from "@/lib/paper-article-type";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  listSemanticScholarCandidatesForQualityRefresh,
  listPapersForSemanticScholarEnrichment,
  listSemanticScholarRecommendationSeeds,
  loadKnownPaperDois,
  loadKnownSemanticScholarIds,
  purgeExpiredSemanticScholarCandidates,
  updateSemanticScholarCandidateQualityRows,
  upsertSemanticScholarCandidates,
  upsertSemanticScholarEnrichments,
  type PaperForSemanticScholarEnrichment,
  type SemanticScholarCandidateRow,
  type SemanticScholarCandidateQualityRefreshRow,
  type SemanticScholarCandidateQualityUpdate,
  type SemanticScholarEnrichmentRow,
} from "@/server/repositories/semantic-scholar";

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

  papers.forEach((paper, index) => {
    const result = results[index] ?? null;
    if (!result || !semanticScholarPaperMatchesSource(result, paper)) {
      unmatched.push({ pmid: paper.pmid, lookupId: ids[index] });
      return;
    }
    rows.push(
      mapSemanticScholarPaperToEnrichmentRow({
        source: paper,
        paper: result,
        enrichedAt,
      }),
    );
  });

  const upsert = await upsertSemanticScholarEnrichments(supabase, rows);
  return {
    selectedCount: papers.length,
    matchedCount: rows.length,
    upsertedCount: upsert.upsertedCount,
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
