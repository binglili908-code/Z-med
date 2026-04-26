import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type DevSelfCheckProfile = {
  contact_email: string | null;
  is_active: boolean | null;
};

export type DevSelfCheckSamplePaper = {
  id: string;
  title: string | null;
};

export async function getDevSelfCheckProfile(
  client: SupabaseDbClient,
  userId: string,
) {
  const { data } = await client
    .from("profiles")
    .select("contact_email,is_active")
    .eq("id", userId)
    .maybeSingle();

  return (data as DevSelfCheckProfile | null) ?? null;
}

export async function countOpenAccessPapersWithPdf(client: SupabaseDbClient) {
  const { count } = await client
    .from("papers")
    .select("id", { count: "exact", head: true })
    .eq("is_open_access", true)
    .not("oa_pdf_url", "is", null);

  return count ?? 0;
}

export async function getSampleOpenAccessPaperWithPdf(client: SupabaseDbClient) {
  const { data } = await client
    .from("papers")
    .select("id,title")
    .eq("is_open_access", true)
    .not("oa_pdf_url", "is", null)
    .limit(1)
    .maybeSingle();

  return (data as DevSelfCheckSamplePaper | null) ?? null;
}
