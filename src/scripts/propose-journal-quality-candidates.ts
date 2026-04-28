import fs from "node:fs";
import path from "node:path";

import { getJournalKeyCandidates } from "@/lib/journal-normalization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type JournalQualityRow = {
  journal_name: string | null;
  aliases: string[] | null;
};

type PaperRow = {
  pmid: string | null;
  title: string | null;
  journal: string | null;
  is_ai_med: boolean | null;
  quality_tier: string | null;
  quality_score: number | null;
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

function buildKnownKeys(journals: JournalQualityRow[]) {
  const keys = new Set<string>();
  for (const journal of journals) {
    for (const value of [journal.journal_name ?? "", ...(journal.aliases ?? [])]) {
      for (const key of getJournalKeyCandidates(value)) keys.add(key);
    }
  }
  return keys;
}

function isKnownJournal(knownKeys: Set<string>, journalName: string | null) {
  return getJournalKeyCandidates(journalName).some((key) => knownKeys.has(key));
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

  const journalRows = await fetchAll<JournalQualityRow>(
    "journal_quality",
    "journal_name,aliases,is_active",
  );
  const knownKeys = buildKnownKeys(journalRows);
  const paperRows = await fetchAll<PaperRow>(
    "papers",
    "pmid,title,journal,quality_tier,quality_score,journal_if,journal_jcr,journal_cas_zone,publication_date,is_ai_med",
  );

  const groups = new Map<string, PaperRow[]>();
  for (const paper of paperRows) {
    if (!paper.is_ai_med) continue;
    if (!paper.journal || isKnownJournal(knownKeys, paper.journal)) continue;
    const rows = groups.get(paper.journal) ?? [];
    rows.push(paper);
    groups.set(paper.journal, rows);
  }

  const candidates = [];
  for (const [journal, rows] of groups.entries()) {
    const rpc = await loadRpcJournalResult(journal);
    candidates.push({
      journal,
      ai_med_paper_count: rows.length,
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

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "proposal-only",
        note:
          "Read-only candidate list. RPC data is shown for review and should not be trusted blindly.",
        candidate_count: candidates.length,
        candidates: candidates.sort((a, b) => b.ai_med_paper_count - a.ai_med_paper_count),
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
