import { NextResponse } from "next/server";

import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
import { generateRecommendations } from "@/lib/recommendation-engine";
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
  topic_id?: string;
  research_topics: { slug: string; name_zh: string | null; name_en: string | null } | null;
};

type ProfileRow = {
  top_journals_only: boolean | null;
  subscription_min_score: number | string | null;
};

type FeedRecommendationRow = {
  paper_id: string;
  source_type: "precision" | "trending" | "serendipity";
  recommendation_score: number | null;
  reason: string | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toSafeMinScore(value: ProfileRow["subscription_min_score"] | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
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
  const page = clamp(Number(searchParams.get("page") ?? 1) || 1, 1, 1000);
  const pageSize = clamp(Number(searchParams.get("pageSize") ?? 12) || 12, 1, 50);
  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize - 1;
  const token = getBearerToken(req);
  const service = createServiceSupabaseClient();

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

  let topOnly = false;
  let minScore = 0;
  let subscribedTopicIds: string[] = [];

  if (userId) {
    const { data: profile } = await service
      .from("profiles")
      .select("top_journals_only,subscription_min_score")
      .eq("id", userId)
      .maybeSingle();
    topOnly = Boolean((profile as ProfileRow | null)?.top_journals_only);
    minScore = toSafeMinScore((profile as ProfileRow | null)?.subscription_min_score);

    const { data: subRows } = await service
      .from("user_topic_subscriptions")
      .select("topic_id")
      .eq("user_id", userId);
    subscribedTopicIds = Array.from(new Set((subRows ?? []).map((r) => r.topic_id)));
  }

  const hasSubscription = subscribedTopicIds.length > 0;
  const today = new Date().toISOString().slice(0, 10);
  let recommendationRows: FeedRecommendationRow[] = [];
  let total = 0;
  let recommendationMode = false;

  if (userId && hasSubscription && !topicFilter) {
    const loadRecommendations = async () =>
      service
        .from("feed_recommendations")
        .select("paper_id,source_type,recommendation_score,reason", { count: "exact" })
        .eq("user_id", userId)
        .eq("batch_date", today)
        .order("recommendation_score", { ascending: false })
        .range(fromIndex, toIndex);

    let recRes = await loadRecommendations();
    if (recRes.error) {
      return NextResponse.json({ error: recRes.error.message }, { status: 500 });
    }
    if (!(recRes.data ?? []).length) {
      await generateRecommendations({ user_id: userId, batch_date: today });
      recRes = await loadRecommendations();
      if (recRes.error) {
        return NextResponse.json({ error: recRes.error.message }, { status: 500 });
      }
    }
    recommendationRows = (recRes.data ?? []) as FeedRecommendationRow[];
    total = recRes.count ?? 0;
    recommendationMode = recommendationRows.length > 0;
  }

  let topicFilterId: string | null = null;
  if (!recommendationMode && topicFilter) {
    const { data: topic } = await service
      .from("research_topics")
      .select("id")
      .eq("slug", topicFilter)
      .maybeSingle();
    topicFilterId = topic?.id ?? null;
    if (!topicFilterId) {
      return NextResponse.json({
        papers: [],
        total: 0,
        page,
        pageSize,
        personalized: false,
        hasSubscription: subscribedTopicIds.length > 0,
        requiresLogin: !userId && !isDevBypassAuthEnabled(),
      });
    }
  }

  let paperRows: DbPaper[] = [];
  if (recommendationMode) {
    const paperIds = recommendationRows.map((row) => row.paper_id);
    const { data: papers, error: paperErr } = await service
      .from("papers")
      .select(
        "id,title,journal,publication_date,ai_med_score,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,mesh_terms,keywords",
      )
      .in("id", paperIds);
    if (paperErr) {
      return NextResponse.json({ error: paperErr.message }, { status: 500 });
    }
    const indexMap = new Map(paperIds.map((id, index) => [id, index]));
    paperRows = ((papers ?? []) as DbPaper[]).sort(
      (a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0),
    );
  } else {
    const candidateTopicIds = hasSubscription ? subscribedTopicIds : [];
    let filterTopicIds = candidateTopicIds;
    if (topicFilterId) {
      filterTopicIds = hasSubscription
        ? candidateTopicIds.filter((id) => id === topicFilterId)
        : [topicFilterId];
    }

    let paperIdFilter: string[] | null = null;
    if ((hasSubscription && filterTopicIds.length > 0) || (!hasSubscription && topicFilterId)) {
      const { data: relRows, error: relErr } = await service
        .from("paper_research_topics")
        .select("paper_id,topic_id")
        .in("topic_id", filterTopicIds);
      if (relErr) {
        return NextResponse.json({ error: relErr.message }, { status: 500 });
      }
      paperIdFilter = Array.from(new Set((relRows ?? []).map((r) => r.paper_id)));
      if (!paperIdFilter.length) {
        return NextResponse.json({
          papers: [],
          total: 0,
          page,
          pageSize,
          personalized: hasSubscription,
          hasSubscription,
          requiresLogin: !userId && !isDevBypassAuthEnabled(),
        });
      }
    } else if (hasSubscription && !topicFilterId && !filterTopicIds.length) {
      return NextResponse.json({
        papers: [],
        total: 0,
        page,
        pageSize,
        personalized: true,
        hasSubscription: true,
        requiresLogin: !userId && !isDevBypassAuthEnabled(),
      });
    }

    let query = service
      .from("papers")
      .select(
        "id,title,journal,publication_date,ai_med_score,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,mesh_terms,keywords",
        { count: "exact" },
      )
      .eq("is_ai_med", true)
      .gte("quality_score", minScore);

    if (topOnly) {
      query = query.in("quality_tier", ["top", "core"]);
    }
    if (paperIdFilter) {
      query = query.in("id", paperIdFilter);
    }

    const { data: papers, error: paperErr, count } = await query
      .order("quality_score", { ascending: false })
      .order("ai_med_score", { ascending: false })
      .order("publication_date", { ascending: false })
      .range(fromIndex, toIndex);
    if (paperErr) {
      return NextResponse.json({ error: paperErr.message }, { status: 500 });
    }
    paperRows = (papers ?? []) as DbPaper[];
    total = count ?? 0;
  }
  const interactions = new Map<string, { pdf_emailed_at: string | null }>();
  if (userId && paperRows.length) {
    const paperIds = paperRows.map((p) => p.id);
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
  if (paperRows.length) {
    const paperIds = paperRows.map((p) => p.id);
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

  const mapped = paperRows.map((p) => ({
    id: p.id,
    title: p.title,
    journal: p.journal ?? "PubMed",
    publication_date: p.publication_date,
    quality_score: Number(p.quality_score ?? 0),
    quality_tier: ((p.quality_tier ?? "emerging").toLowerCase() as "top" | "core" | "emerging"),
    pubmed_url: p.pubmed_url,
    is_open_access: p.is_open_access,
    oa_pdf_url: p.oa_pdf_url,
    ai_analysis: p.ai_analysis
      ? {
          summary_zh:
            typeof p.ai_analysis.summary_zh === "string" ? p.ai_analysis.summary_zh : "",
          background:
            typeof p.ai_analysis.background === "string" ? p.ai_analysis.background : "",
          method: typeof p.ai_analysis.method === "string" ? p.ai_analysis.method : "",
          value: typeof p.ai_analysis.value === "string" ? p.ai_analysis.value : "",
        }
      : null,
    topics: (topicMap.get(p.id) ?? [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .map((t) => ({ name_zh: t.nameZh ?? t.nameEn ?? t.slug, confidence: t.confidence })),
    source_type: recommendationRows.find((row) => row.paper_id === p.id)?.source_type ?? "precision",
    recommendation_score:
      Number(recommendationRows.find((row) => row.paper_id === p.id)?.recommendation_score ?? p.quality_score ?? 0),
    recommendation_reason: recommendationRows.find((row) => row.paper_id === p.id)?.reason ?? null,
    pdf_emailed_at: interactions.get(p.id)?.pdf_emailed_at ?? null,
  }));

  return NextResponse.json({
    papers: mapped,
    total,
    page,
    pageSize,
    personalized: hasSubscription,
    hasSubscription,
    requiresLogin: !userId && !isDevBypassAuthEnabled(),
    devBypassAuth: isDevBypassAuthEnabled(),
    devBypassUserId: isDevBypassAuthEnabled() ? userId : null,
    devBypassSeedEmail: isDevBypassAuthEnabled() ? getDevBypassSeedEmail() : null,
  });
}
