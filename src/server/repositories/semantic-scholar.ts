import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type PaperForSemanticScholarEnrichment = {
  id: string;
  pmid: string;
  doi: string | null;
  title: string;
  fetched_at?: string | null;
};

export type SemanticScholarEnrichmentRow = {
  paper_id: string;
  pmid: string;
  doi: string | null;
  s2_paper_id: string | null;
  corpus_id: string | null;
  s2_url: string | null;
  title: string | null;
  venue: string | null;
  year: number | null;
  publication_date: string | null;
  reference_count: number | null;
  citation_count: number;
  influential_citation_count: number;
  is_open_access: boolean | null;
  open_access_pdf_url: string | null;
  open_access_pdf_status: string | null;
  fields_of_study: string[];
  publication_types: string[];
  external_ids: Record<string, unknown>;
  raw_payload: Record<string, unknown>;
  last_enriched_at: string;
};

export type SemanticScholarRecommendationSeed = {
  paper_id: string;
  pmid: string;
  s2_paper_id: string;
  citation_count: number | null;
};

export type SemanticScholarCandidateRow = {
  s2_paper_id: string;
  corpus_id: string | null;
  doi: string | null;
  pmid: string | null;
  title: string;
  abstract: string | null;
  venue: string | null;
  year: number | null;
  publication_date: string | null;
  s2_url: string | null;
  open_access_pdf_url: string | null;
  fields_of_study: string[];
  publication_types: string[];
  citation_count: number;
  influential_citation_count: number;
  seed_s2_paper_ids: string[];
  seed_paper_ids: string[];
  seed_pmids: string[];
  quality_score: number;
  quality_reasons: string[];
  is_review_like: boolean;
  eligible_for_promotion: boolean;
  status: "pending" | "promoted" | "rejected" | "expired";
  raw_payload: Record<string, unknown>;
  expires_at: string;
  updated_at: string;
};

export type SemanticScholarCandidateQualityRefreshRow = {
  s2_paper_id: string;
  doi: string | null;
  pmid: string | null;
  title: string;
  abstract: string | null;
  venue: string | null;
  open_access_pdf_url: string | null;
  fields_of_study: string[] | null;
  publication_types: string[] | null;
  citation_count: number | null;
  influential_citation_count: number | null;
  raw_payload: Record<string, unknown> | null;
  status: "pending" | "promoted" | "rejected" | "expired";
};

export type SemanticScholarCandidateQualityUpdate = {
  s2_paper_id: string;
  quality_score: number;
  quality_reasons: string[];
  is_review_like: boolean;
  eligible_for_promotion: boolean;
  status: "pending" | "rejected";
  updated_at: string;
};

export async function listPapersForSemanticScholarEnrichment(
  client: SupabaseDbClient,
  params: { limit: number; staleBefore: string },
) {
  const candidateLimit = Math.max(params.limit, Math.min(params.limit * 10, 1000));
  const { data: papers, error: paperError } = await client
    .from("papers")
    .select("id,pmid,doi,title,fetched_at")
    .eq("is_ai_med", true)
    .order("fetched_at", { ascending: true })
    .limit(candidateLimit);
  if (paperError) {
    throw new Error(`Failed to load papers for Semantic Scholar enrichment: ${paperError.message}`);
  }

  const paperRows = ((papers ?? []) as PaperForSemanticScholarEnrichment[]).filter(
    (paper) => Boolean(paper.id && paper.pmid && paper.title),
  );
  if (!paperRows.length) return [];

  const { data: existing, error: existingError } = await client
    .from("semantic_scholar_paper_enrichments")
    .select("paper_id,last_enriched_at")
    .in(
      "paper_id",
      paperRows.map((paper) => paper.id),
    );
  if (existingError) {
    throw new Error(
      `Failed to load Semantic Scholar enrichment state: ${existingError.message}. Apply sql/p10_semantic_scholar.sql first.`,
    );
  }

  const enrichedAtByPaperId = new Map(
    ((existing ?? []) as Array<{ paper_id: string; last_enriched_at: string | null }>).map(
      (row) => [row.paper_id, row.last_enriched_at],
    ),
  );

  return paperRows
    .filter((paper) => {
      const enrichedAt = enrichedAtByPaperId.get(paper.id);
      return !enrichedAt || enrichedAt < params.staleBefore;
    })
    .slice(0, params.limit);
}

export async function upsertSemanticScholarEnrichments(
  client: SupabaseDbClient,
  rows: SemanticScholarEnrichmentRow[],
) {
  if (!rows.length) return { upsertedCount: 0 };
  const { error } = await client
    .from("semantic_scholar_paper_enrichments")
    .upsert(rows, { onConflict: "paper_id" });
  if (error) {
    throw new Error(`Failed to upsert Semantic Scholar enrichments: ${error.message}`);
  }
  return { upsertedCount: rows.length };
}

export async function listSemanticScholarRecommendationSeeds(
  client: SupabaseDbClient,
  params: { limit: number; minCitationCount: number },
) {
  const { data, error } = await client
    .from("semantic_scholar_paper_enrichments")
    .select("paper_id,pmid,s2_paper_id,citation_count")
    .not("s2_paper_id", "is", null)
    .gte("citation_count", params.minCitationCount)
    .order("citation_count", { ascending: false })
    .limit(params.limit);
  if (error) {
    throw new Error(`Failed to load Semantic Scholar recommendation seeds: ${error.message}`);
  }

  return ((data ?? []) as SemanticScholarRecommendationSeed[]).filter((seed) =>
    Boolean(seed.s2_paper_id),
  );
}

export async function loadKnownSemanticScholarIds(
  client: SupabaseDbClient,
  s2PaperIds: string[],
) {
  if (!s2PaperIds.length) return new Set<string>();
  const { data: enrichments, error: enrichmentError } = await client
    .from("semantic_scholar_paper_enrichments")
    .select("s2_paper_id")
    .in("s2_paper_id", s2PaperIds);
  if (enrichmentError) {
    throw new Error(`Failed to load known Semantic Scholar ids: ${enrichmentError.message}`);
  }

  const { data: candidates, error: candidateError } = await client
    .from("semantic_scholar_candidates")
    .select("s2_paper_id")
    .in("s2_paper_id", s2PaperIds);
  if (candidateError) {
    throw new Error(`Failed to load existing Semantic Scholar candidates: ${candidateError.message}`);
  }

  return new Set([
    ...((enrichments ?? []) as Array<{ s2_paper_id: string | null }>)
      .map((row) => row.s2_paper_id)
      .filter((id): id is string => Boolean(id)),
    ...((candidates ?? []) as Array<{ s2_paper_id: string | null }>)
      .map((row) => row.s2_paper_id)
      .filter((id): id is string => Boolean(id)),
  ]);
}

export async function loadKnownPaperDois(client: SupabaseDbClient, dois: string[]) {
  const values = Array.from(new Set(dois.map((doi) => doi.trim()).filter(Boolean)));
  if (!values.length) return new Set<string>();
  const { data, error } = await client.from("papers").select("doi").in("doi", values);
  if (error) {
    throw new Error(`Failed to load known paper DOIs: ${error.message}`);
  }

  return new Set(
    ((data ?? []) as Array<{ doi: string | null }>)
      .map((row) => row.doi?.trim().toLowerCase())
      .filter((doi): doi is string => Boolean(doi)),
  );
}

export async function upsertSemanticScholarCandidates(
  client: SupabaseDbClient,
  rows: SemanticScholarCandidateRow[],
) {
  if (!rows.length) return { upsertedCount: 0 };
  const { error } = await client
    .from("semantic_scholar_candidates")
    .upsert(rows, { onConflict: "s2_paper_id" });
  if (error) {
    throw new Error(`Failed to upsert Semantic Scholar candidates: ${error.message}`);
  }
  return { upsertedCount: rows.length };
}

export async function listSemanticScholarCandidatesForQualityRefresh(
  client: SupabaseDbClient,
  params: { limit: number },
) {
  const { data, error } = await client
    .from("semantic_scholar_candidates")
    .select(
      "s2_paper_id,doi,pmid,title,abstract,venue,open_access_pdf_url,fields_of_study,publication_types,citation_count,influential_citation_count,raw_payload,status",
    )
    .in("status", ["pending", "rejected"])
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(params.limit);
  if (error) {
    throw new Error(`Failed to load Semantic Scholar candidates for quality refresh: ${error.message}`);
  }
  return (data ?? []) as SemanticScholarCandidateQualityRefreshRow[];
}

export async function updateSemanticScholarCandidateQualityRows(
  client: SupabaseDbClient,
  rows: SemanticScholarCandidateQualityUpdate[],
) {
  let updatedCount = 0;
  for (const row of rows) {
    const { s2_paper_id, ...patch } = row;
    const { error } = await client
      .from("semantic_scholar_candidates")
      .update(patch)
      .eq("s2_paper_id", s2_paper_id);
    if (error) {
      throw new Error(`Failed to update Semantic Scholar candidate quality: ${error.message}`);
    }
    updatedCount += 1;
  }
  return { updatedCount };
}

export async function purgeExpiredSemanticScholarCandidates(client: SupabaseDbClient) {
  const { error } = await client
    .from("semantic_scholar_candidates")
    .delete()
    .lt("expires_at", new Date().toISOString());
  if (error) {
    throw new Error(`Failed to purge expired Semantic Scholar candidates: ${error.message}`);
  }
}
