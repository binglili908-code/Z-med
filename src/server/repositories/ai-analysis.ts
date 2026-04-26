import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type AiAnalysisPaperRow = {
  id: string;
  title: string;
  title_zh?: string | null;
  journal: string | null;
  abstract: string | null;
  abstract_zh?: string | null;
  quality_score: number | null;
};

export type AiAnalysisQueueRow = {
  id: string;
  paper_id: string;
  attempts: number | null;
  max_attempts: number | null;
  priority: number | null;
  status: string;
};

function toQueuePriority(qualityScore: unknown) {
  const value = Number(qualityScore ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 10000));
}

export async function enqueueMissingPlatformAnalysisJobs(client: SupabaseDbClient) {
  const { data: candidates, error: candidateErr } = await client
    .from("papers")
    .select("id,quality_score,abstract,title_zh,abstract_zh")
    .eq("is_ai_med", true)
    .not("abstract", "is", null)
    .order("quality_score", { ascending: false })
    .limit(400);
  if (candidateErr) {
    throw new Error(`Load papers for AI queue failed: ${candidateErr.message}`);
  }

  const todoCandidates = (candidates ?? []).filter(
    (row) => row.abstract_zh == null || row.title_zh == null,
  );
  const paperIds = todoCandidates.map((row) => row.id);
  if (!paperIds.length) {
    return { enqueuedCount: 0 };
  }

  const { data: existingRows, error: existingErr } = await client
    .from("ai_analysis_queue")
    .select("paper_id")
    .eq("provider", "platform")
    .is("user_id", null)
    .in("paper_id", paperIds);
  if (existingErr) {
    throw new Error(`Load existing AI queue failed: ${existingErr.message}`);
  }

  const existing = new Set((existingRows ?? []).map((row) => row.paper_id));
  const insertRows = todoCandidates
    .filter((row) => !existing.has(row.id))
    .map((row) => ({
      paper_id: row.id,
      user_id: null,
      provider: "platform",
      status: "pending",
      priority: toQueuePriority(row.quality_score),
      attempts: 0,
      max_attempts: 3,
    }));

  if (!insertRows.length) {
    return { enqueuedCount: 0 };
  }

  const { error: insertErr } = await client.from("ai_analysis_queue").insert(insertRows);
  if (insertErr) {
    throw new Error(`Insert AI queue failed: ${insertErr.message}`);
  }
  return { enqueuedCount: insertRows.length };
}

export async function listRunnablePlatformAnalysisJobs(
  client: SupabaseDbClient,
  params: { scanLimit: number; batchSize: number },
) {
  const { data, error } = await client
    .from("ai_analysis_queue")
    .select("id,paper_id,attempts,max_attempts,priority,status")
    .eq("provider", "platform")
    .is("user_id", null)
    .in("status", ["pending", "failed"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(params.scanLimit);
  if (error) {
    throw new Error(`Load AI queue jobs failed: ${error.message}`);
  }

  return ((data ?? []) as AiAnalysisQueueRow[])
    .filter((job) => (job.attempts ?? 0) < (job.max_attempts ?? 3))
    .slice(0, params.batchSize);
}

export async function getAiAnalysisPapersByIds(
  client: SupabaseDbClient,
  paperIds: string[],
) {
  if (!paperIds.length) return new Map<string, AiAnalysisPaperRow>();

  const { data, error } = await client
    .from("papers")
    .select("id,title,journal,abstract,quality_score,abstract_zh,title_zh")
    .in("id", paperIds);
  if (error) {
    throw new Error(`Load papers for AI jobs failed: ${error.message}`);
  }

  return new Map((data ?? []).map((paper) => [paper.id, paper as AiAnalysisPaperRow]));
}

export async function markAiAnalysisJobProcessing(
  client: SupabaseDbClient,
  queueId: string,
) {
  const { error } = await client
    .from("ai_analysis_queue")
    .update({ status: "processing" })
    .eq("id", queueId);
  if (error) {
    throw new Error(`Mark AI queue job processing failed: ${error.message}`);
  }
}

export async function markAiAnalysisJobCompleted(
  client: SupabaseDbClient,
  queueId: string,
  attempts: number,
) {
  const { error } = await client
    .from("ai_analysis_queue")
    .update({ status: "completed", attempts, completed_at: new Date().toISOString() })
    .eq("id", queueId);
  if (error) {
    throw new Error(`Mark AI queue job completed failed: ${error.message}`);
  }
}

export async function markAiAnalysisJobFailed(
  client: SupabaseDbClient,
  queueId: string,
  attempts: number,
  errorText?: string,
) {
  const { error } = await client
    .from("ai_analysis_queue")
    .update({
      status: "failed",
      attempts,
      ...(errorText ? { error_message: errorText.slice(0, 500) } : {}),
    })
    .eq("id", queueId);
  if (error) {
    throw new Error(`Mark AI queue job failed failed: ${error.message}`);
  }
}

export async function updatePaperTranslations(
  client: SupabaseDbClient,
  params: {
    paperId: string;
    titleZh?: string | null;
    abstractZh?: string | null;
  },
) {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (params.abstractZh) payload.abstract_zh = params.abstractZh;
  if (params.titleZh) payload.title_zh = params.titleZh;

  const { error } = await client.from("papers").update(payload).eq("id", params.paperId);
  if (!error) return;

  if (payload.title_zh) {
    const retryPayload: Record<string, unknown> = {
      ...(payload.abstract_zh ? { abstract_zh: payload.abstract_zh } : {}),
      updated_at: new Date().toISOString(),
    };
    const retry = await client.from("papers").update(retryPayload).eq("id", params.paperId);
    if (!retry.error) return;
    throw new Error(retry.error.message);
  }

  throw new Error(error.message);
}
