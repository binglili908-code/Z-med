import fs from "node:fs";
import path from "node:path";

import { computeDynamicQualityScore } from "@/lib/journal-score";
import { getJournalKeyCandidates } from "@/lib/journal-normalization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type JournalQualityRow = {
  id: string;
  journal_name: string | null;
  aliases: string[] | null;
  tier: string | null;
  weight: number | null;
  impact_factor: number | null;
  jcr_quartile: string | null;
  cas_zone: string | null;
  is_active: boolean | null;
  es_sync_status: string | null;
  es_error: string | null;
};

type PaperRow = {
  id: string;
  pmid: string | null;
  title: string | null;
  journal: string | null;
  is_ai_med: boolean | null;
  ai_med_score: number | null;
  quality_score: number | null;
  quality_tier: string | null;
  journal_if: number | null;
  journal_jcr: string | null;
  journal_cas_zone: string | null;
  publication_date: string | null;
};

type RpcJournalResult = {
  tier?: string | null;
  weight?: number | string | null;
  impact_factor?: number | string | null;
  jcr?: string | null;
  cas_zone?: string | null;
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

function addJournalToMatcher(
  matcher: Map<string, JournalQualityRow>,
  duplicateKeys: Map<string, Set<string>>,
  journal: JournalQualityRow,
) {
  for (const value of [journal.journal_name ?? "", ...(journal.aliases ?? [])]) {
    for (const key of getJournalKeyCandidates(value)) {
      const names = duplicateKeys.get(key) ?? new Set<string>();
      names.add(journal.journal_name ?? "");
      duplicateKeys.set(key, names);
      if (!matcher.has(key)) matcher.set(key, journal);
    }
  }
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

async function loadRpcJournalResult(journal: string) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.rpc("get_journal_tier_and_weight", {
    p_journal: journal,
  });
  if (error) return { error: error.message, data: null };
  const row = Array.isArray(data) ? data[0] : data;
  return { error: null, data: (row ?? null) as RpcJournalResult | null };
}

async function main() {
  loadLocalEnvFiles();

  const journals = await fetchAll<JournalQualityRow>(
    "journal_quality",
    "id,journal_name,aliases,tier,weight,impact_factor,jcr_quartile,cas_zone,is_active,es_sync_status,es_error",
  );
  const papers = await fetchAll<PaperRow>(
    "papers",
    "id,pmid,title,journal,is_ai_med,ai_med_score,quality_score,quality_tier,journal_if,journal_jcr,journal_cas_zone,publication_date",
  );

  const activeJournals = journals.filter((journal) => journal.is_active);
  const matcher = new Map<string, JournalQualityRow>();
  const duplicateKeyMap = new Map<string, Set<string>>();
  for (const journal of activeJournals) {
    addJournalToMatcher(matcher, duplicateKeyMap, journal);
  }

  const aiPapers = papers.filter((paper) => paper.is_ai_med);
  const unmatchedByJournal = new Map<string, PaperRow[]>();
  const matchedMismatches = [];
  const scoreOutliers = [];

  for (const paper of aiPapers) {
    if (Number(paper.quality_score ?? 0) > 1.2 || Number(paper.ai_med_score ?? 0) > 1) {
      scoreOutliers.push(paper);
    }

    const matched = resolveJournal(matcher, paper.journal);
    if (!matched) {
      const key = paper.journal ?? "";
      unmatchedByJournal.set(key, [...(unmatchedByJournal.get(key) ?? []), paper]);
      continue;
    }

    const expected = computeDynamicQualityScore({
      aiMedScore: Number(paper.ai_med_score ?? 0),
      baseWeight: matched.weight ?? 0.5,
      impactFactor: matched.impact_factor,
      jcrQuartile: matched.jcr_quartile,
      casZone: matched.cas_zone,
    });
    const hasMismatch =
      cleanText(paper.quality_tier).toLowerCase() !==
        cleanText(matched.tier).toLowerCase() ||
      !sameNullableNumber(paper.journal_if, expected.impactFactor) ||
      cleanText(paper.journal_jcr) !== cleanText(expected.jcrQuartile) ||
      cleanText(paper.journal_cas_zone) !== cleanText(expected.casZone) ||
      !sameNullableNumber(paper.quality_score, expected.qualityScore, 0.001);

    if (hasMismatch) {
      matchedMismatches.push({
        pmid: paper.pmid,
        title: paper.title,
        journal: paper.journal,
        publication_date: paper.publication_date,
        current: {
          tier: paper.quality_tier,
          score: paper.quality_score,
          impact_factor: paper.journal_if,
          jcr: paper.journal_jcr,
          cas_zone: paper.journal_cas_zone,
        },
        expected_from_journal_quality: {
          journal_name: matched.journal_name,
          tier: matched.tier,
          score: expected.qualityScore,
          impact_factor: expected.impactFactor,
          jcr: expected.jcrQuartile,
          cas_zone: expected.casZone,
        },
      });
    }
  }

  const unmatchedSummaries = [];
  for (const [journal, rows] of unmatchedByJournal.entries()) {
    const rpc = journal ? await loadRpcJournalResult(journal) : { error: null, data: null };
    unmatchedSummaries.push({
      journal,
      paper_count: rows.length,
      missing_if_count: rows.filter((row) => row.journal_if == null).length,
      current_tiers: Array.from(new Set(rows.map((row) => row.quality_tier ?? "null"))).sort(),
      current_if_values: Array.from(new Set(rows.map((row) => row.journal_if))).sort((a, b) =>
        Number(a ?? 0) - Number(b ?? 0),
      ),
      rpc_error: rpc.error,
      rpc_data: rpc.data,
      examples: rows.slice(0, 3).map((row) => ({
        pmid: row.pmid,
        title: row.title,
        publication_date: row.publication_date,
        quality_tier: row.quality_tier,
        journal_if: row.journal_if,
        quality_score: row.quality_score,
      })),
    });
  }

  const tierSummary = Array.from(
    activeJournals.reduce((map, journal) => {
      const tier = cleanText(journal.tier).toLowerCase() || "null";
      map.set(tier, [...(map.get(tier) ?? []), journal]);
      return map;
    }, new Map<string, JournalQualityRow[]>()),
  ).map(([tier, rows]) => ({
    tier,
    count: rows.length,
    missing_if: rows.filter((row) => row.impact_factor == null).length,
    missing_jcr: rows.filter((row) => !cleanText(row.jcr_quartile)).length,
    missing_cas: rows.filter((row) => !cleanText(row.cas_zone)).length,
    missing_weight: rows.filter((row) => row.weight == null).length,
    min_weight: Math.min(...rows.map((row) => Number(row.weight ?? 0))),
    max_weight: Math.max(...rows.map((row) => Number(row.weight ?? 0))),
  }));

  const output = {
    generated_at: new Date().toISOString(),
    note: "Read-only audit. This script does not update database rows.",
    counts: {
      journal_quality_total: journals.length,
      journal_quality_active: activeJournals.length,
      papers_total: papers.length,
      ai_med_papers: aiPapers.length,
      ai_med_unmatched_journal_quality: Array.from(unmatchedByJournal.values()).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
      matched_snapshot_mismatch_count: matchedMismatches.length,
      score_outlier_count: scoreOutliers.length,
    },
    journal_quality_summary: tierSummary.sort((a, b) => a.tier.localeCompare(b.tier)),
    easyscholar_status_counts: activeJournals.reduce<Record<string, number>>((acc, row) => {
      const status = cleanText(row.es_sync_status) || "null";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {}),
    duplicate_normalized_journal_keys: Array.from(duplicateKeyMap.entries())
      .map(([key, names]) => ({ key, journal_names: Array.from(names).sort() }))
      .filter((row) => row.journal_names.length > 1),
    active_journal_quality_missing_metrics: activeJournals
      .filter(
        (journal) =>
          journal.impact_factor == null ||
          !cleanText(journal.jcr_quartile) ||
          !cleanText(journal.cas_zone) ||
          journal.weight == null,
      )
      .map((journal) => ({
        journal_name: journal.journal_name,
        tier: journal.tier,
        weight: journal.weight,
        impact_factor: journal.impact_factor,
        jcr_quartile: journal.jcr_quartile,
        cas_zone: journal.cas_zone,
        es_sync_status: journal.es_sync_status,
        es_error: journal.es_error,
      })),
    matched_snapshot_mismatches: matchedMismatches,
    unmatched_ai_med_journals: unmatchedSummaries.sort(
      (a, b) => b.paper_count - a.paper_count,
    ),
    score_outliers: scoreOutliers.map((paper) => ({
      pmid: paper.pmid,
      journal: paper.journal,
      ai_med_score: paper.ai_med_score,
      quality_score: paper.quality_score,
      quality_tier: paper.quality_tier,
      publication_date: paper.publication_date,
    })),
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
