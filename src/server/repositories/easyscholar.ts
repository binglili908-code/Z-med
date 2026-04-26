import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type EasyScholarJournalRow = {
  id: string;
  journal_name: string;
  aliases: string[] | null;
};

export type EasyScholarJournalUpdate = {
  es_last_sync_at: string;
  es_sync_status: "success" | "failed" | "not_found";
  es_error: string | null;
  es_raw: Record<string, unknown> | null;
  impact_factor: number | null;
  jcr_quartile: string | null;
  cas_zone: string | null;
  updated_at: string;
};

const CURSOR_KEY = "easyscholar_sync_cursor";

export async function readEasyScholarCursor(
  client: SupabaseDbClient,
  total: number,
) {
  if (total <= 0) return 0;

  const { data } = await client
    .from("sync_state")
    .select("value")
    .eq("key", CURSOR_KEY)
    .maybeSingle();
  const n = Number((data as { value?: string } | null)?.value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n % total;
}

export async function writeEasyScholarCursor(
  client: SupabaseDbClient,
  nextCursor: number,
) {
  await client.from("sync_state").upsert(
    {
      key: CURSOR_KEY,
      value: String(nextCursor),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

export async function listActiveEasyScholarJournals(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("journal_quality")
    .select("id,journal_name,aliases")
    .eq("is_active", true)
    .order("journal_name", { ascending: true });
  if (error) {
    throw new Error(`Load journal_quality failed: ${error.message}`);
  }

  return (data ?? []) as EasyScholarJournalRow[];
}

export async function updateJournalEasyScholarResult(
  client: SupabaseDbClient,
  journalId: string,
  updatePayload: EasyScholarJournalUpdate,
) {
  const { error } = await client
    .from("journal_quality")
    .update(updatePayload)
    .eq("id", journalId);

  return { ok: !error, errorMessage: error?.message ?? null };
}
