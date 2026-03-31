import { NextResponse } from "next/server";

import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbPaper = {
  id: string;
  title: string;
  journal: string | null;
  publication_date: string | null;
  ai_med_score: number | null;
  quality_score: number | null;
  quality_tier: string | null;
  pubmed_url: string;
  is_open_access: boolean;
  oa_pdf_url: string | null;
  ai_analysis: Record<string, unknown> | null;
  mesh_terms: string[] | null;
  keywords: string[] | null;
};

type TopicRelationRow = {
  paper_id: string;
  confidence: number | null;
  research_topics: { slug: string; name_zh: string | null; name_en: string | null } | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function uniqNormalized(values: string[] | null | undefined) {
  const set = new Set<string>();
  for (const v of values ?? []) {
    const x = v.trim().toLowerCase();
    if (x) set.add(x);
  }
  return Array.from(set);
}

function mergeUniquePapers(...groups: DbPaper[][]) {
  const map = new Map<string, DbPaper>();
  for (const g of groups) {
    for (const p of g) {
      if (!map.has(p.id)) map.set(p.id, p);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const qa = a.quality_score ?? 0;
    const qb = b.quality_score ?? 0;
    if (qb !== qa) return qb - qa;
    const da = a.publication_date ?? "";
    const db = b.publication_date ?? "";
    return db.localeCompare(da);
  });
}

async function resolveBypassUserId(service: ReturnType<typeof createServiceSupabaseClient>) {
  const direct = getDevBypassUserId();
  if (direct) return direct;
  const seedEmail = getDevBypassSeedEmail();
  if (!seedEmail) return null;
  const { data } = await service
    .from("profiles")
    .select("id")
    .eq("contact_email", seedEmail)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const topicFilter = (searchParams.get("topic") ?? "").trim().toLowerCase();
  const token = getBearerToken(req);
  const service = createServiceSupabaseClient();
  const limit = 36;

  let userId: string | null = null;
  if (token) {
    const userClient = createUserSupabaseClient(token);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    userId = user?.id ?? null;
  }
  if (!userId && isDevBypassAuthEnabled()) {
    userId = await resolveBypassUserId(service);
  }

  let papers: DbPaper[] = [];
  let personalized = false;

  if (userId) {
    const { data: profile } = await service
      .from("profiles")
      .select("subscription_keywords, subscription_mesh_terms")
      .eq("id", userId)
      .single();

    const keywords = uniqNormalized(profile?.subscription_keywords);
    const meshTerms = uniqNormalized(profile?.subscription_mesh_terms);

    const [kwRes, meshRes] = await Promise.all([
      keywords.length
        ? service
            .from("papers")
            .select(
              "id,title,journal,publication_date,ai_med_score,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,mesh_terms,keywords",
            )
            .eq("is_ai_med", true)
            .overlaps("keywords", keywords)
            .order("quality_score", { ascending: false })
            .order("ai_med_score", { ascending: false })
            .order("publication_date", { ascending: false })
            .limit(limit)
        : Promise.resolve({ data: [] as DbPaper[] }),
      meshTerms.length
        ? service
            .from("papers")
            .select(
              "id,title,journal,publication_date,ai_med_score,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,mesh_terms,keywords",
            )
            .eq("is_ai_med", true)
            .overlaps("mesh_terms", meshTerms)
            .order("quality_score", { ascending: false })
            .order("ai_med_score", { ascending: false })
            .order("publication_date", { ascending: false })
            .limit(limit)
        : Promise.resolve({ data: [] as DbPaper[] }),
    ]);

    papers = mergeUniquePapers(
      (kwRes.data ?? []) as DbPaper[],
      (meshRes.data ?? []) as DbPaper[],
    ).slice(0, limit);

    personalized = papers.length > 0;
  }

  if (!papers.length) {
    const { data } = await service
      .from("papers")
      .select(
        "id,title,journal,publication_date,ai_med_score,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,mesh_terms,keywords",
      )
      .eq("is_ai_med", true)
      .order("quality_score", { ascending: false })
      .order("ai_med_score", { ascending: false })
      .order("publication_date", { ascending: false })
      .limit(limit);
    papers = (data ?? []) as DbPaper[];
  }

  if (topicFilter && papers.length) {
    const ids = papers.map((p) => p.id);
    const { data: relRows } = await service
      .from("paper_research_topics")
      .select("paper_id,research_topics!inner(slug)")
      .eq("research_topics.slug", topicFilter)
      .in("paper_id", ids);
    const allowed = new Set((relRows ?? []).map((r) => r.paper_id));
    papers = papers.filter((p) => allowed.has(p.id));
  }

  const interactions = new Map<string, { pdf_emailed_at: string | null }>();
  if (userId && papers.length) {
    const paperIds = papers.map((p) => p.id);
    const { data } = await service
      .from("user_paper_interactions")
      .select("paper_id,pdf_emailed_at")
      .eq("user_id", userId)
      .in("paper_id", paperIds);
    for (const row of data ?? []) {
      interactions.set(row.paper_id, { pdf_emailed_at: row.pdf_emailed_at });
    }
  }

  const topicMap = new Map<
    string,
    Array<{ slug: string; nameZh: string | null; nameEn: string | null; confidence: number }>
  >();
  if (papers.length) {
    const paperIds = papers.map((p) => p.id);
    const { data: topicRows } = await service
      .from("paper_research_topics")
      .select("paper_id,confidence,research_topics(slug,name_zh,name_en)")
      .in("paper_id", paperIds);
    for (const row of (topicRows ?? []) as unknown as TopicRelationRow[]) {
      const t = row.research_topics;
      if (!t) continue;
      const curr = topicMap.get(row.paper_id) ?? [];
      curr.push({
        slug: t.slug,
        nameZh: t.name_zh,
        nameEn: t.name_en,
        confidence: Number(row.confidence ?? 0),
      });
      topicMap.set(row.paper_id, curr);
    }
  }

  const mapped = papers.map((p) => ({
    id: p.id,
    title: p.title,
    journal: p.journal,
    publicationDate: p.publication_date,
    qualityScore: p.quality_score,
    qualityTier: p.quality_tier,
    pubmedUrl: p.pubmed_url,
    isOpenAccess: p.is_open_access,
    oaPdfUrl: p.oa_pdf_url,
    aiAnalysis: p.ai_analysis,
    tags: [...(p.keywords ?? []).slice(0, 2), ...(p.mesh_terms ?? []).slice(0, 1)],
    topics: (topicMap.get(p.id) ?? [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .map((t) => ({ slug: t.slug, nameZh: t.nameZh, nameEn: t.nameEn })),
    pdfEmailedAt: interactions.get(p.id)?.pdf_emailed_at ?? null,
  }));

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);
  const featured =
    mapped.find((m) => (m.publicationDate ?? "") >= sevenDaysAgoStr) ?? mapped[0] ?? null;
  const items = featured ? mapped.filter((m) => m.id !== featured.id) : mapped;

  return NextResponse.json({
    personalized,
    requiresLogin: !userId && !isDevBypassAuthEnabled(),
    devBypassAuth: isDevBypassAuthEnabled(),
    devBypassUserId: isDevBypassAuthEnabled() ? userId : null,
    devBypassSeedEmail: isDevBypassAuthEnabled() ? getDevBypassSeedEmail() : null,
    featured,
    items,
    total: mapped.length,
  });
}
