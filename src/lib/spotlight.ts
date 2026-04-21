import { createServiceSupabaseClient } from "@/lib/supabase/service";

type DbPaper = {
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
  quality_score: number | null;
  quality_tier: string | null;
  pubmed_url: string | null;
  is_open_access: boolean | null;
  oa_pdf_url: string | null;
  ai_analysis: Record<string, unknown> | null;
};

type ProfileRow = {
  subscription_keywords: string[] | null;
  custom_journals: string[] | null;
};

export type SpotlightSourceType = "precision" | "trending" | "serendipity";

export type SpotlightPaper = {
  id: string;
  title: string;
  title_zh: string | null;
  journal: string;
  journal_if: number | null;
  journal_jcr: string | null;
  journal_cas_zone: string | null;
  publication_date: string | null;
  quality_score: number;
  quality_tier: "top" | "core" | "emerging";
  pubmed_url: string;
  is_open_access: boolean;
  oa_pdf_url: string | null;
  abstract_zh: string | null;
  ai_analysis: {
    summary_zh: string;
    background: string;
    method: string;
    value: string;
  } | null;
  source_type: SpotlightSourceType;
  recommendation_reason: string | null;
  pdf_emailed_at: string | null;
};

function normalizeList(values: string[] | null | undefined) {
  const set = new Set<string>();
  for (const raw of values ?? []) {
    const v = raw.trim().toLowerCase();
    if (v) set.add(v);
  }
  return Array.from(set);
}

function includesAnyKeyword(paper: DbPaper, keywords: string[]) {
  if (!keywords.length) return true;
  const text = [
    paper.title ?? "",
    paper.title_zh ?? "",
    paper.abstract ?? "",
    paper.abstract_zh ?? "",
    paper.ai_analysis ? JSON.stringify(paper.ai_analysis) : "",
  ]
    .join("\n")
    .toLowerCase();
  return keywords.some((kw) => text.includes(kw));
}

function toPaperOutput(
  paper: DbPaper,
  sourceType: SpotlightSourceType,
  reason: string | null,
  emailedAt: string | null,
): SpotlightPaper {
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
    quality_tier: ((paper.quality_tier ?? "emerging").toLowerCase() as "top" | "core" | "emerging"),
    pubmed_url: paper.pubmed_url ?? "https://pubmed.ncbi.nlm.nih.gov/",
    is_open_access: Boolean(paper.is_open_access),
    oa_pdf_url: paper.oa_pdf_url,
    abstract_zh: paper.abstract_zh,
    ai_analysis: paper.ai_analysis
      ? {
          summary_zh:
            typeof paper.ai_analysis.summary_zh === "string" ? paper.ai_analysis.summary_zh : "",
          background:
            typeof paper.ai_analysis.background === "string" ? paper.ai_analysis.background : "",
          method: typeof paper.ai_analysis.method === "string" ? paper.ai_analysis.method : "",
          value: typeof paper.ai_analysis.value === "string" ? paper.ai_analysis.value : "",
        }
      : null,
    source_type: sourceType,
    recommendation_reason: reason,
    pdf_emailed_at: emailedAt,
  };
}

function parseRpcPapers(feedData: unknown) {
  const asObject = feedData && typeof feedData === "object" ? (feedData as Record<string, unknown>) : null;
  const objectPapers = Array.isArray(asObject?.papers) ? (asObject.papers as DbPaper[]) : null;
  const rowsFromArray = Array.isArray(feedData) ? (feedData as DbPaper[]) : [];
  return objectPapers ?? rowsFromArray;
}

export async function buildSpotlightPapers(params: {
  userId: string | null;
  service?: ReturnType<typeof createServiceSupabaseClient>;
}) {
  const service = params.service ?? createServiceSupabaseClient();
  const { userId } = params;

  let hasProfileConfig = false;
  const journalTerms = new Set<string>();
  const keywords: string[] = [];

  if (userId) {
    const { data: profile } = await service
      .from("profiles")
      .select("subscription_keywords,custom_journals")
      .eq("id", userId)
      .maybeSingle();
    const p = profile as ProfileRow | null;
    for (const kw of normalizeList(p?.subscription_keywords)) keywords.push(kw);
    for (const j of normalizeList(p?.custom_journals)) journalTerms.add(j);
    hasProfileConfig = Boolean(journalTerms.size || keywords.length);
  }

  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let papers: DbPaper[] = [];

  if (userId) {
    const { data: feedData, error: rpcErr } = await service.rpc("get_personalized_feed", {
      p_user_id: userId,
      p_page: 1,
      p_page_size: 120,
    });
    if (rpcErr) {
      throw new Error(`Failed to load personalized spotlight feed: ${rpcErr.message}`);
    }
    papers = parseRpcPapers(feedData);
  } else {
    const { data: rows, error } = await service
      .from("papers")
      .select(
        "id,title,title_zh,journal_if,journal_jcr,journal_cas_zone,abstract,abstract_zh,journal,publication_date,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis",
      )
      .eq("is_ai_med", true)
      .in("quality_tier", ["top", "core"])
      .gte("publication_date", cutoffDate)
      .order("quality_score", { ascending: false })
      .order("publication_date", { ascending: false })
      .limit(240);
    if (error) {
      throw new Error(`Failed to load papers: ${error.message}`);
    }
    papers = (rows ?? []) as DbPaper[];
  }

  papers = papers.filter((paper) => {
    const d = paper.publication_date;
    if (!d) return false;
    const tier = (paper.quality_tier ?? "").toLowerCase();
    return d >= cutoffDate && (tier === "top" || tier === "core");
  });

  const scored = papers.map((paper) => {
    const journal = (paper.journal ?? "").trim().toLowerCase();
    const journalMatch =
      !journalTerms.size
        ? false
        : Array.from(journalTerms).some(
            (term) => journal === term || journal.includes(term) || term.includes(journal),
          );
    const keywordMatch = keywords.length ? includesAnyKeyword(paper, keywords) : false;
    const relevanceScore =
      (journalMatch ? 2 : 0) + (keywordMatch ? 2 : 0) + Number(paper.quality_score ?? 0) / 100;
    return { paper, journalMatch, keywordMatch, relevanceScore };
  });

  const used = new Set<string>();
  const choose = (candidates: typeof scored, n: number) => {
    const picked: typeof scored = [];
    for (const item of candidates) {
      if (picked.length >= n) break;
      if (used.has(item.paper.id)) continue;
      used.add(item.paper.id);
      picked.push(item);
    }
    return picked;
  };

  let relevantPool = scored;
  if (hasProfileConfig) {
    relevantPool = scored
      .filter((item) => item.relevanceScore > Number(item.paper.quality_score ?? 0) / 100)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
  const relevant = choose(relevantPool, 5);

  const remaining = scored
    .filter((item) => !used.has(item.paper.id))
    .sort((a, b) => Number(b.paper.quality_score ?? 0) - Number(a.paper.quality_score ?? 0));
  const trending = choose(remaining, 1);

  const serendipityPool = scored
    .filter((item) => !used.has(item.paper.id))
    .sort((a, b) => {
      if (a.relevanceScore !== b.relevanceScore) return a.relevanceScore - b.relevanceScore;
      return Number(b.paper.quality_score ?? 0) - Number(a.paper.quality_score ?? 0);
    });
  const serendipity = choose(serendipityPool, 1);

  const spotlight = [
    ...relevant.map((item) => ({
      paper: item.paper,
      source_type: "precision" as const,
      reason: "与您的期刊订阅与关键词偏好高度相关",
    })),
    ...trending.map((item) => ({
      paper: item.paper,
      source_type: "trending" as const,
      reason: "全局高质量热点文献",
    })),
    ...serendipity.map((item) => ({
      paper: item.paper,
      source_type: "serendipity" as const,
      reason: "与您的主方向交叉，可拓宽研究边界",
    })),
  ];

  if (spotlight.length < 7) {
    for (const item of remaining) {
      if (spotlight.length >= 7) break;
      if (used.has(item.paper.id)) continue;
      used.add(item.paper.id);
      spotlight.push({
        paper: item.paper,
        source_type: "precision" as const,
        reason: hasProfileConfig ? "与您的订阅偏好相关" : "近30天高分文献",
      });
    }
  }

  const interactions = new Map<string, string | null>();
  if (userId && spotlight.length) {
    const { data: interactionRows } = await service
      .from("user_paper_interactions")
      .select("paper_id,pdf_emailed_at")
      .eq("user_id", userId)
      .in(
        "paper_id",
        spotlight.map((item) => item.paper.id),
      );
    for (const row of interactionRows ?? []) {
      interactions.set(row.paper_id, row.pdf_emailed_at);
    }
  }

  const items = spotlight.map((item) =>
    toPaperOutput(item.paper, item.source_type, item.reason, interactions.get(item.paper.id) ?? null),
  );

  return { items, hasProfileConfig };
}
