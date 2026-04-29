import fs from "node:fs";
import path from "node:path";

import {
  runSemanticScholarCandidateQualityRefreshJob,
  runSemanticScholarDiscoveryJob,
  runSemanticScholarEnrichmentJob,
  runSemanticScholarPromotionDryRunJob,
} from "../lib/semantic-scholar";
import { createServiceSupabaseClient } from "../lib/supabase/service";

type CandidateRow = {
  id: string;
  s2_paper_id: string;
  title: string;
  doi: string | null;
  pmid: string | null;
  venue: string | null;
  year: number | null;
  quality_score: number | string | null;
  quality_reasons: string[] | null;
  is_review_like: boolean | null;
  eligible_for_promotion: boolean | null;
  status: string;
  pubmed_verification_status: string;
  pubmed_verified_pmid: string | null;
  promotion_score: number | string | null;
  promotion_reasons: string[] | null;
  promotion_checked_at: string | null;
  created_at: string;
};

type EnrichmentRow = {
  s2_paper_id: string | null;
  doi: string | null;
  citation_count: number | null;
  raw_payload: Record<string, unknown> | null;
};

type CliOptions = {
  refresh: boolean;
  discovery: boolean;
  format: "markdown" | "json";
  enrichmentBatches: number;
  enrichmentBatchSize: number;
  seedLimit: number;
  recommendationLimit: number;
  minSeedCitationCount: number;
  reviewLimit: number;
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

function parseNumberFlag(args: string[], name: string, defaultValue: number) {
  const prefix = `--${name}=`;
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : defaultValue;
}

function parseCliOptions(args: string[]): CliOptions {
  const format = args.includes("--json") ? "json" : "markdown";
  const refresh = args.includes("--refresh");
  return {
    refresh,
    discovery: args.includes("--discovery"),
    format,
    enrichmentBatches: parseNumberFlag(args, "enrichment-batches", refresh ? 1 : 0),
    enrichmentBatchSize: parseNumberFlag(args, "enrichment-batch-size", 150),
    seedLimit: parseNumberFlag(args, "seed-limit", 10),
    recommendationLimit: parseNumberFlag(args, "recommendation-limit", 50),
    minSeedCitationCount: parseNumberFlag(args, "min-seed-citations", 5),
    reviewLimit: parseNumberFlag(args, "review-limit", 20),
  };
}

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatScore(value: unknown) {
  return asNumber(value).toFixed(4);
}

function compactReasons(reasons: string[] | null | undefined) {
  return (reasons ?? []).slice(0, 6).join(", ") || "none";
}

async function countRows(
  table: "papers" | "semantic_scholar_paper_enrichments" | "semantic_scholar_candidates",
) {
  const supabase = createServiceSupabaseClient();
  const { count, error } = await supabase.from(table).select("*", {
    count: "exact",
    head: true,
  });
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return count ?? 0;
}

async function countAiMedPapers() {
  const supabase = createServiceSupabaseClient();
  const { count, error } = await supabase
    .from("papers")
    .select("*", { count: "exact", head: true })
    .eq("is_ai_med", true);
  if (error) throw new Error(`Failed to count AI-med papers: ${error.message}`);
  return count ?? 0;
}

async function runRefresh(options: CliOptions) {
  const enrichment = [];
  for (let i = 0; i < options.enrichmentBatches; i += 1) {
    const result = await runSemanticScholarEnrichmentJob({
      batchSize: options.enrichmentBatchSize,
      staleDays: 30,
    });
    enrichment.push(result);
    if (result.selectedCount === 0) break;
  }

  const discovery = options.discovery
    ? await runSemanticScholarDiscoveryJob({
        seedLimit: options.seedLimit,
        recommendationLimit: options.recommendationLimit,
        minSeedCitationCount: options.minSeedCitationCount,
        candidateTtlDays: 30,
      })
    : null;

  const quality = await runSemanticScholarCandidateQualityRefreshJob({
    limit: Math.max(500, options.reviewLimit * 10),
  });
  const dryRun = await runSemanticScholarPromotionDryRunJob({
    limit: Math.max(50, options.reviewLimit),
    includeRejected: false,
    updateCandidates: true,
  });

  return { enrichment, discovery, quality, dryRun };
}

async function loadReviewPacket(options: CliOptions, refreshResult: unknown) {
  const supabase = createServiceSupabaseClient();
  const [
    papersTotal,
    aiMedPapers,
    enrichmentsTotal,
    candidatesTotal,
  ] = await Promise.all([
    countRows("papers"),
    countAiMedPapers(),
    countRows("semantic_scholar_paper_enrichments"),
    countRows("semantic_scholar_candidates"),
  ]);

  const { data: enrichmentRows, error: enrichmentError } = await supabase
    .from("semantic_scholar_paper_enrichments")
    .select("s2_paper_id,doi,citation_count,raw_payload")
    .limit(2000);
  if (enrichmentError) {
    throw new Error(`Failed to load enrichment summary: ${enrichmentError.message}`);
  }

  const { data: candidateRows, error: candidateError } = await supabase
    .from("semantic_scholar_candidates")
    .select(
      "id,s2_paper_id,title,doi,pmid,venue,year,quality_score,quality_reasons,is_review_like,eligible_for_promotion,status,pubmed_verification_status,pubmed_verified_pmid,promotion_score,promotion_reasons,promotion_checked_at,created_at",
    )
    .order("promotion_score", { ascending: false })
    .order("quality_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (candidateError) {
    throw new Error(`Failed to load candidate summary: ${candidateError.message}`);
  }

  const enrichments = (enrichmentRows ?? []) as EnrichmentRow[];
  const candidates = (candidateRows ?? []) as CandidateRow[];
  const matchedEnrichments = enrichments.filter((row) => Boolean(row.s2_paper_id));
  const unmatchedEnrichments = enrichments.filter(
    (row) => !row.s2_paper_id && row.raw_payload?.unmatched === true,
  );
  const duplicateEnrichments = enrichments.filter(
    (row) => !row.s2_paper_id && row.raw_payload?.duplicate === true,
  );

  const wouldPromote = candidates
    .filter((row) => row.promotion_reasons?.includes("would_promote_after_review"))
    .slice(0, options.reviewLimit);
  const verifiedHold = candidates
    .filter(
      (row) =>
        row.pubmed_verification_status === "verified" &&
        !row.promotion_reasons?.includes("would_promote_after_review"),
    )
    .slice(0, options.reviewLimit);
  const pendingNotFound = candidates
    .filter((row) => row.status === "pending" && row.pubmed_verification_status === "not_found")
    .slice(0, options.reviewLimit);
  const rejectedReview = candidates
    .filter((row) => row.status === "rejected" && row.is_review_like)
    .slice(0, options.reviewLimit);

  return {
    generatedAt: new Date().toISOString(),
    refreshResult,
    summary: {
      papersTotal,
      aiMedPapers,
      enrichmentsTotal,
      matchedEnrichments: matchedEnrichments.length,
      unmatchedEnrichments: unmatchedEnrichments.length,
      duplicateEnrichments: duplicateEnrichments.length,
      candidatesTotal,
      wouldPromoteCount: wouldPromote.length,
      verifiedHoldCount: verifiedHold.length,
      pendingNotFoundCount: pendingNotFound.length,
      rejectedReviewSampleCount: rejectedReview.length,
      maxCitationCount: Math.max(0, ...matchedEnrichments.map((row) => row.citation_count ?? 0)),
      seedCountGte5: matchedEnrichments.filter((row) => (row.citation_count ?? 0) >= 5).length,
    },
    lists: {
      wouldPromote,
      verifiedHold,
      pendingNotFound,
      rejectedReview,
    },
  };
}

function renderCandidateList(title: string, rows: CandidateRow[]) {
  if (!rows.length) return `## ${title}\n\nNone.\n`;
  const lines = [`## ${title}`, ""];
  rows.forEach((row, index) => {
    lines.push(
      `${index + 1}. ${row.title}`,
      `   - s2: ${row.s2_paper_id}`,
      `   - doi: ${row.doi ?? "none"} | pmid: ${row.pmid ?? "none"} | verified: ${row.pubmed_verified_pmid ?? "none"}`,
      `   - venue/year: ${row.venue ?? "unknown"} / ${row.year ?? "unknown"}`,
      `   - quality: ${formatScore(row.quality_score)} | promotion: ${formatScore(row.promotion_score)}`,
      `   - reasons: ${compactReasons(row.promotion_reasons ?? row.quality_reasons)}`,
      "",
    );
  });
  return lines.join("\n");
}

function renderMarkdown(packet: Awaited<ReturnType<typeof loadReviewPacket>>) {
  const lines = [
    "# Weekly Literature Review Packet",
    "",
    `Generated at: ${packet.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Papers: ${packet.summary.papersTotal}`,
    `- AI-med papers: ${packet.summary.aiMedPapers}`,
    `- Semantic Scholar enrichments: ${packet.summary.enrichmentsTotal}`,
    `- Matched enrichments: ${packet.summary.matchedEnrichments}`,
    `- Unmatched enrichments: ${packet.summary.unmatchedEnrichments}`,
    `- Duplicate S2 diagnostics: ${packet.summary.duplicateEnrichments}`,
    `- Candidates: ${packet.summary.candidatesTotal}`,
    `- S2 seed candidates with citation_count >= 5: ${packet.summary.seedCountGte5}`,
    `- Max S2 citation_count: ${packet.summary.maxCitationCount}`,
    "",
    "## Refresh Result",
    "",
    "```json",
    JSON.stringify(packet.refreshResult, null, 2),
    "```",
    "",
    renderCandidateList("Would Promote After Review", packet.lists.wouldPromote),
    renderCandidateList("Verified But Held", packet.lists.verifiedHold),
    renderCandidateList("Pending PubMed Not Found", packet.lists.pendingNotFound),
    renderCandidateList("Rejected Review-Like Sample", packet.lists.rejectedReview),
    "## Codex Review Rule",
    "",
    "Review only the candidate lists above. Do not scan the full database unless the user asks for a targeted follow-up. Ask before writing any candidate into `papers` or a push pool.",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const refreshResult = options.refresh ? await runRefresh(options) : { skipped: true };
  const packet = await loadReviewPacket(options, refreshResult);

  if (options.format === "json") {
    console.log(JSON.stringify(packet, null, 2));
    return;
  }
  console.log(renderMarkdown(packet));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
