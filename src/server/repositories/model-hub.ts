import type { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { ModelHubItem, ModelHubResponse } from "@/shared/contracts/model-hub";
import { validateModelHubResponse } from "@/shared/contracts/model-hub.schema";

type SupabaseDbClient = Pick<ReturnType<typeof createServiceSupabaseClient>, "from">;

export type ModelHubItemUpsertRow = {
  github_id: number;
  full_name: string;
  owner: string;
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  license_spdx: string | null;
  topics: string[];
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  pushed_at: string | null;
  github_created_at: string | null;
  github_updated_at: string | null;
  homepage: string | null;
  default_branch: string | null;
  category: string;
  task_types: string[];
  domain_tags: string[];
  model_signals: string[];
  quality_flags: string[];
  recommendation_score: number;
  recommendation_reason: string | null;
  source_queries: string[];
  last_synced_at: string;
};

export type ModelHubSyncRunStatus = "success" | "failed";

type ModelHubSyncRunInsert = {
  source: string;
  meta: Record<string, unknown>;
};

type ModelHubSyncRunFinish = {
  status: ModelHubSyncRunStatus;
  queryCount: number;
  fetchedCount: number;
  upsertedCount: number;
  skippedCount: number;
  errorMessage?: string | null;
  meta?: Record<string, unknown>;
};

const MODEL_HUB_ITEM_SELECT =
  "id,github_id,full_name,owner,name,html_url,description,language,license_spdx,topics,stargazers_count,forks_count,open_issues_count,watchers_count,pushed_at,github_created_at,github_updated_at,homepage,default_branch,category,task_types,domain_tags,model_signals,quality_flags,recommendation_score,recommendation_reason,source_queries,last_synced_at";

function normalizeTextArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map((value) => String(value)).filter(Boolean)
    : [];
}

function normalizeModelHubItem(row: Record<string, unknown>): ModelHubItem {
  return {
    id: String(row.id),
    github_id: Number(row.github_id),
    full_name: String(row.full_name),
    owner: String(row.owner),
    name: String(row.name),
    html_url: String(row.html_url),
    description: typeof row.description === "string" ? row.description : null,
    language: typeof row.language === "string" ? row.language : null,
    license_spdx: typeof row.license_spdx === "string" ? row.license_spdx : null,
    topics: normalizeTextArray(row.topics),
    stargazers_count: Number(row.stargazers_count ?? 0),
    forks_count: Number(row.forks_count ?? 0),
    open_issues_count: Number(row.open_issues_count ?? 0),
    watchers_count: Number(row.watchers_count ?? 0),
    pushed_at: typeof row.pushed_at === "string" ? row.pushed_at : null,
    github_created_at:
      typeof row.github_created_at === "string" ? row.github_created_at : null,
    github_updated_at:
      typeof row.github_updated_at === "string" ? row.github_updated_at : null,
    homepage: typeof row.homepage === "string" ? row.homepage : null,
    default_branch: typeof row.default_branch === "string" ? row.default_branch : null,
    category: String(row.category ?? "medical-ai"),
    task_types: normalizeTextArray(row.task_types),
    domain_tags: normalizeTextArray(row.domain_tags),
    model_signals: normalizeTextArray(row.model_signals),
    quality_flags: normalizeTextArray(row.quality_flags),
    recommendation_score: Number(row.recommendation_score ?? 0),
    recommendation_reason:
      typeof row.recommendation_reason === "string" ? row.recommendation_reason : null,
    source_queries: normalizeTextArray(row.source_queries),
    last_synced_at: typeof row.last_synced_at === "string" ? row.last_synced_at : null,
  };
}

export async function listModelHubItems(
  client: SupabaseDbClient,
  params: { category?: string | null; limit: number },
): Promise<ModelHubResponse> {
  let query = client
    .from("model_hub_items")
    .select(MODEL_HUB_ITEM_SELECT, { count: "exact" })
    .order("recommendation_score", { ascending: false })
    .order("stargazers_count", { ascending: false })
    .limit(params.limit);

  const category = params.category?.trim();
  if (category) {
    query = query.eq("category", category);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to load model hub items: ${error.message}`);
  }

  const items = ((data ?? []) as Record<string, unknown>[]).map(normalizeModelHubItem);
  const lastSyncedAt =
    items
      .map((item) => item.last_synced_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  return validateModelHubResponse({
    items,
    total: count ?? items.length,
    category: category || null,
    lastSyncedAt,
    configured: true,
  });
}

export async function upsertModelHubItems(
  client: SupabaseDbClient,
  rows: ModelHubItemUpsertRow[],
) {
  if (!rows.length) return;

  const { error } = await client
    .from("model_hub_items")
    .upsert(rows, { onConflict: "github_id" });
  if (error) {
    throw new Error(`Failed to upsert model hub items: ${error.message}`);
  }
}

export async function deleteModelHubItemsNotSyncedAt(
  client: SupabaseDbClient,
  syncedAt: string,
) {
  const { error, count } = await client
    .from("model_hub_items")
    .delete({ count: "exact" })
    .or(`last_synced_at.is.null,last_synced_at.lt.${syncedAt}`);
  if (error) {
    throw new Error(`Failed to delete stale model hub items: ${error.message}`);
  }
  return count ?? 0;
}

export async function startModelHubSyncRun(
  client: SupabaseDbClient,
  input: ModelHubSyncRunInsert,
) {
  const { data, error } = await client
    .from("model_hub_sync_runs")
    .insert({
      source: input.source,
      status: "processing",
      meta: input.meta,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[model-hub-sync-run-start-failed]", error.message);
    return null;
  }
  return data as { id: string } | null;
}

export async function finishModelHubSyncRun(
  client: SupabaseDbClient,
  runId: string | null,
  input: ModelHubSyncRunFinish,
) {
  if (!runId) return;

  const { error } = await client
    .from("model_hub_sync_runs")
    .update({
      status: input.status,
      finished_at: new Date().toISOString(),
      query_count: input.queryCount,
      fetched_count: input.fetchedCount,
      upserted_count: input.upsertedCount,
      skipped_count: input.skippedCount,
      error_message: input.errorMessage ?? null,
      meta: input.meta ?? {},
    })
    .eq("id", runId);

  if (error) {
    console.warn("[model-hub-sync-run-finish-failed]", error.message);
  }
}
