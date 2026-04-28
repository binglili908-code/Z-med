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

function sameNullableNumber(a: number | null, b: number | null) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}

function sameText(a: string | null, b: string | null) {
  return (a ?? "").trim() === (b ?? "").trim();
}

function buildTargetKeys(journal: JournalQualityRow) {
  const keys = new Set<string>();
  for (const key of getJournalKeyCandidates(journal.journal_name)) keys.add(key);
  for (const alias of journal.aliases ?? []) {
    for (const key of getJournalKeyCandidates(alias)) keys.add(key);
  }
  return keys;
}

function paperMatchesTarget(row: PaperRow, targetKeys: Set<string>) {
  return getJournalKeyCandidates(row.journal).some((key) => targetKeys.has(key));
}

function buildPlan(row: PaperRow, journal: JournalQualityRow): PlannedUpdate | null {
  const dynamic = computeDynamicQualityScore({
    aiMedScore: Number(row.ai_med_score ?? 0),
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
    sameText(row.quality_tier, next.quality_tier) &&
    sameNullableNumber(row.quality_score, next.quality_score) &&
    sameNullableNumber(row.journal_if, next.journal_if) &&
    sameText(row.journal_jcr, next.journal_jcr) &&
    sameText(row.journal_cas_zone, next.journal_cas_zone);

  if (unchanged) return null;

  return {
    id: row.id,
    pmid: row.pmid,
    title: row.title,
    journal: row.journal,
    publication_date: row.publication_date,
    previous: {
      quality_tier: row.quality_tier,
      quality_score: row.quality_score,
      journal_if: row.journal_if,
      journal_jcr: row.journal_jcr,
      journal_cas_zone: row.journal_cas_zone,
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

  const targetKey = "lancet digital health";
  const targetJournal = ((journalRows ?? []) as JournalQualityRow[]).find((row) =>
    buildTargetKeys(row).has(targetKey),
  );
  if (!targetJournal) {
    throw new Error("Could not find The Lancet Digital Health in journal_quality");
  }

  const targetKeys = buildTargetKeys(targetJournal);
  const { data: paperRows, error: paperError } = await supabase
    .from("papers")
    .select(
      "id,pmid,title,journal,ai_med_score,quality_score,quality_tier,journal_if,journal_jcr,journal_cas_zone,publication_date",
    )
    .ilike("journal", "%Lancet%")
    .order("publication_date", { ascending: false });
  if (paperError) throw new Error(`Load papers failed: ${paperError.message}`);

  const matchingRows = ((paperRows ?? []) as PaperRow[]).filter((row) =>
    paperMatchesTarget(row, targetKeys),
  );
  const plannedUpdates = matchingRows
    .map((row) => buildPlan(row, targetJournal))
    .filter((row): row is PlannedUpdate => Boolean(row));

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

  const output = {
    mode: apply ? "apply" : "dry-run",
    target_journal: targetJournal,
    matched_paper_count: matchingRows.length,
    planned_update_count: plannedUpdates.length,
    planned_updates: plannedUpdates,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
