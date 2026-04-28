import fs from "node:fs";
import path from "node:path";

import { getJournalKeyCandidates } from "@/lib/journal-normalization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Tier = "top" | "core" | "emerging";
type CandidateAction = "insert" | "update" | "upsert" | "hold";

type Candidate = {
  confirmed?: boolean;
  action?: CandidateAction;
  risk?: string | null;
  journal_name?: string | null;
  aliases?: string[] | null;
  tier?: Tier | null;
  weight?: number | null;
  impact_factor?: number | null;
  jcr_quartile?: string | null;
  cas_zone?: string | null;
  review_note?: string | null;
};

type CandidateFile = {
  candidates?: Candidate[];
};

type JournalQualityRow = {
  id: string;
  journal_name: string;
  aliases: string[] | null;
  tier: string | null;
  weight: number | null;
  impact_factor: number | null;
  jcr_quartile: string | null;
  cas_zone: string | null;
  is_active: boolean | null;
};

type PaperRow = {
  id: string;
  journal: string | null;
  is_ai_med: boolean | null;
};

type PlannedChange = {
  action: "insert" | "update";
  journal_name: string;
  matched_existing_journal: string | null;
  risk: string | null;
  review_note: string | null;
  affected_ai_med_papers: number;
  previous: Partial<JournalQualityRow> | null;
  next: {
    journal_name: string;
    aliases: string[];
    tier: Tier;
    weight: number;
    impact_factor: number | null;
    jcr_quartile: string | null;
    cas_zone: string | null;
    is_active: true;
    es_sync_status: "success";
    es_error: null;
  };
};

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
  return (value ?? "").trim();
}

function normalizeCasZone(value: string | null | undefined) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  return cleaned.replace(/\s+区$/, "区");
}

function normalizeJcr(value: string | null | undefined) {
  const cleaned = cleanText(value).toUpperCase();
  return cleaned || null;
}

function assertTier(value: string | null | undefined): Tier {
  const tier = cleanText(value).toLowerCase();
  if (tier === "top" || tier === "core" || tier === "emerging") return tier;
  throw new Error(`Invalid tier "${value}". Expected top, core, or emerging.`);
}

function assertFiniteNumber(
  value: number | null | undefined,
  field: string,
  journalName: string,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${journalName}: ${field} must be a finite number.`);
  }
  return value;
}

function buildJournalMatcher(journals: JournalQualityRow[]) {
  const matcher = new Map<string, JournalQualityRow>();
  for (const journal of journals) {
    for (const value of [journal.journal_name, ...(journal.aliases ?? [])]) {
      for (const key of getJournalKeyCandidates(value)) {
        if (!matcher.has(key)) matcher.set(key, journal);
      }
    }
  }
  return matcher;
}

function resolveJournal(
  matcher: Map<string, JournalQualityRow>,
  journalName: string | null | undefined,
) {
  for (const key of getJournalKeyCandidates(journalName)) {
    const matched = matcher.get(key);
    if (matched) return matched;
  }
  return null;
}

function paperMatchesCandidate(paper: PaperRow, candidate: Candidate) {
  const candidateKeys = new Set<string>();
  for (const value of [candidate.journal_name ?? "", ...(candidate.aliases ?? [])]) {
    for (const key of getJournalKeyCandidates(value)) candidateKeys.add(key);
  }
  return getJournalKeyCandidates(paper.journal).some((key) => candidateKeys.has(key));
}

function parseCandidatePath() {
  return process.argv.find((arg) => arg.endsWith(".json")) ?? "";
}

async function fetchAll<T>(table: string, select: string) {
  const supabase = createServiceSupabaseClient();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + 999);
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function buildPlan(
  candidates: Candidate[],
  journals: JournalQualityRow[],
  papers: PaperRow[],
) {
  const matcher = buildJournalMatcher(journals);
  const plannedChanges: PlannedChange[] = [];
  const skipped = [];

  for (const candidate of candidates) {
    const journalName = cleanText(candidate.journal_name);
    const action = candidate.action ?? "upsert";

    if (!candidate.confirmed) {
      skipped.push({
        journal_name: journalName,
        reason: "confirmed is not true",
        risk: candidate.risk ?? null,
        action,
      });
      continue;
    }
    if (action === "hold") {
      skipped.push({
        journal_name: journalName,
        reason: "action is hold",
        risk: candidate.risk ?? null,
        action,
      });
      continue;
    }
    if (!journalName) throw new Error("Confirmed candidate is missing journal_name.");

    const existing = resolveJournal(matcher, journalName);
    if (action === "insert" && existing) {
      throw new Error(`${journalName}: action is insert but an existing row matched ${existing.journal_name}.`);
    }
    if (action === "update" && !existing) {
      throw new Error(`${journalName}: action is update but no existing row matched.`);
    }

    const aliases = Array.from(
      new Set(
        [
          ...(existing?.aliases ?? []),
          ...(candidate.aliases ?? []),
        ]
          .map((alias) => cleanText(alias))
          .filter(Boolean),
      ),
    );
    const next = {
      journal_name: journalName,
      aliases,
      tier: assertTier(candidate.tier),
      weight: assertFiniteNumber(candidate.weight, "weight", journalName),
      impact_factor: candidate.impact_factor ?? null,
      jcr_quartile: normalizeJcr(candidate.jcr_quartile),
      cas_zone: normalizeCasZone(candidate.cas_zone),
      is_active: true as const,
      es_sync_status: "success" as const,
      es_error: null,
    };

    plannedChanges.push({
      action: existing ? "update" : "insert",
      journal_name: journalName,
      matched_existing_journal: existing?.journal_name ?? null,
      risk: candidate.risk ?? null,
      review_note: candidate.review_note ?? null,
      affected_ai_med_papers: papers.filter(
        (paper) => paper.is_ai_med && paperMatchesCandidate(paper, candidate),
      ).length,
      previous: existing
        ? {
            id: existing.id,
            journal_name: existing.journal_name,
            aliases: existing.aliases,
            tier: existing.tier,
            weight: existing.weight,
            impact_factor: existing.impact_factor,
            jcr_quartile: existing.jcr_quartile,
            cas_zone: existing.cas_zone,
            is_active: existing.is_active,
          }
        : null,
      next,
    });
  }

  return { plannedChanges, skipped };
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
      "Missing candidate JSON path. Example: npx tsx src/scripts/upsert-confirmed-journal-quality.ts docs/journal-quality-candidates-2026-04-28.json",
    );
  }
  const raw = fs.readFileSync(path.resolve(candidatePath), "utf-8");
  const parsed = JSON.parse(raw) as CandidateFile;
  const candidates = parsed.candidates ?? [];

  const supabase = createServiceSupabaseClient();
  const [journals, papers] = await Promise.all([
    fetchAll<JournalQualityRow>(
      "journal_quality",
      "id,journal_name,aliases,tier,weight,impact_factor,jcr_quartile,cas_zone,is_active",
    ),
    fetchAll<PaperRow>("papers", "id,journal,is_ai_med"),
  ]);

  const { plannedChanges, skipped } = buildPlan(candidates, journals, papers);

  if (apply) {
    for (const change of plannedChanges) {
      const payload = {
        ...change.next,
        updated_at: new Date().toISOString(),
      };

      if (change.action === "update") {
        const existing = change.previous;
        if (!existing?.id) throw new Error(`${change.journal_name}: missing existing id.`);
        const { error } = await supabase.from("journal_quality").update(payload).eq("id", existing.id);
        if (error) throw new Error(`Update ${change.journal_name} failed: ${error.message}`);
      } else {
        const { error } = await supabase.from("journal_quality").insert(payload);
        if (error) throw new Error(`Insert ${change.journal_name} failed: ${error.message}`);
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        candidate_count: candidates.length,
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
