import { fetchWithRetry } from "@/lib/external-fetch";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  deleteModelHubItemsNotSyncedAt,
  finishModelHubSyncRun,
  listModelHubItems,
  startModelHubSyncRun,
  upsertModelHubItems,
  type ModelHubItemUpsertRow,
} from "@/server/repositories/model-hub";

type GitHubRepoLicense = {
  spdx_id?: string | null;
  name?: string | null;
};

export type GitHubModelHubRepository = {
  id: number;
  full_name: string;
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  license: GitHubRepoLicense | null;
  topics?: string[] | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  pushed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  homepage: string | null;
  default_branch: string | null;
  archived: boolean;
  disabled: boolean;
};

type GitHubSearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubModelHubRepository[];
};

type ModelHubQuery = {
  id: string;
  category: string;
  label: string;
  q: string;
  sort: "stars" | "updated";
  order: "desc";
  perPage: number;
};

type ScoreResult = Omit<
  ModelHubItemUpsertRow,
  "source_queries" | "last_synced_at"
> & {
  source_query: string;
};

export type GitHubModelHubSyncOptions = {
  queryLimit?: number;
  perPage?: number;
  dryRun?: boolean;
};

const DEFAULT_PER_PAGE = 30;

export const MODEL_HUB_GITHUB_QUERIES: ModelHubQuery[] = [
  {
    id: "medical-imaging-stars",
    category: "medical-imaging",
    label: "医学影像高星项目",
    q: "topic:medical-imaging topic:deep-learning archived:false stars:>50",
    sort: "stars",
    order: "desc",
    perPage: DEFAULT_PER_PAGE,
  },
  {
    id: "medical-imaging-active",
    category: "medical-imaging",
    label: "近期活跃医学影像项目",
    q: "topic:medical-imaging topic:deep-learning archived:false pushed:>=2025-10-01 stars:>20",
    sort: "updated",
    order: "desc",
    perPage: DEFAULT_PER_PAGE,
  },
  {
    id: "healthcare-ml",
    category: "clinical-ai",
    label: "医疗机器学习项目",
    q: "topic:healthcare topic:machine-learning archived:false stars:>50",
    sort: "stars",
    order: "desc",
    perPage: DEFAULT_PER_PAGE,
  },
  {
    id: "bioinformatics-ml",
    category: "bioinformatics",
    label: "生信与组学机器学习项目",
    q: "topic:bioinformatics topic:machine-learning archived:false stars:>50",
    sort: "stars",
    order: "desc",
    perPage: DEFAULT_PER_PAGE,
  },
  {
    id: "radiology-ai",
    category: "radiology",
    label: "放射影像 AI 项目",
    q: "radiology deep-learning in:name,description,readme archived:false stars:>30",
    sort: "stars",
    order: "desc",
    perPage: DEFAULT_PER_PAGE,
  },
  {
    id: "pathology-ai",
    category: "pathology",
    label: "病理 AI 项目",
    q: "pathology deep-learning in:name,description,readme archived:false stars:>30",
    sort: "stars",
    order: "desc",
    perPage: DEFAULT_PER_PAGE,
  },
  {
    id: "clinical-llm",
    category: "clinical-llm",
    label: "临床大模型与医学 NLP",
    q: "medical llm in:name,description,readme archived:false stars:>30",
    sort: "stars",
    order: "desc",
    perPage: DEFAULT_PER_PAGE,
  },
  {
    id: "drug-discovery",
    category: "drug-discovery",
    label: "AI 药物发现项目",
    q: "topic:drug-discovery topic:machine-learning archived:false stars:>50",
    sort: "stars",
    order: "desc",
    perPage: DEFAULT_PER_PAGE,
  },
];

const MEDICAL_TERMS = [
  "bioimage",
  "bioinformatics",
  "biomedical",
  "clinical",
  "ct",
  "diagnosis",
  "dicom",
  "disease",
  "drug-discovery",
  "genomics",
  "health",
  "healthcare",
  "hospital",
  "imaging",
  "medical",
  "medical-image",
  "medical-imaging",
  "mri",
  "pathology",
  "patient",
  "radiology",
];

const AI_TERMS = [
  "ai",
  "artificial-intelligence",
  "classification",
  "deep-learning",
  "detection",
  "foundation",
  "llm",
  "machine-learning",
  "model",
  "neural",
  "nlp",
  "pytorch",
  "segmentation",
  "tensorflow",
  "transformer",
];

const GENERIC_ONLY_TERMS = [
  "awesome",
  "api",
  "collection",
  "course",
  "courses",
  "job",
  "jobs",
  "list",
  "prompt",
  "reading-list",
  "selfhosted",
  "self-hosted",
  "survey",
];

function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").toLowerCase();
}

function cleanTextArray(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value).replace(/\s+/g, "-").trim())
        .filter(Boolean),
    ),
  );
}

function tokenizeText(text: string) {
  return new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
}

function signalMatches(text: string, tokens: Set<string>, term: string) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  if (normalizedTerm.includes(" ")) return text.includes(normalizedTerm);
  if (normalizedTerm.length <= 3) return tokens.has(normalizedTerm);
  if (normalizedTerm.includes("-")) {
    return (
      text.includes(normalizedTerm) ||
      normalizedTerm.split("-").every((part) => tokens.has(part))
    );
  }
  return tokens.has(normalizedTerm) || text.includes(normalizedTerm);
}

function countSignals(text: string, terms: string[]) {
  const tokens = tokenizeText(text);
  return terms.filter((term) => signalMatches(text, tokens, term)).length;
}

function hasAny(text: string, terms: string[]) {
  const tokens = tokenizeText(text);
  return terms.some((term) => signalMatches(text, tokens, term));
}

function daysSince(iso: string | null, now = new Date()) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - time) / (24 * 60 * 60 * 1000));
}

function recencyScore(pushedAt: string | null) {
  const age = daysSince(pushedAt);
  if (age <= 30) return 22;
  if (age <= 90) return 16;
  if (age <= 180) return 11;
  if (age <= 365) return 6;
  if (age <= 730) return 2;
  return -8;
}

function inferDomainTags(text: string) {
  const tags: string[] = [];
  if (hasAny(text, ["medical-imaging", "medical-image", "dicom", "ct", "mri", "ultrasound"])) {
    tags.push("medical-imaging");
  }
  if (hasAny(text, ["radiology", "xray", "x-ray", "ct", "mri"])) tags.push("radiology");
  if (hasAny(text, ["pathology", "histology", "wsi", "digital-pathology"])) tags.push("pathology");
  if (hasAny(text, ["bioinformatics", "genomics", "proteomics", "single-cell"])) {
    tags.push("bioinformatics");
  }
  if (hasAny(text, ["drug-discovery", "molecule", "protein", "chemoinformatics"])) {
    tags.push("drug-discovery");
  }
  if (hasAny(text, ["clinical", "healthcare", "patient", "hospital", "ehr", "emr"])) {
    tags.push("clinical-ai");
  }
  if (hasAny(text, ["llm", "medical-llm", "nlp", "question-answering"])) {
    tags.push("medical-nlp");
  }
  return cleanTextArray(tags);
}

function inferTaskTypes(text: string) {
  const tasks: string[] = [];
  if (hasAny(text, ["segmentation", "unet"])) tasks.push("segmentation");
  if (hasAny(text, ["detection", "detector", "object-detection"])) tasks.push("detection");
  if (hasAny(text, ["classification", "classifier"])) tasks.push("classification");
  if (hasAny(text, ["reconstruction", "super-resolution"])) tasks.push("reconstruction");
  if (hasAny(text, ["generation", "generative", "diffusion"])) tasks.push("generation");
  if (hasAny(text, ["llm", "nlp", "question-answering", "qa"])) tasks.push("medical-nlp");
  if (hasAny(text, ["benchmark", "leaderboard", "evaluation"])) tasks.push("benchmark");
  if (hasAny(text, ["framework", "toolbox", "pipeline", "library"])) tasks.push("framework");
  if (hasAny(text, ["awesome", "collection", "course", "courses", "list", "reading-list", "survey"])) {
    tasks.push("resource-list");
  }
  if (!tasks.length) tasks.push("project");
  return cleanTextArray(tasks);
}

function inferModelSignals(text: string) {
  const signals: string[] = [];
  if (hasAny(text, ["foundation-model", "foundation model"])) signals.push("foundation-model");
  if (hasAny(text, ["pretrained", "pre-trained", "weights", "checkpoint"])) {
    signals.push("pretrained-weights");
  }
  if (hasAny(text, ["demo", "gradio", "streamlit", "inference"])) signals.push("demo-or-inference");
  if (hasAny(text, ["paper", "neurips", "miccai", "nature", "medical image analysis"])) {
    signals.push("paper-backed");
  }
  if (hasAny(text, ["pytorch", "tensorflow", "keras"])) signals.push("trainable-code");
  return cleanTextArray(signals);
}

function inferCategory(sourceCategory: string, domainTags: string[], taskTypes: string[]) {
  if (domainTags.includes("medical-imaging")) return "medical-imaging";
  if (domainTags.includes("pathology")) return "pathology";
  if (domainTags.includes("bioinformatics")) return "bioinformatics";
  if (domainTags.includes("drug-discovery")) return "drug-discovery";
  if (domainTags.includes("medical-nlp")) return "clinical-llm";
  if (taskTypes.includes("resource-list")) return "resource-list";
  return sourceCategory;
}

function buildQualityFlags(args: {
  repo: GitHubModelHubRepository;
  text: string;
  medicalSignals: number;
  aiSignals: number;
}) {
  const flags: string[] = [];
  if (!args.repo.license?.spdx_id || args.repo.license.spdx_id === "NOASSERTION") {
    flags.push("missing-license");
  }
  if (daysSince(args.repo.pushed_at) > 730) flags.push("stale");
  if (args.repo.stargazers_count < 100) flags.push("early-stage");
  if (hasAny(args.text, ["awesome", "collection", "course", "courses", "list", "reading-list", "survey"])) {
    flags.push("resource-list");
  }
  if (args.repo.description && args.repo.description.length > 500) {
    flags.push("broad-description");
  }
  if (args.medicalSignals < 1 || args.aiSignals < 1) flags.push("needs-review");
  return cleanTextArray(flags);
}

function buildRecommendationReason(args: {
  repo: GitHubModelHubRepository;
  domainTags: string[];
  taskTypes: string[];
  modelSignals: string[];
  sourceLabel: string;
}) {
  const signals = [
    args.domainTags.slice(0, 2).join("/"),
    args.taskTypes.slice(0, 2).join("/"),
    args.modelSignals.slice(0, 1).join("/"),
  ].filter(Boolean);
  const pushedAt = args.repo.pushed_at?.slice(0, 10) ?? "未知时间";
  return `${args.sourceLabel}入选；${args.repo.stargazers_count} stars，最近更新 ${pushedAt}${signals.length ? `，信号：${signals.join("、")}` : ""}`;
}

export function scoreGitHubModelHubCandidate(
  repo: GitHubModelHubRepository,
  source: Pick<ModelHubQuery, "category" | "id" | "label">,
): ScoreResult | null {
  if (repo.archived || repo.disabled) return null;

  const topics = cleanTextArray(repo.topics ?? []);
  const text = normalizeText(
    [
      repo.full_name,
      repo.name,
      repo.description,
      repo.language,
      topics.join(" "),
      repo.license?.spdx_id,
    ].join(" "),
  );
  const medicalSignals = countSignals(text, MEDICAL_TERMS);
  const aiSignals = countSignals(text, AI_TERMS);
  const genericSignals = countSignals(text, GENERIC_ONLY_TERMS);
  if (medicalSignals < 1 || aiSignals < 1) return null;
  if (genericSignals >= 2 && !topics.some((topic) => MEDICAL_TERMS.includes(topic))) {
    return null;
  }

  const domainTags = inferDomainTags(text);
  const taskTypes = inferTaskTypes(text);
  const modelSignals = inferModelSignals(text);
  const qualityFlags = buildQualityFlags({ repo, text, medicalSignals, aiSignals });
  const starScore = Math.log10(Math.max(1, repo.stargazers_count) + 1) * 18;
  const activityScore = recencyScore(repo.pushed_at);
  const signalScore =
    Math.min(medicalSignals, 5) * 5 +
    Math.min(aiSignals, 5) * 4 +
    modelSignals.length * 4 +
    domainTags.length * 3;
  const issuePenalty = repo.open_issues_count > 200 ? 5 : 0;
  const licensePenalty = qualityFlags.includes("missing-license") ? 4 : 0;
  const resourcePenalty = qualityFlags.includes("resource-list") ? 34 : 0;
  const broadDescriptionPenalty = qualityFlags.includes("broad-description") ? 18 : 0;
  const genericPenalty = Math.max(0, genericSignals - 1) * 6;
  const rawScore =
    starScore +
    activityScore +
    signalScore -
    issuePenalty -
    licensePenalty -
    resourcePenalty -
    broadDescriptionPenalty -
    genericPenalty;
  const cappedScore = qualityFlags.includes("resource-list")
    ? Math.min(rawScore, 82)
    : rawScore;
  const recommendationScore = Number(Math.max(0, cappedScore).toFixed(3));

  const [owner, name] = repo.full_name.split("/");
  return {
    github_id: repo.id,
    full_name: repo.full_name,
    owner: owner ?? repo.full_name,
    name: name ?? repo.name,
    html_url: repo.html_url,
    description: repo.description,
    language: repo.language,
    license_spdx: repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION"
      ? repo.license.spdx_id
      : null,
    topics,
    stargazers_count: repo.stargazers_count,
    forks_count: repo.forks_count,
    open_issues_count: repo.open_issues_count,
    watchers_count: repo.watchers_count,
    pushed_at: repo.pushed_at,
    github_created_at: repo.created_at,
    github_updated_at: repo.updated_at,
    homepage: repo.homepage?.trim() || null,
    default_branch: repo.default_branch,
    category: inferCategory(source.category, domainTags, taskTypes),
    task_types: taskTypes,
    domain_tags: domainTags.length ? domainTags : [source.category],
    model_signals: modelSignals,
    quality_flags: qualityFlags,
    recommendation_score: recommendationScore,
    recommendation_reason: buildRecommendationReason({
      repo,
      domainTags,
      taskTypes,
      modelSignals,
      sourceLabel: source.label,
    }),
    source_query: source.id,
  };
}

function getGitHubToken() {
  return process.env.GITHUB_TOKEN?.trim() || null;
}

async function fetchGitHubSearch(query: ModelHubQuery, perPage: number) {
  const params = new URLSearchParams({
    q: query.q,
    sort: query.sort,
    order: query.order,
    per_page: String(Math.max(1, Math.min(100, perPage))),
  });
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "zlab-model-hub-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = getGitHubToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchWithRetry(
    `https://api.github.com/search/repositories?${params.toString()}`,
    {
      headers,
      retries: 1,
      retryDelayMs: 800,
      timeoutMs: 18_000,
      label: `github_model_hub:${query.id}`,
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub search ${query.id} failed with HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  return (await response.json()) as GitHubSearchResponse;
}

function mergeCandidate(
  target: Map<number, ModelHubItemUpsertRow>,
  scored: ScoreResult,
  syncedAt: string,
) {
  const existing = target.get(scored.github_id);
  const sourceQueries = Array.from(
    new Set([...(existing?.source_queries ?? []), scored.source_query]),
  );
  const { source_query: _sourceQuery, ...row } = scored;
  const next: ModelHubItemUpsertRow = {
    ...row,
    source_queries: sourceQueries,
    last_synced_at: syncedAt,
  };
  if (!existing || scored.recommendation_score > existing.recommendation_score) {
    target.set(scored.github_id, next);
    return;
  }
  target.set(scored.github_id, {
    ...existing,
    source_queries: sourceQueries,
    last_synced_at: syncedAt,
  });
}

export async function runGitHubModelHubSync(options: GitHubModelHubSyncOptions = {}) {
  const dryRun = Boolean(options.dryRun);
  const supabase = dryRun ? null : createServiceSupabaseClient();
  const queryLimit = Math.max(
    1,
    Math.min(MODEL_HUB_GITHUB_QUERIES.length, options.queryLimit ?? MODEL_HUB_GITHUB_QUERIES.length),
  );
  const queries = MODEL_HUB_GITHUB_QUERIES.slice(0, queryLimit);
  const perPage = Math.max(1, Math.min(100, options.perPage ?? DEFAULT_PER_PAGE));
  const syncedAt = new Date().toISOString();
  const run = supabase
    ? await startModelHubSyncRun(supabase, {
        source: "github",
        meta: {
          dryRun,
          queryIds: queries.map((query) => query.id),
          perPage,
        },
      })
    : null;

  const candidateMap = new Map<number, ModelHubItemUpsertRow>();
  let fetchedCount = 0;
  const querySummaries: Array<{
    id: string;
    totalCount: number;
    acceptedCount: number;
    incompleteResults: boolean;
  }> = [];

  try {
    for (const query of queries) {
      const result = await fetchGitHubSearch(query, Math.min(perPage, query.perPage));
      fetchedCount += result.items.length;
      let acceptedCount = 0;
      for (const repo of result.items) {
        const scored = scoreGitHubModelHubCandidate(repo, query);
        if (!scored) continue;
        acceptedCount += 1;
        mergeCandidate(candidateMap, scored, syncedAt);
      }
      querySummaries.push({
        id: query.id,
        totalCount: result.total_count,
        acceptedCount,
        incompleteResults: result.incomplete_results,
      });
    }

    const rows = Array.from(candidateMap.values()).sort(
      (a, b) => b.recommendation_score - a.recommendation_score,
    );
    let removedStaleCount = 0;
    if (!dryRun) {
      if (!supabase) throw new Error("Supabase client is required for apply mode.");
      await upsertModelHubItems(supabase, rows);
      removedStaleCount = await deleteModelHubItemsNotSyncedAt(supabase, syncedAt);
    }
    if (supabase) {
      await finishModelHubSyncRun(supabase, run?.id ?? null, {
        status: "success",
        queryCount: queries.length,
        fetchedCount,
        upsertedCount: dryRun ? 0 : rows.length,
        skippedCount: Math.max(0, fetchedCount - rows.length),
        meta: { querySummaries, removedStaleCount },
      });
    }

    return {
      status: "success",
      dryRun,
      queryCount: queries.length,
      fetchedCount,
      candidateCount: rows.length,
      upsertedCount: dryRun ? 0 : rows.length,
      removedStaleCount,
      skippedCount: Math.max(0, fetchedCount - rows.length),
      hasGitHubToken: Boolean(getGitHubToken()),
      querySummaries,
    };
  } catch (error) {
    if (supabase) {
      await finishModelHubSyncRun(supabase, run?.id ?? null, {
        status: "failed",
        queryCount: queries.length,
        fetchedCount,
        upsertedCount: 0,
        skippedCount: Math.max(0, fetchedCount - candidateMap.size),
        errorMessage: error instanceof Error ? error.message : String(error),
        meta: { querySummaries },
      });
    }
    throw error;
  }
}

export async function getModelHubPageData(params: {
  category?: string | null;
  limit?: number;
}) {
  const supabase = createServiceSupabaseClient();
  const result = await listModelHubItems(supabase, {
    category: params.category,
    limit: params.limit ?? 48,
  });
  return {
    ...result,
    configured: true,
  };
}
