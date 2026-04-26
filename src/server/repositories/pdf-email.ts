import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type PdfEmailPaperRow = {
  id: string;
  title: string;
  pubmed_url: string | null;
  is_open_access: boolean | null;
  oa_pdf_url: string | null;
};

export async function getPaperForPdfEmail(
  client: SupabaseDbClient,
  paperId: string,
) {
  const { data, error } = await client
    .from("papers")
    .select("id,title,pubmed_url,is_open_access,oa_pdf_url")
    .eq("id", paperId)
    .single();
  if (error || !data) return null;

  return data as PdfEmailPaperRow;
}

export async function recordPdfEmailInteraction(
  client: SupabaseDbClient,
  params: { userId: string; paperId: string },
) {
  const { error } = await client
    .from("user_paper_interactions")
    .upsert(
      {
        user_id: params.userId,
        paper_id: params.paperId,
        pdf_emailed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,paper_id",
      },
    );

  if (error) {
    throw new Error(`Failed to record interaction: ${error.message}`);
  }
}
