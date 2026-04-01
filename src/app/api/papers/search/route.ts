import { NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type SearchPaperRow = {
  id: string;
  pmid: string | number | null;
  title: string | null;
  abstract: string | null;
  journal: string | null;
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
  ai_analysis: Record<string, unknown> | null;
};

function normalizeSearchTerms(q: string) {
  const list = q
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(list));
}

function paperMatchesTerms(paper: SearchPaperRow, terms: string[]) {
  if (!terms.length) return true;
  const haystack = [
    String(paper.pmid ?? ""),
    paper.title ?? "",
    paper.abstract ?? "",
    paper.journal ?? "",
    paper.ai_analysis ? JSON.stringify(paper.ai_analysis) : "",
  ]
    .join("\n")
    .toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

export async function GET(req: Request) {
  const supabase = createServiceSupabaseClient();
  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") ?? "").trim();
  const tier = (searchParams.get("tier") ?? "").trim().toLowerCase();
  const from = (searchParams.get("from") ?? "").trim();
  const to = (searchParams.get("to") ?? "").trim();
  const oa = (searchParams.get("oa") ?? "").trim().toLowerCase();
  const topic = (searchParams.get("topic") ?? "").trim().toLowerCase();
  const page = clamp(Number(searchParams.get("page") ?? 1) || 1, 1, 1000);
  const pageSize = clamp(Number(searchParams.get("pageSize") ?? 20) || 20, 1, 50);
  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize - 1;

  let query = supabase
    .from("papers")
    .select(
      "id,pmid,title,abstract,journal,publication_date,pubmed_url,is_open_access,oa_pdf_url,is_ai_med,ai_med_score,quality_score,quality_tier,keywords,mesh_terms,ai_analysis",
    )
    .eq("is_ai_med", true);

  const terms = normalizeSearchTerms(q);
  if (tier) {
    query = query.eq("quality_tier", tier);
  }
  if (from) {
    query = query.gte("publication_date", from);
  }
  if (to) {
    query = query.lte("publication_date", to);
  }
  if (oa === "true") {
    query = query.eq("is_open_access", true);
  }

  if (topic) {
    const { data: topicRows, error: topicErr } = await supabase
      .from("paper_research_topics")
      .select("paper_id,research_topics!inner(slug)")
      .eq("research_topics.slug", topic);
    if (topicErr) {
      return NextResponse.json({ error: topicErr.message }, { status: 500 });
    }
    const ids = (topicRows ?? []).map((r) => r.paper_id);
    if (!ids.length) {
      return NextResponse.json({
        page,
        pageSize,
        total: 0,
        items: [],
      });
    }
    query = query.in("id", ids);
  }

  const { data, error } = await query
    .order("quality_score", { ascending: false })
    .order("ai_med_score", { ascending: false })
    .order("publication_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = (data ?? []) as SearchPaperRow[];
  if (terms.length) {
    rows = rows.filter((paper) => paperMatchesTerms(paper, terms));
  }
  const total = rows.length;
  const items = rows.slice(fromIndex, toIndex + 1);

  return NextResponse.json({
    page,
    pageSize,
    total,
    items,
  });
}
