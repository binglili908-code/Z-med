import fs from "node:fs";
import path from "node:path";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type CurationStatus = "featured" | "recommended" | "watchlist" | "hold" | "archived";

type Candidate = {
  full_name?: string | null;
  github_id?: number | null;
  confirmed?: boolean;
  curation_status?: CurationStatus | null;
  curated_score?: number | null;
  curator_summary?: string | null;
  curated_recommendation_reason?: string | null;
  project_understanding?: string | null;
  risk_notes?: string | null;
  target_users?: string[] | null;
  curation_tags?: string[] | null;
  curation_notes?: string | null;
  curated_at?: string | null;
  curated_by?: string | null;
};

type CandidateFile = {
  curation_date?: string | null;
  curated_by?: string | null;
  candidates?: Candidate[];
};

type ExistingModelHubItem = {
  id: string;
  github_id: number | null;
  full_name: string | null;
  curation_status: string | null;
  curated_score: number | string | null;
  curator_summary: string | null;
  curated_at: string | null;
};

type SupabaseClient = ReturnType<typeof createServiceSupabaseClient>;

type PlannedChange = {
  full_name: string;
  github_id: number | null;
  previous: Pick<
    ExistingModelHubItem,
    "curation_status" | "curated_score" | "curator_summary" | "curated_at"
  >;
  next: {
    curator_summary: string | null;
    curated_recommendation_reason: string | null;
    project_understanding: string | null;
    risk_notes: string | null;
    target_users: string[];
    curation_tags: string[];
    curated_score: number | null;
    curation_status: CurationStatus;
    curated_at: string;
    curated_by: string | null;
    curation_notes: string | null;
  };
};

const CURATION_STATUSES = new Set<CurationStatus>([
  "featured",
  "recommended",
  "watchlist",
  "hold",
  "archived",
]);

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] != null) continue;
    process.env[key] = unquoteEnvValue(line.slice(separatorIndex + 1));
  }
}

function loadLocalEnvFiles() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env"));
  loadEnvFile(path.join(root, ".env.local"));
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function cleanText(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned || null;
}

function cleanTextArray(values: string[] | null | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean),
    ),
  );
}

function parseCandidatePath() {
  return process.argv.find((arg) => arg.endsWith(".json")) ?? "";
}

function assertStatus(value: string | null | undefined): CurationStatus {
  const status = (value ?? "").trim() as CurationStatus;
  if (CURATION_STATUSES.has(status)) return status;
  throw new Error(
    `Invalid curation_status "${value}". Expected ${Array.from(CURATION_STATUSES).join(", ")}.`,
  );
}

function normalizeScore(value: number | null | undefined, fullName: string) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${fullName}: curated_score must be a number between 0 and 100.`);
  }
  return Number(value.toFixed(2));
}

function buildMatcher(items: ExistingModelHubItem[]) {
  const byFullName = new Map<string, ExistingModelHubItem>();
  const byGithubId = new Map<number, ExistingModelHubItem>();
  for (const item of items) {
    if (item.full_name) byFullName.set(item.full_name.toLowerCase(), item);
    if (typeof item.github_id === "number") byGithubId.set(item.github_id, item);
  }
  return { byFullName, byGithubId };
}

function resolveItem(
  matcher: ReturnType<typeof buildMatcher>,
  candidate: Candidate,
) {
  if (typeof candidate.github_id === "number") {
    const byId = matcher.byGithubId.get(candidate.github_id);
    if (byId) return byId;
  }
  const fullName = cleanText(candidate.full_name);
  return fullName ? matcher.byFullName.get(fullName.toLowerCase()) ?? null : null;
}

function buildPlan(
  candidateFile: CandidateFile,
  existingItems: ExistingModelHubItem[],
) {
  const matcher = buildMatcher(existingItems);
  const plannedChanges: PlannedChange[] = [];
  const skipped: Array<Record<string, unknown>> = [];
  const candidates = candidateFile.candidates ?? [];

  for (const candidate of candidates) {
    const label = cleanText(candidate.full_name) ?? String(candidate.github_id ?? "unknown");
    if (!candidate.confirmed) {
      skipped.push({ full_name: label, reason: "confirmed is not true" });
      continue;
    }

    const existing = resolveItem(matcher, candidate);
    if (!existing?.id || !existing.full_name) {
      skipped.push({ full_name: label, reason: "no matching model_hub_items row" });
      continue;
    }

    const curatedAt =
      cleanText(candidate.curated_at) ??
      cleanText(candidateFile.curation_date) ??
      new Date().toISOString();

    plannedChanges.push({
      full_name: existing.full_name,
      github_id: existing.github_id,
      previous: {
        curation_status: existing.curation_status,
        curated_score: existing.curated_score,
        curator_summary: existing.curator_summary,
        curated_at: existing.curated_at,
      },
      next: {
        curator_summary: cleanText(candidate.curator_summary),
        curated_recommendation_reason: cleanText(candidate.curated_recommendation_reason),
        project_understanding: cleanText(candidate.project_understanding),
        risk_notes: cleanText(candidate.risk_notes),
        target_users: cleanTextArray(candidate.target_users),
        curation_tags: cleanTextArray(candidate.curation_tags),
        curated_score: normalizeScore(candidate.curated_score, existing.full_name),
        curation_status: assertStatus(candidate.curation_status),
        curated_at: new Date(curatedAt).toISOString(),
        curated_by: cleanText(candidate.curated_by) ?? cleanText(candidateFile.curated_by),
        curation_notes: cleanText(candidate.curation_notes),
      },
    });
  }

  return { plannedChanges, skipped };
}

function isMissingCurationColumnError(error: { message?: string; code?: string }) {
  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    [
      "curation_status",
      "curated_score",
      "curator_summary",
      "curated_at",
    ].some((column) => message.includes(column))
  );
}

async function fetchExistingModelHubItems(supabase: SupabaseClient) {
  const extended = await supabase
    .from("model_hub_items")
    .select("id,github_id,full_name,curation_status,curated_score,curator_summary,curated_at");

  if (!extended.error) return (extended.data ?? []) as ExistingModelHubItem[];
  if (!isMissingCurationColumnError(extended.error)) {
    throw new Error(`Failed to read model_hub_items: ${extended.error.message}`);
  }

  const fallback = await supabase
    .from("model_hub_items")
    .select("id,github_id,full_name");
  if (fallback.error) {
    throw new Error(`Failed to read model_hub_items: ${fallback.error.message}`);
  }

  return ((fallback.data ?? []) as Array<Pick<
    ExistingModelHubItem,
    "id" | "github_id" | "full_name"
  >>).map((item) => ({
    ...item,
    curation_status: null,
    curated_score: null,
    curator_summary: null,
    curated_at: null,
  }));
}

async function main() {
  loadLocalEnvFiles();

  const apply = hasFlag("--apply");
  const confirmedWrite = hasFlag("--yes-i-understand-this-writes-to-database");
  if (apply && !confirmedWrite) {
    throw new Error(
      "Refusing to write. Re-run with --apply --yes-i-understand-this-writes-to-database after reviewing dry-run output.",
    );
  }

  const candidatePath = parseCandidatePath();
  if (!candidatePath) {
    throw new Error(
      "Missing curation JSON path. Example: npm run model-hub:curation -- docs/model-hub-curation/2026-04-29.json",
    );
  }

  const raw = fs.readFileSync(path.resolve(candidatePath), "utf-8");
  const candidateFile = JSON.parse(raw) as CandidateFile;

  const supabase = createServiceSupabaseClient();
  const existingItems = await fetchExistingModelHubItems(supabase);
  const { plannedChanges, skipped } = buildPlan(candidateFile, existingItems);

  if (apply) {
    for (const change of plannedChanges) {
      const { error: updateError } = await supabase
        .from("model_hub_items")
        .update(change.next)
        .eq("full_name", change.full_name);
      if (updateError) {
        throw new Error(`Update ${change.full_name} failed: ${updateError.message}`);
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        candidate_count: candidateFile.candidates?.length ?? 0,
        planned_change_count: plannedChanges.length,
        skipped_count: skipped.length,
        planned_changes: plannedChanges,
        skipped,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
