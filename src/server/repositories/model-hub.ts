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

const MODEL_HUB_ITEM_LEGACY_SELECT =
  "id,github_id,full_name,owner,name,html_url,description,language,license_spdx,topics,stargazers_count,forks_count,open_issues_count,watchers_count,pushed_at,github_created_at,github_updated_at,homepage,default_branch,category,task_types,domain_tags,model_signals,quality_flags,recommendation_score,recommendation_reason,source_queries,last_synced_at";

const MODEL_HUB_ITEM_CURATION_SELECT =
  "curator_summary,curated_recommendation_reason,project_understanding,risk_notes,target_users,curation_tags,curated_score,curation_status,curated_at,curated_by,curation_notes";

const MODEL_HUB_ITEM_SELECT = `${MODEL_HUB_ITEM_LEGACY_SELECT},${MODEL_HUB_ITEM_CURATION_SELECT}`;

function normalizeTextArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map((value) => String(value)).filter(Boolean)
    : [];
}

function normalizeNullableString(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input : null;
}

function normalizeNullableNumber(input: unknown): number | null {
  if (input == null) return null;
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
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
    curator_summary: normalizeNullableString(row.curator_summary),
    curated_recommendation_reason: normalizeNullableString(row.curated_recommendation_reason),
    project_understanding: normalizeNullableString(row.project_understanding),
    risk_notes: normalizeNullableString(row.risk_notes),
    target_users: normalizeTextArray(row.target_users),
    curation_tags: normalizeTextArray(row.curation_tags),
    curated_score: normalizeNullableNumber(row.curated_score),
    curation_status: normalizeNullableString(row.curation_status),
    curated_at: typeof row.curated_at === "string" ? row.curated_at : null,
    curated_by: normalizeNullableString(row.curated_by),
    curation_notes: normalizeNullableString(row.curation_notes),
    source_queries: normalizeTextArray(row.source_queries),
    last_synced_at: typeof row.last_synced_at === "string" ? row.last_synced_at : null,
  };
}

function isMissingCurationColumnError(error: { message?: string; code?: string }) {
  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    MODEL_HUB_ITEM_CURATION_SELECT.split(",").some((column) =>
      message.includes(column.toLowerCase()),
    )
  );
}

async function queryModelHubItems(
  client: SupabaseDbClient,
  params: { category?: string | null; limit: number },
  select: string,
  useCurationOrdering: boolean,
) {
  let query = client
    .from("model_hub_items")
    .select(select, { count: "exact" });

  if (useCurationOrdering) {
    query = query.order("curated_score", { ascending: false, nullsFirst: false });
  }

  query = query
    .order("recommendation_score", { ascending: false })
    .order("stargazers_count", { ascending: false })
    .limit(params.limit);

  const category = params.category?.trim();
  if (category) {
    query = query.eq("category", category);
  }

  return query;
}

export async function listModelHubItems(
  client: SupabaseDbClient,
  params: { category?: string | null; limit: number },
): Promise<ModelHubResponse> {
  const category = params.category?.trim();
  let { data, error, count } = await queryModelHubItems(
    client,
    params,
    MODEL_HUB_ITEM_SELECT,
    true,
  );
  if (error && isMissingCurationColumnError(error)) {
    const fallback = await queryModelHubItems(
      client,
      params,
      MODEL_HUB_ITEM_LEGACY_SELECT,
      false,
    );
    data = fallback.data;
    error = fallback.error;
    count = fallback.count;
  }
  if (error) {
    throw new Error(`Failed to load model hub items: ${error.message}`);
  }

  const items = ((data ?? []) as unknown as Record<string, unknown>[]).map(
    normalizeModelHubItem,
  );
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
