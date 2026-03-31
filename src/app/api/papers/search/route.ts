import { NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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
      "id,pmid,title,journal,publication_date,pubmed_url,is_open_access,oa_pdf_url,is_ai_med,ai_med_score,quality_score,quality_tier,keywords,mesh_terms",
      { count: "exact" },
    )
    .eq("is_ai_med", true);

  if (q) {
    const escaped = q.replace(/,/g, " ");
    const isPmid = /^\d{6,12}$/.test(escaped);
    if (isPmid) {
      query = query.or(`pmid.eq.${escaped},title.ilike.%${escaped}%,journal.ilike.%${escaped}%`);
    } else {
      query = query.or(`title.ilike.%${escaped}%,journal.ilike.%${escaped}%`);
    }
  }
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

  const { data, count, error } = await query
    .order("quality_score", { ascending: false })
    .order("ai_med_score", { ascending: false })
    .order("publication_date", { ascending: false })
    .range(fromIndex, toIndex);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    page,
    pageSize,
    total: count ?? 0,
    items: data ?? [],
  });
}
