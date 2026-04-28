import fs from "node:fs";
import path from "node:path";

import { computeDynamicQualityScore } from "@/lib/journal-score";
import { getJournalKeyCandidates } from "@/lib/journal-normalization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type JournalQualityRow = {
  journal_name: string;
  aliases: string[] | null;
  tier: string;
  weight: number | null;
  impact_factor: number | null;
  jcr_quartile: string | null;
  cas_zone: string | null;
};

type PaperRow = {
  id: string;
  pmid: string | null;
  title: string | null;
  journal: string | null;
  ai_med_score: number | null;
  quality_score: number | null;
  quality_tier: string | null;
  journal_if: number | null;
  journal_jcr: string | null;
  journal_cas_zone: string | null;
  publication_date: string | null;
};

type PlannedUpdate = {
  id: string;
  pmid: string | null;
  title: string | null;
  journal: string | null;
  publication_date: string | null;
  matched_journal_quality: string;
  previous: {
    quality_tier: string | null;
    quality_score: number | null;
    journal_if: number | null;
    journal_jcr: string | null;
    journal_cas_zone: string | null;
  };
  next: {
    quality_tier: string;
    quality_score: number;
    journal_if: number | null;
    journal_jcr: string | null;
    journal_cas_zone: string | null;
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

function sameNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  epsilon = 0.0001,
) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}

function buildMatcher(journals: JournalQualityRow[]) {
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
  journalName: string | null,
) {
  for (const key of getJournalKeyCandidates(journalName)) {
    const matched = matcher.get(key);
    if (matched) return matched;
  }
  return null;
}

async function fetchPaperBatch(from: number, to: number) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("papers")
    .select(
      "id,pmid,title,journal,ai_med_score,quality_score,quality_tier,journal_if,journal_jcr,journal_cas_zone,publication_date",
    )
    .eq("is_ai_med", true)
    .range(from, to);
  if (error) throw new Error(`Load papers failed: ${error.message}`);
  return (data ?? []) as PaperRow[];
}

function buildPlan(
  paper: PaperRow,
  journal: JournalQualityRow,
): PlannedUpdate | null {
  const dynamic = computeDynamicQualityScore({
    aiMedScore: Number(paper.ai_med_score ?? 0),
    baseWeight: journal.weight ?? 0.5,
    impactFactor: journal.impact_factor,
    jcrQuartile: journal.jcr_quartile,
    casZone: journal.cas_zone,
  });
  const next = {
    quality_tier: journal.tier.toLowerCase(),
    quality_score: dynamic.qualityScore,
    journal_if: dynamic.impactFactor,
    journal_jcr: dynamic.jcrQuartile,
    journal_cas_zone: dynamic.casZone,
  };

  const unchanged =
    cleanText(paper.quality_tier).toLowerCase() === next.quality_tier &&
    sameNullableNumber(paper.quality_score, next.quality_score, 0.001) &&
    sameNullableNumber(paper.journal_if, next.journal_if) &&
    cleanText(paper.journal_jcr) === cleanText(next.journal_jcr) &&
    cleanText(paper.journal_cas_zone) === cleanText(next.journal_cas_zone);

  if (unchanged) return null;

  return {
    id: paper.id,
    pmid: paper.pmid,
    title: paper.title,
    journal: paper.journal,
    publication_date: paper.publication_date,
    matched_journal_quality: journal.journal_name,
    previous: {
      quality_tier: paper.quality_tier,
      quality_score: paper.quality_score,
      journal_if: paper.journal_if,
      journal_jcr: paper.journal_jcr,
      journal_cas_zone: paper.journal_cas_zone,
    },
    next,
  };
}

async function main() {
  loadLocalEnvFiles();

  const apply = hasFlag("--apply");
  const confirmed = hasFlag("--yes-i-understand-this-writes-to-database");
  if (apply && !confirmed) {
    throw new Error(
      "Refusing to write. Re-run with --apply --yes-i-understand-this-writes-to-database after reviewing dry-run output.",
    );
  }

  const supabase = createServiceSupabaseClient();
  const { data: journalRows, error: journalError } = await supabase
    .from("journal_quality")
    .select("journal_name,aliases,tier,weight,impact_factor,jcr_quartile,cas_zone")
    .eq("is_active", true);
  if (journalError) throw new Error(`Load journal_quality failed: ${journalError.message}`);

  const matcher = buildMatcher((journalRows ?? []) as JournalQualityRow[]);
  const plannedUpdates: PlannedUpdate[] = [];

  for (let from = 0; ; from += 1000) {
    const papers = await fetchPaperBatch(from, from + 999);
    if (!papers.length) break;
    for (const paper of papers) {
      const journal = resolveJournal(matcher, paper.journal);
      if (!journal) continue;
      const plan = buildPlan(paper, journal);
      if (plan) plannedUpdates.push(plan);
    }
    if (papers.length < 1000) break;
  }

  if (apply) {
    for (const update of plannedUpdates) {
      const { error } = await supabase
        .from("papers")
        .update({
          quality_tier: update.next.quality_tier,
          quality_score: update.next.quality_score,
          journal_if: update.next.journal_if,
          journal_jcr: update.next.journal_jcr,
          journal_cas_zone: update.next.journal_cas_zone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", update.id);
      if (error) throw new Error(`Update paper ${update.id} failed: ${error.message}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        planned_update_count: plannedUpdates.length,
        planned_updates: plannedUpdates,
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
