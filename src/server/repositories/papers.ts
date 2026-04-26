import type { createServiceSupabaseClient } from "@/lib/supabase/service";
import type {
  FeedPaper,
  PaperCard,
  PaperQualityTier,
  RecommendationSourceType,
} from "@/shared/contracts/papers";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from" | "rpc">;

export const FEED_PAPER_SELECT =
  "id,title,title_zh,journal_if,journal_jcr,journal_cas_zone,abstract,abstract_zh,journal,publication_date,ai_med_score,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,mesh_terms,keywords";

export const SPOTLIGHT_PAPER_SELECT =
  "id,title,title_zh,journal_if,journal_jcr,journal_cas_zone,abstract,abstract_zh,journal,publication_date,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,keywords,mesh_terms";

export type DbPaper = {
  id: string;
  title: string;
  title_zh?: string | null;
  journal_if?: number | null;
  journal_jcr?: string | null;
  journal_cas_zone?: string | null;
  abstract: string | null;
  abstract_zh: string | null;
  journal: string | null;
  publication_date: string | null;
  ai_med_score?: number | null;
  quality_score: number | null;
  quality_tier: string | null;
  pubmed_url: string | null;
  is_open_access: boolean | null;
  oa_pdf_url: string | null;
  ai_analysis: Record<string, unknown> | null;
  mesh_terms?: string[] | null;
  keywords?: string[] | null;
  final_score?: number | null;
  recommendation_reason?: string | null;
  source_type?: RecommendationSourceType | string | null;
};

export type PaperEmailInteraction = {
  pdf_emailed_at: string | null;
};

export type SearchPaperRow = {
  id: string;
  title: string | null;
  title_zh?: string | null;
  abstract: string | null;
  abstract_zh: string | null;
  journal: string | null;
  journal_if: number | null;
  journal_cas_zone: string | null;
  publication_date: string | null;
  pubmed_url: string | null;
  is_open_access: boolean | null;
  oa_pdf_url: string | null;
  is_ai_med: boolean | null;
  ai_med_score: number | null;
  quality_score: number | null;
  quality_tier: string | null;
  keywords: string[] | null;
  mesh_terms: string[] | null;
};

export type PersonalizedFeedResult = {
  paperRows: DbPaper[];
  total: number;
  page: number;
  pageSize: number;
};

function normalizeQualityTier(input: string | null | undefined): PaperQualityTier {
  const value = input?.toLowerCase();
  if (value === "top" || value === "core" || value === "emerging") return value;
  return "emerging";
}

function normalizeSourceType(
  input: RecommendationSourceType | string | null | undefined,
): RecommendationSourceType {
  if (input === "precision" || input === "trending" || input === "serendipity") {
    return input;
  }
  return "precision";
}

function normalizeAiAnalysis(input: Record<string, unknown> | null) {
  if (!input) return null;
  return {
    summary_zh: typeof input.summary_zh === "string" ? input.summary_zh : "",
    background: typeof input.background === "string" ? input.background : "",
    method: typeof input.method === "string" ? input.method : "",
    value: typeof input.value === "string" ? input.value : "",
  };
}

export function mapPaperToPaperCard(
  paper: DbPaper,
  options: {
    sourceType?: RecommendationSourceType | string | null;
    recommendationReason?: string | null;
    emailedAt?: string | null;
  } = {},
): PaperCard {
  return {
    id: paper.id,
    title: paper.title,
    title_zh: paper.title_zh ?? null,
    journal: paper.journal ?? "PubMed",
    journal_if: paper.journal_if ?? null,
    journal_jcr: paper.journal_jcr ?? null,
    journal_cas_zone: paper.journal_cas_zone ?? null,
    publication_date: paper.publication_date,
    quality_score: Number(paper.quality_score ?? 0),
    quality_tier: normalizeQualityTier(paper.quality_tier),
    pubmed_url: paper.pubmed_url ?? "https://pubmed.ncbi.nlm.nih.gov/",
    is_open_access: Boolean(paper.is_open_access),
    oa_pdf_url: paper.oa_pdf_url,
    abstract_zh: paper.abstract_zh,
    ai_analysis: normalizeAiAnalysis(paper.ai_analysis),
    source_type: normalizeSourceType(options.sourceType ?? paper.source_type),
    recommendation_reason: options.recommendationReason ?? paper.recommendation_reason ?? null,
    pdf_emailed_at: options.emailedAt ?? null,
  };
}

export function mapPaperToFeedPaper(
  paper: DbPaper,
  interactions: Map<string, PaperEmailInteraction>,
): FeedPaper {
  return {
    ...mapPaperToPaperCard(paper, {
      emailedAt: interactions.get(paper.id)?.pdf_emailed_at ?? null,
    }),
    topics: [],
    recommendation_score: Number(paper.final_score ?? paper.quality_score ?? 0),
  };
}

export function parsePersonalizedFeed(
  feedData: unknown,
  fallbackPage: number,
  fallbackPageSize: number,
): PersonalizedFeedResult {
  const asObject =
    feedData && typeof feedData === "object" ? (feedData as Record<string, unknown>) : null;
  const objectPapers = Array.isArray(asObject?.papers) ? (asObject.papers as DbPaper[]) : null;
  const rowsFromArray = Array.isArray(feedData) ? (feedData as DbPaper[]) : [];
  const paperRows = objectPapers?.length ? objectPapers : rowsFromArray;
  const firstRow = rowsFromArray[0] as Record<string, unknown> | undefined;

  return {
    paperRows,
    total:
      Number(asObject?.total ?? asObject?.total_count ?? firstRow?.total_count) ||
      paperRows.length,
    page: Number(asObject?.page ?? fallbackPage) || fallbackPage,
    pageSize:
      Number(asObject?.page_size ?? asObject?.pageSize ?? fallbackPageSize) ||
      fallbackPageSize,
  };
}

export async function getPersonalizedFeed(
  client: SupabaseDbClient,
  params: { userId: string; page: number; pageSize: number },
): Promise<PersonalizedFeedResult> {
  const { data, error } = await client.rpc("get_personalized_feed", {
    p_user_id: params.userId,
    p_page: params.page,
    p_page_size: params.pageSize,
  });
  if (error) {
    throw new Error(`Failed to fetch personalized feed: ${error.message}`);
  }
  return parsePersonalizedFeed(data, params.page, params.pageSize);
}

export async function listFallbackFeedPapers(
  client: SupabaseDbClient,
  params: { cutoffDate: string; fromIndex: number; toIndex: number },
) {
  const { data, error, count } = await client
    .from("papers")
    .select(FEED_PAPER_SELECT, { count: "exact" })
    .eq("is_ai_med", true)
    .in("quality_tier", ["top", "core"])
    .gte("publication_date", params.cutoffDate)
    .order("quality_score", { ascending: false })
    .order("publication_date", { ascending: false })
    .range(params.fromIndex, params.toIndex);
  if (error) {
    throw new Error(`Failed to load fallback feed papers: ${error.message}`);
  }
  const paperRows = (data ?? []) as DbPaper[];
  return {
    paperRows,
    total: count ?? paperRows.length,
  };
}

export async function listRecentQualityPapers(
  client: SupabaseDbClient,
  params: { cutoffDate: string; limit: number },
) {
  const { data, error } = await client
    .from("papers")
    .select(SPOTLIGHT_PAPER_SELECT)
    .eq("is_ai_med", true)
    .in("quality_tier", ["top", "core"])
    .gte("publication_date", params.cutoffDate)
    .order("quality_score", { ascending: false })
    .order("publication_date", { ascending: false })
    .limit(params.limit);
  if (error) {
    throw new Error(`Failed to load recent quality papers: ${error.message}`);
  }
  return (data ?? []) as DbPaper[];
}

export async function getPaperEmailInteractions(
  client: SupabaseDbClient,
  userId: string | null,
  paperIds: string[],
) {
  const interactions = new Map<string, PaperEmailInteraction>();
  if (!userId || !paperIds.length) return interactions;

  const { data, error } = await client
    .from("user_paper_interactions")
    .select("paper_id,pdf_emailed_at")
    .eq("user_id", userId)
    .in("paper_id", paperIds);
  if (error) {
    throw new Error(`Failed to load paper interactions: ${error.message}`);
  }

  for (const row of (data ?? []) as Array<{ paper_id: string; pdf_emailed_at: string | null }>) {
    interactions.set(row.paper_id, { pdf_emailed_at: row.pdf_emailed_at });
  }
  return interactions;
}

function paperMatchesTerms(paper: SearchPaperRow, terms: string[]) {
  if (!terms.length) return true;
  const haystack = [
    paper.title ?? "",
    paper.title_zh ?? "",
    paper.abstract ?? "",
    paper.abstract_zh ?? "",
    paper.journal ?? "",
    ...(paper.keywords ?? []),
    ...(paper.mesh_terms ?? []),
  ]
    .join("\n")
    .toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

export async function searchPapers(
  client: SupabaseDbClient,
  params: {
    terms: string[];
    tier?: string | null;
    from?: string | null;
    to?: string | null;
    openAccessOnly: boolean;
    ifMin?: number | null;
    ifMax?: number | null;
    fromIndex: number;
    toIndex: number;
  },
) {
  let query = client
    .from("papers")
    .select(
      "id,title,title_zh,abstract,abstract_zh,journal,journal_if,journal_cas_zone,publication_date,pubmed_url,is_open_access,oa_pdf_url,is_ai_med,ai_med_score,quality_score,quality_tier,keywords,mesh_terms",
    )
    .eq("is_ai_med", true);

  if (params.tier) {
    query = query.eq("quality_tier", params.tier);
  }
  if (params.from) {
    query = query.gte("publication_date", params.from);
  }
  if (params.to) {
    query = query.lte("publication_date", params.to);
  }
  if (params.openAccessOnly) {
    query = query.eq("is_open_access", true);
  }
  if (params.ifMin != null) {
    query = query.gte("journal_if", params.ifMin);
  }
  if (params.ifMax != null) {
    query = query.lte("journal_if", params.ifMax);
  }

  const { data, error } = await query
    .order("quality_score", { ascending: false })
    .order("ai_med_score", { ascending: false })
    .order("publication_date", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }

  let rows = (data ?? []) as SearchPaperRow[];
  if (params.terms.length) {
    rows = rows.filter((paper) => paperMatchesTerms(paper, params.terms));
  }

  return {
    total: rows.length,
    items: rows.slice(params.fromIndex, params.toIndex + 1),
  };
}
