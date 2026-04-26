import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type QualityJournalRow = {
  journal_name: string;
  aliases: string[] | null;
  tier: string;
  weight: number | null;
  impact_factor: number | null;
  jcr_quartile: string | null;
  cas_zone: string | null;
};

export type QualityPaperRow = {
  id: string;
  pmid: string;
  journal: string | null;
  ai_med_score: number | null;
  quality_score: number | null;
  quality_tier: string | null;
  journal_if: number | null;
  journal_jcr: string | null;
  journal_cas_zone: string | null;
  source_payload: Record<string, unknown> | null;
};

export type QualityPaperUpdate = {
  quality_score: number;
  quality_tier: string;
  journal_if: number | null;
  journal_jcr: string | null;
  journal_cas_zone: string | null;
  source_payload: Record<string, unknown>;
  updated_at: string;
};

const CURSOR_KEY = "quality_recompute_cursor_id";

export async function readQualityRecomputeCursor(client: SupabaseDbClient) {
  const { data } = await client
    .from("sync_state")
    .select("value")
    .eq("key", CURSOR_KEY)
    .maybeSingle();
  return ((data as { value?: string } | null)?.value ?? "").trim();
}

export async function writeQualityRecomputeCursor(
  client: SupabaseDbClient,
  cursor: string,
) {
  await client.from("sync_state").upsert(
    {
      key: CURSOR_KEY,
      value: cursor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

export async function listQualityJournalRows(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("journal_quality")
    .select("journal_name,aliases,tier,weight,impact_factor,jcr_quartile,cas_zone")
    .eq("is_active", true);
  if (error || !data) {
    throw new Error(`Load journal_quality failed: ${error?.message ?? "unknown error"}`);
  }

  return data as QualityJournalRow[];
}

export async function listQualityRecomputePaperBatch(
  client: SupabaseDbClient,
  params: { cutoffDate: string; cursor: string; batchSize: number },
) {
  let query = client
    .from("papers")
    .select(
      "id,pmid,journal,ai_med_score,quality_score,quality_tier,journal_if,journal_jcr,journal_cas_zone,source_payload",
    )
    .eq("is_ai_med", true)
    .gte("publication_date", params.cutoffDate)
    .order("id", { ascending: true })
    .limit(params.batchSize);

  if (params.cursor) {
    query = query.gt("id", params.cursor);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Load papers for recompute failed: ${error.message}`);
  }

  return (data ?? []) as QualityPaperRow[];
}

export async function updatePaperQualityRecompute(
  client: SupabaseDbClient,
  paperId: string,
  payload: QualityPaperUpdate,
) {
  const { error } = await client.from("papers").update(payload).eq("id", paperId);
  return { ok: !error, errorMessage: error?.message ?? null };
}
