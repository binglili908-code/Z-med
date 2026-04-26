import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type PaperTranslationRow = {
  id: string;
  title: string;
  title_zh: string | null;
  journal: string | null;
  abstract: string | null;
  abstract_zh: string | null;
  is_open_access: boolean | null;
};

export type ByokUsageStatus = "success" | "failed";

export async function getPaperForTranslation(
  client: SupabaseDbClient,
  paperId: string,
) {
  const { data, error } = await client
    .from("papers")
    .select("id,title,title_zh,journal,abstract,abstract_zh,is_open_access")
    .eq("id", paperId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  return (data as PaperTranslationRow | null) ?? null;
}

export async function savePaperTranslationFields(
  client: SupabaseDbClient,
  paperId: string,
  fields: { titleZh?: string | null; abstractZh?: string | null },
) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.titleZh) update.title_zh = fields.titleZh.slice(0, 120);
  if (fields.abstractZh) update.abstract_zh = fields.abstractZh;

  await client.from("papers").update(update).eq("id", paperId);
}

export async function recordByokTranslationUsage(
  client: SupabaseDbClient,
  params: {
    userId: string;
    paperId: string;
    provider: string;
    model: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    status: ByokUsageStatus;
  },
) {
  await client.from("byok_usage_log").insert({
    user_id: params.userId,
    paper_id: params.paperId,
    provider: params.provider,
    model: params.model,
    usage_type: "translate",
    input_tokens: params.inputTokens ?? null,
    output_tokens: params.outputTokens ?? null,
    status: params.status,
    created_at: new Date().toISOString(),
  });
}
