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
  title_zh?: string | null;
  journal_if?: number | null;
  journal_jcr?: string | null;
  journal_cas_zone?: string | null;
  abstract: string | null;
  abstract_zh: string | null;
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
  final_score?: number | null;
  recommendation_reason?: string | null;
};

type ProfileStatusRow = {
  is_active: boolean | null;
  subscription_keywords: string[] | null;
  custom_journals: string[] | null;
};

function normalizeStringList(input: string[] | null | undefined) {
  const set = new Set<string>();
  for (const raw of input ?? []) {
    const value = raw.trim();
    if (value) set.add(value);
  }
  return Array.from(set);
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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

  let subscriptionEnabled = false;
  let hasSubscriptionConfig = false;
  if (userId) {
    const { data: profile } = await service
      .from("profiles")
      .select("is_active,subscription_keywords,custom_journals")
      .eq("id", userId)
      .maybeSingle();
    const profileRow = profile as ProfileStatusRow | null;
    subscriptionEnabled = profileRow?.is_active !== false;
    hasSubscriptionConfig =
      subscriptionEnabled &&
      Boolean(
        normalizeStringList(profileRow?.subscription_keywords).length ||
          normalizeStringList(profileRow?.custom_journals).length,
      );
  }

  const mapPaper = (
    p: DbPaper & { recommendation_reason?: string | null; source_type?: "precision" | "trending" | "serendipity" },
    interactions: Map<string, { pdf_emailed_at: string | null }>,
  ) => ({
    id: p.id,
    title: p.title,
    title_zh: p.title_zh ?? null,
    journal: p.journal ?? "PubMed",
    journal_if: p.journal_if ?? null,
    journal_jcr: p.journal_jcr ?? null,
    journal_cas_zone: p.journal_cas_zone ?? null,
    publication_date: p.publication_date,
    quality_score: Number(p.quality_score ?? 0),
    quality_tier: ((p.quality_tier ?? "emerging").toLowerCase() as "top" | "core" | "emerging"),
    pubmed_url: p.pubmed_url,
    is_open_access: p.is_open_access,
    oa_pdf_url: p.oa_pdf_url,
    abstract_zh: p.abstract_zh,
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
    topics: [],
    source_type: p.source_type ?? ("precision" as const),
    recommendation_score: Number(p.final_score ?? p.quality_score ?? 0),
    recommendation_reason: p.recommendation_reason ?? null,
    pdf_emailed_at: interactions.get(p.id)?.pdf_emailed_at ?? null,
  });

  if (userId && hasSubscriptionConfig) {
    const { data: feedData, error: rpcErr } = await service.rpc("get_personalized_feed", {
      p_user_id: userId,
      p_page: page,
      p_page_size: pageSize,
    });
    if (rpcErr) {
      console.error("Feed RPC error:", rpcErr);
      return NextResponse.json({ error: "Failed to fetch feed" }, { status: 500 });
    }

    const asObject = feedData && typeof feedData === "object" ? (feedData as Record<string, unknown>) : null;
    const objectPapers = Array.isArray(asObject?.papers) ? (asObject?.papers as DbPaper[]) : null;
    const rowsFromObject = objectPapers ?? [];
    const rowsFromArray = Array.isArray(feedData) ? (feedData as DbPaper[]) : [];
    const paperRows = rowsFromObject.length ? rowsFromObject : rowsFromArray;

    const total =
      Number(
        asObject?.total ??
          asObject?.total_count ??
          (rowsFromArray.length ? (rowsFromArray[0] as Record<string, unknown>)?.total_count : undefined),
      ) || paperRows.length;
    const responsePage = Number(asObject?.page ?? page) || page;
    const responsePageSize = Number(asObject?.page_size ?? asObject?.pageSize ?? pageSize) || pageSize;

    const interactions = new Map<string, { pdf_emailed_at: string | null }>();
    if (paperRows.length) {
      const { data } = await service
        .from("user_paper_interactions")
        .select("paper_id,pdf_emailed_at")
        .eq("user_id", userId)
        .in("paper_id", paperRows.map((p) => p.id));
      for (const row of data ?? []) {
        interactions.set(row.paper_id, { pdf_emailed_at: row.pdf_emailed_at });
      }
    }

    return NextResponse.json({
      papers: paperRows.map((p) => mapPaper(p, interactions)),
      total,
      page: responsePage,
      pageSize: responsePageSize,
      personalized: true,
      hasSubscription: true,
      requiresLogin: false,
      devBypassAuth: isDevBypassAuthEnabled(),
      devBypassUserId: isDevBypassAuthEnabled() ? userId : null,
      devBypassSeedEmail: isDevBypassAuthEnabled() ? getDevBypassSeedEmail() : null,
    });
  }

  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: papers, error: paperErr } = await service
    .from("papers")
    .select(
      "id,title,title_zh,journal_if,journal_jcr,journal_cas_zone,abstract,abstract_zh,journal,publication_date,ai_med_score,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,mesh_terms,keywords",
    )
    .eq("is_ai_med", true)
    .in("quality_tier", ["top", "core"])
    .gte("publication_date", cutoffDate)
    .order("quality_score", { ascending: false })
    .order("publication_date", { ascending: false })
    .range(fromIndex, toIndex);
  if (paperErr) {
    return NextResponse.json({ error: paperErr.message }, { status: 500 });
  }

  const paperRows = (papers ?? []) as DbPaper[];
  const total = paperRows.length;
  const interactions = new Map<string, { pdf_emailed_at: string | null }>();

  const mapped = paperRows.map((p) => mapPaper(p, interactions));

  return NextResponse.json({
    papers: mapped,
    total,
    page,
    pageSize,
    personalized: false,
    hasSubscription: hasSubscriptionConfig,
    requiresLogin: !userId && !isDevBypassAuthEnabled(),
    devBypassAuth: isDevBypassAuthEnabled(),
    devBypassUserId: isDevBypassAuthEnabled() ? userId : null,
    devBypassSeedEmail: isDevBypassAuthEnabled() ? getDevBypassSeedEmail() : null,
  });
}
