import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type WeeklyPushCandidatePaper = {
  id: string;
  title: string;
  title_zh?: string | null;
  abstract?: string | null;
  abstract_zh?: string | null;
  ai_analysis?: Record<string, unknown> | null;
  pubmed_url: string | null;
  quality_score: number | null;
  quality_tier: string | null;
  publication_date: string | null;
  journal: string | null;
  keywords: string[] | null;
  mesh_terms: string[] | null;
};

export type WeeklyPushProfileRow = {
  id: string;
  contact_email: string | null;
  is_active: boolean | null;
  subscription_keywords: string[] | null;
  custom_journals: string[] | null;
};

export type WeeklyPushDeliveryInsert = {
  issue_id: string;
  user_id: string;
  paper_id: string;
  issue_week_start: string;
  delivered_at: string;
};

export type WeeklyPushIssueMeta = {
  fromDate: string;
  toDate: string;
  candidateCount: number;
  selectedCount: number;
  sentCount?: number;
  skippedRepeatedUsers?: number;
  skippedNoMatchUsers?: number;
};

const WEEKLY_CANDIDATE_SELECT =
  "id,title,title_zh,abstract,abstract_zh,ai_analysis,pubmed_url,quality_score,quality_tier,publication_date,journal,keywords,mesh_terms";

export async function listWeeklyPushCandidatePapers(
  client: SupabaseDbClient,
  params: { summaryStart: string; summaryEnd: string; limit: number },
) {
  const { data, error } = await client
    .from("papers")
    .select(WEEKLY_CANDIDATE_SELECT)
    .eq("is_ai_med", true)
    .gte("publication_date", params.summaryStart)
    .lte("publication_date", params.summaryEnd)
    .order("quality_score", { ascending: false })
    .order("ai_med_score", { ascending: false })
    .order("publication_date", { ascending: false })
    .limit(params.limit);
  if (error) throw new Error(`Load weekly papers failed: ${error.message}`);

  return (data ?? []) as WeeklyPushCandidatePaper[];
}

export async function upsertWeeklyPushIssueDraft(
  client: SupabaseDbClient,
  params: { issueWeekStart: string; meta: WeeklyPushIssueMeta },
) {
  const { data, error } = await client
    .from("push_issues")
    .upsert(
      {
        issue_week_start: params.issueWeekStart,
        status: "draft",
        generated_at: new Date().toISOString(),
        meta: params.meta,
      },
      { onConflict: "issue_week_start" },
    )
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Upsert push issue failed: ${error?.message}`);
  }

  return data.id as string;
}

export async function replaceWeeklyPushIssueItems(
  client: SupabaseDbClient,
  params: {
    issueId: string;
    papers: Array<{ id: string; quality_score: number | null }>;
  },
) {
  const { error: deleteErr } = await client
    .from("push_issue_items")
    .delete()
    .eq("issue_id", params.issueId);
  if (deleteErr) {
    throw new Error(`Delete push items failed: ${deleteErr.message}`);
  }

  if (!params.papers.length) return;

  const rows = params.papers.map((paper, index) => ({
    issue_id: params.issueId,
    paper_id: paper.id,
    rank: index + 1,
    quality_score: paper.quality_score ?? 0,
  }));
  const { error } = await client.from("push_issue_items").insert(rows);
  if (error) throw new Error(`Insert push items failed: ${error.message}`);
}

export async function listActiveWeeklyPushProfiles(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("profiles")
    .select("id,contact_email,is_active,subscription_keywords,custom_journals")
    .eq("is_active", true)
    .not("contact_email", "is", null);
  if (error) throw new Error(`Load profiles failed: ${error.message}`);

  return (data ?? []) as WeeklyPushProfileRow[];
}

export async function hasWeeklyPushDeliveryForIssue(
  client: SupabaseDbClient,
  params: { issueId: string; userId: string },
) {
  const { data, error } = await client
    .from("user_weekly_push_deliveries")
    .select("paper_id")
    .eq("issue_id", params.issueId)
    .eq("user_id", params.userId)
    .limit(1);
  if (error) {
    throw new Error(`Load weekly delivery status failed: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

export async function listDeliveredWeeklyPushPaperIds(
  client: SupabaseDbClient,
  params: { userId: string; paperIds: string[] },
) {
  if (!params.paperIds.length) return new Set<string>();

  const { data, error } = await client
    .from("user_weekly_push_deliveries")
    .select("paper_id")
    .eq("user_id", params.userId)
    .in("paper_id", params.paperIds);
  if (error) {
    throw new Error(`Load user delivery history failed: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.paper_id as string));
}

export async function insertWeeklyPushDeliveries(
  client: SupabaseDbClient,
  rows: WeeklyPushDeliveryInsert[],
) {
  if (!rows.length) return;

  const { error } = await client.from("user_weekly_push_deliveries").insert(rows);
  if (error) {
    throw new Error(`Record weekly delivery failed: ${error.message}`);
  }
}

export async function markWeeklyPushIssueSent(
  client: SupabaseDbClient,
  params: { issueId: string; meta: WeeklyPushIssueMeta },
) {
  const { error } = await client
    .from("push_issues")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      meta: params.meta,
    })
    .eq("id", params.issueId);
  if (error) {
    throw new Error(`Mark push issue sent failed: ${error.message}`);
  }
}
