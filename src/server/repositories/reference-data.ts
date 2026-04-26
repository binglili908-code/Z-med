import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type JournalQualityItem = {
  id: string;
  journal_name: string;
  aliases: string[] | null;
  tier: string;
  weight: number | null;
  impact_factor: number | null;
  jcr_quartile: string | null;
  cas_zone: string | null;
  is_active: boolean | null;
};

export type ResearchTopicItem = {
  id: string;
  slug: string;
  name_zh: string | null;
  name_en: string | null;
  description: string | null;
  sort_order: number | null;
};

export async function listActiveJournalQualityItems(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("journal_quality")
    .select("id,journal_name,aliases,tier,weight,impact_factor,jcr_quartile,cas_zone,is_active")
    .eq("is_active", true)
    .order("impact_factor", { ascending: false })
    .order("weight", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as JournalQualityItem[];
}

export async function listActiveResearchTopics(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("research_topics")
    .select("id,slug,name_zh,name_en,description,sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ResearchTopicItem[];
}
