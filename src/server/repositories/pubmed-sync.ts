import type { createServiceSupabaseClient } from "@/lib/supabase/service";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from" | "rpc">;

export type ProfileKeywordRow = {
  subscription_keywords: string[] | null;
  subscription_mesh_terms: string[] | null;
};

export type JournalQualityRow = {
  id?: string;
  journal_name: string;
  aliases: string[] | null;
  tier: string;
  weight: number | null;
  impact_factor?: number | null;
  jcr_quartile?: string | null;
  cas_zone?: string | null;
  is_active: boolean | null;
};

export type JournalQualityMatcher = {
  exactByName: Map<string, JournalQualityRow>;
  byAlias: Map<string, JournalQualityRow>;
};

export type ActiveJournalRow = {
  id: string;
  journal_name: string;
  aliases: string[] | null;
};

export type ResearchTopicRef = {
  id: string;
  slug: string;
};

export type AiMedScoreResult = {
  is_ai_med?: boolean;
  score?: number | string;
};

export type JournalTierWeightResult = {
  tier?: string;
  weight?: number | string;
  impact_factor?: number | string | null;
  jcr?: string | null;
  cas_zone?: string | null;
};

export type PaperTopicRelationRow = {
  paper_id: string;
  topic_id: string;
  confidence: number;
  source: string;
  matched_terms: string[];
  updated_at: string;
};

export type JournalSyncLogRow = {
  journal_quality_id: string;
  journal_name: string;
  sync_from: string;
  sync_to: string;
  papers_found: number;
  papers_passed: number;
  papers_new: number;
  status: string;
  error_message: string | null;
  finished_at: string;
  created_at: string;
};

function normalizeToken(input: string) {
  return input.trim().toLowerCase();
}

function normalizeJournalKey(input: string) {
  return input.trim().toLowerCase();
}

function dedupeTerms(terms: string[]) {
  return Array.from(new Set(terms.map((term) => normalizeToken(term)).filter(Boolean)));
}

export async function loadJournalQualityMap(
  client: SupabaseDbClient,
): Promise<JournalQualityMatcher> {
  const { data, error } = await client
    .from("journal_quality")
    .select("journal_name,aliases,tier,weight,impact_factor,jcr_quartile,cas_zone,is_active")
    .eq("is_active", true);
  if (error || !data) {
    return {
      exactByName: new Map<string, JournalQualityRow>(),
      byAlias: new Map<string, JournalQualityRow>(),
    };
  }

  const exactByName = new Map<string, JournalQualityRow>();
  const byAlias = new Map<string, JournalQualityRow>();
  for (const row of data as JournalQualityRow[]) {
    const canonical = normalizeJournalKey(row.journal_name);
    if (canonical) exactByName.set(canonical, row);
    for (const alias of row.aliases ?? []) {
      const normalized = normalizeJournalKey(alias);
      if (normalized) byAlias.set(normalized, row);
    }
  }

  return { exactByName, byAlias };
}

export async function loadTopJournalTerms(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("journal_quality")
    .select("journal_name,aliases")
    .eq("is_active", true)
    .eq("tier", "top");
  if (error || !data) return [] as string[];

  const terms: string[] = [];
  for (const row of data as Array<{ journal_name: string; aliases: string[] | null }>) {
    terms.push(row.journal_name);
    for (const alias of row.aliases ?? []) terms.push(alias);
  }
  return dedupeTerms(terms);
}

export async function loadActiveJournalNames(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("journal_quality")
    .select("journal_name")
    .eq("is_active", true);
  if (error || !data) return [] as string[];

  return dedupeTerms(
    (data as Array<{ journal_name: string | null }>)
      .map((row) => row.journal_name ?? "")
      .filter(Boolean),
  );
}

export async function loadActiveJournals(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("journal_quality")
    .select("id,journal_name,aliases")
    .eq("is_active", true);
  if (error || !data) return [] as ActiveJournalRow[];

  return (data as ActiveJournalRow[]).filter((row) => Boolean(row.journal_name));
}

export function resolveJournalQuality(
  input: { journal: string | null },
  matcher: JournalQualityMatcher,
) {
  const journal = normalizeJournalKey(input.journal ?? "");
  if (!journal) return null;
  return matcher.exactByName.get(journal) ?? matcher.byAlias.get(journal) ?? null;
}

export async function loadActiveProfileKeywordRows(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("profiles")
    .select("subscription_keywords, subscription_mesh_terms")
    .eq("is_active", true);
  if (error) {
    throw new Error(`Failed to read profiles: ${error.message}`);
  }
  return (data ?? []) as ProfileKeywordRow[];
}

export async function loadProfileSubscriptionKeywordRows(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("profiles")
    .select("subscription_keywords")
    .not("subscription_keywords", "is", null);
  if (error) {
    throw new Error(`Failed to load profile keywords: ${error.message}`);
  }
  return (data ?? []) as Array<{ subscription_keywords?: string[] | null }>;
}

export async function loadResearchTopicRefs(client: SupabaseDbClient) {
  const { data, error } = await client
    .from("research_topics")
    .select("id,slug")
    .eq("is_active", true);
  if (error) {
    throw new Error(`Failed to load research topics: ${error.message}`);
  }
  return (data ?? []) as ResearchTopicRef[];
}

export async function calculateAiMedScore(
  client: SupabaseDbClient,
  input: { title: string; abstract: string },
) {
  return client.rpc("calculate_ai_med_score", {
    p_title: input.title,
    p_abstract: input.abstract,
  });
}

export async function getJournalTierAndWeight(client: SupabaseDbClient, journal: string) {
  return client.rpc("get_journal_tier_and_weight", {
    p_journal: journal,
  });
}

export async function getOrFlagKeyword(client: SupabaseDbClient, keyword: string) {
  return client.rpc("get_or_flag_keyword", {
    p_keyword: keyword,
  });
}

export async function buildPubmedQueryForKeyword(
  client: SupabaseDbClient,
  input: { keyword: string; daysBack: number },
) {
  return client.rpc("build_pubmed_query_for_keyword", {
    p_keyword: input.keyword,
    p_days_back: input.daysBack,
  });
}

export async function saveLlmSynonyms(
  client: SupabaseDbClient,
  input: {
    keyword: string;
    synonyms: string[];
    titleRequired: string[];
    pubmedQuery?: string | null;
  },
) {
  const args: Record<string, unknown> = {
    p_keyword: input.keyword,
    p_synonyms: input.synonyms,
    p_title_required: input.titleRequired,
  };
  if (input.pubmedQuery !== undefined) {
    args.p_pubmed_query = input.pubmedQuery;
  }
  return client.rpc("save_llm_synonyms", args);
}

export async function upsertScoredPaperRows(
  client: SupabaseDbClient,
  rows: Record<string, unknown>[],
) {
  if (!rows.length) return;

  const { error } = await client.from("papers").upsert(rows, { onConflict: "pmid" });
  if (error) {
    throw new Error(`Failed to upsert papers: ${error.message}`);
  }
}

export async function loadPaperIdsByPmids(client: SupabaseDbClient, pmids: string[]) {
  if (!pmids.length) return [] as Array<{ id: string; pmid: string }>;

  const { data, error } = await client.from("papers").select("id,pmid").in("pmid", pmids);
  if (error) {
    throw new Error(`Failed to load paper ids: ${error.message}`);
  }
  return (data ?? []) as Array<{ id: string; pmid: string }>;
}

export async function upsertPaperResearchTopicRows(
  client: SupabaseDbClient,
  rows: PaperTopicRelationRow[],
) {
  if (!rows.length) return;

  const { error } = await client
    .from("paper_research_topics")
    .upsert(rows, { onConflict: "paper_id,topic_id" });
  if (error) {
    throw new Error(`Failed to upsert paper research topics: ${error.message}`);
  }
}

export async function loadExistingPaperPmids(client: SupabaseDbClient, pmids: string[]) {
  if (!pmids.length) return new Set<string>();

  const { data } = await client.from("papers").select("pmid").in("pmid", pmids);
  return new Set((data ?? []).map((row) => row.pmid as string));
}

export async function upsertKeywordSyncedPaper(
  client: SupabaseDbClient,
  row: Record<string, unknown>,
) {
  const { error } = await client
    .from("papers")
    .upsert(row, { onConflict: "pmid", ignoreDuplicates: true });
  return { ok: !error, errorMessage: error?.message ?? null };
}

export async function readBackfillMonthOffset(client: SupabaseDbClient) {
  try {
    const { data, error } = await client
      .from("sync_state")
      .select("value")
      .eq("key", "backfill_6m_month_offset")
      .maybeSingle();
    if (error) return 1;
    const n = Number((data as { value?: string } | null)?.value ?? 1);
    if (!Number.isFinite(n) || n < 1 || n > 6) return 1;
    return n;
  } catch {
    return 1;
  }
}

export async function writeBackfillMonthOffset(
  client: SupabaseDbClient,
  offset: number,
) {
  try {
    await client.from("sync_state").upsert(
      {
        key: "backfill_6m_month_offset",
        value: String(offset),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {
    return;
  }
}

export async function insertJournalSyncLog(
  client: SupabaseDbClient,
  row: JournalSyncLogRow,
) {
  await client.from("journal_sync_log").insert(row);
}

export async function writeSyncStateValue(
  client: SupabaseDbClient,
  input: { key: string; value: string },
) {
  await client.from("sync_state").upsert(
    {
      key: input.key,
      value: input.value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}
