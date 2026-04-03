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
};

type ProfileRow = {
  top_journals_only: boolean | null;
  subscription_keywords: string[] | null;
  custom_journals?: string[] | null;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeKeywordList(values: string[] | null | undefined) {
  const set = new Set<string>();
  for (const raw of values ?? []) {
    const v = raw.trim().toLowerCase();
    if (v) set.add(v);
  }
  return Array.from(set);
}

function matchesAnyKeyword(paper: DbPaper, keywords: string[]) {
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

  let topOnly = false;
  let profileKeywords: string[] = [];
  let hasProfileConfig = false;
  const subscribedJournalTerms = new Set<string>();

  if (userId) {
    const { data: profile } = await service
      .from("profiles")
      .select("top_journals_only,subscription_keywords,custom_journals")
      .eq("id", userId)
      .maybeSingle();
    topOnly = Boolean((profile as (ProfileRow & { custom_journals?: string[] | null }) | null)?.top_journals_only);
    profileKeywords = normalizeKeywordList((profile as ProfileRow | null)?.subscription_keywords);
    const customJournals = normalizeKeywordList(
      (profile as (ProfileRow & { custom_journals?: string[] | null }) | null)?.custom_journals,
    );

    const { data: journalSubs, error: journalSubsErr } = await service
      .from("user_journal_subscriptions")
      .select("journal_quality(journal_name,aliases)")
      .eq("user_id", userId);
    if (journalSubsErr) {
      return NextResponse.json({ error: journalSubsErr.message }, { status: 500 });
    }
    for (const row of journalSubs ?? []) {
      const j = Array.isArray(row.journal_quality) ? row.journal_quality[0] : row.journal_quality;
      const name = (j?.journal_name ?? "").trim().toLowerCase();
      if (name) subscribedJournalTerms.add(name);
      const aliases = Array.isArray(j?.aliases) ? (j.aliases as unknown[]) : [];
      for (const alias of aliases.filter((x): x is string => typeof x === "string")) {
        const v = alias.trim().toLowerCase();
        if (v) subscribedJournalTerms.add(v);
      }
    }
    for (const item of customJournals) {
      const v = item.trim().toLowerCase();
      if (v) subscribedJournalTerms.add(v);
    }
    hasProfileConfig = Boolean(profileKeywords.length || subscribedJournalTerms.size);
  }

  let query = service
    .from("papers")
    .select(
      "id,title,title_zh,abstract,abstract_zh,journal,publication_date,ai_med_score,quality_score,quality_tier,pubmed_url,is_open_access,oa_pdf_url,ai_analysis,mesh_terms,keywords",
    )
    .eq("is_ai_med", true);

  if (topOnly) {
    query = query.in("quality_tier", ["top", "core"]);
  }

  const { data: papers, error: paperErr } = await query
    .order("quality_score", { ascending: false })
    .order("ai_med_score", { ascending: false })
    .order("publication_date", { ascending: false });
  if (paperErr) {
    return NextResponse.json({ error: paperErr.message }, { status: 500 });
  }

  let orderedRows = (papers ?? []) as DbPaper[];
  if (subscribedJournalTerms.size) {
    orderedRows = orderedRows.filter((paper) => {
      const j = (paper.journal ?? "").trim().toLowerCase();
      if (!j) return false;
      for (const term of subscribedJournalTerms) {
        if (j === term || j.includes(term) || term.includes(j)) return true;
      }
      return false;
    });
  }
  if (profileKeywords.length) {
    orderedRows = orderedRows.filter((paper) => matchesAnyKeyword(paper, profileKeywords));
  }

  const total = orderedRows.length;
  const paperRows = orderedRows.slice(fromIndex, toIndex + 1);
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

  const mapped = paperRows.map((p) => ({
    id: p.id,
    title: p.title,
    title_zh: p.title_zh ?? null,
    journal: p.journal ?? "PubMed",
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
    source_type: "precision" as const,
    recommendation_score: Number(p.quality_score ?? 0),
    recommendation_reason: null as string | null,
    pdf_emailed_at: interactions.get(p.id)?.pdf_emailed_at ?? null,
  }));

  return NextResponse.json({
    papers: mapped,
    total,
    page,
    pageSize,
    personalized: hasProfileConfig,
    hasSubscription: hasProfileConfig,
    requiresLogin: !userId && !isDevBypassAuthEnabled(),
    devBypassAuth: isDevBypassAuthEnabled(),
    devBypassUserId: isDevBypassAuthEnabled() ? userId : null,
    devBypassSeedEmail: isDevBypassAuthEnabled() ? getDevBypassSeedEmail() : null,
  });
}
