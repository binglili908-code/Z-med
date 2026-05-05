import fs from "node:fs";
import path from "node:path";

import { callMiniMaxChat, getMiniMaxModel } from "@/lib/minimax";
import { cleanTranslatedText } from "@/lib/paper-translation-result";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type PaperTranslationRow = {
  id: string;
  pmid: string | null;
  title: string | null;
  journal: string | null;
  abstract: string | null;
  title_zh: string | null;
  abstract_zh: string | null;
};

type FieldName = "title_zh" | "abstract_zh";

type PlannedFieldUpdate = {
  field: FieldName;
  before_length: number;
  after_length: number;
  markers: string[];
  after_preview: string;
};

type RetranslationCandidate = {
  id: string;
  pmid: string | null;
  title: string | null;
  field: FieldName;
  markers: string[];
  reason: string;
};

type PlannedPaperUpdate = {
  id: string;
  pmid: string | null;
  title: string | null;
  fields: PlannedFieldUpdate[];
};

const PAGE_SIZE = 1000;
const TITLE_MAX_LENGTH = 200;
const ABSTRACT_MAX_LENGTH = 8000;

const REASONING_MARKERS = [
  { label: "think_tag", pattern: /<\/?think(?:ing)?\b/i },
  { label: "thinking_block", pattern: /\[(?:think|thinking|reasoning|analysis)\]/i },
  { label: "reasoning_content", pattern: /reasoning_content/i },
  { label: "chain_of_thought", pattern: /chain[-_\s]?of[-_\s]?thought/i },
  { label: "reasoning_heading", pattern: /^\s*(?:Reasoning|Analysis|Thought process)\s*[:：]/i },
  { label: "chinese_reasoning_heading", pattern: /^\s*(?:思维链|思考过程|推理过程|分析过程|内部思考|思路)\s*[:：]/i },
] as const;

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

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function parseNumberFlag(name: string, defaultValue: number) {
  const prefix = `${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : defaultValue;
}

function preview(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function findReasoningMarkers(value: string): string[] {
  return REASONING_MARKERS.filter((marker) => marker.pattern.test(value)).map(
    (marker) => marker.label,
  );
}

function isMarkdownFence(value: string) {
  return value.trim().startsWith("```");
}

function cleanPaperTranslationField(field: FieldName, value: unknown) {
  const cleaned = cleanTranslatedText(value);
  if (!cleaned) return null;
  if (field !== "abstract_zh") return cleaned;

  const withoutPromptEcho = cleaned
    .replace(
      /^\s*(?:论文标题|标题|English title)\s*[:：][\s\S]*?(?:摘要|中文摘要|Abstract)\s*[:：]\s*/i,
      "",
    )
    .replace(
      /^\s*(?:期刊|Journal)\s*[:：][\s\S]*?(?:摘要|中文摘要|Abstract)\s*[:：]\s*/i,
      "",
    )
    .trim();

  return withoutPromptEcho || cleaned;
}

function planField(
  paper: PaperTranslationRow,
  field: FieldName,
  retranslationCandidates: RetranslationCandidate[],
): PlannedFieldUpdate | null {
  const value = paper[field];
  if (!value) return null;

  const markers = findReasoningMarkers(value);
  const shouldInspect = markers.length > 0 || isMarkdownFence(value);
  if (!shouldInspect) return null;

  if (field === "title_zh" && markers.length > 0) {
    retranslationCandidates.push({
      id: paper.id,
      pmid: paper.pmid,
      title: paper.title,
      field,
      markers,
      reason: "Title contained reasoning; retranslate title instead of preserving a fragment",
    });
    return null;
  }

  const cleaned = cleanPaperTranslationField(field, value);
  const cleanedMarkers = cleaned ? findReasoningMarkers(cleaned) : [];
  const canClean = cleaned && cleaned !== value.trim() && cleanedMarkers.length === 0;

  if (canClean) {
    return {
      field,
      before_length: value.length,
      after_length: cleaned.length,
      markers,
      after_preview: preview(cleaned),
    } satisfies PlannedFieldUpdate;
  }

  retranslationCandidates.push({
    id: paper.id,
    pmid: paper.pmid,
    title: paper.title,
    field,
    markers,
    reason: cleaned
      ? "Reasoning marker remains after deterministic cleanup"
      : "Deterministic cleanup removed all visible translated text",
  });
  return null;
}

async function fetchPaperBatch(from: number, to: number) {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("papers")
    .select("id,pmid,title,journal,abstract,title_zh,abstract_zh")
    .order("id", { ascending: true })
    .range(from, to);

  if (error) throw new Error(`Load papers failed: ${error.message}`);
  return (data ?? []) as PaperTranslationRow[];
}

function planPaper(
  paper: PaperTranslationRow,
  retranslationCandidates: RetranslationCandidate[],
) {
  const fields = [
    planField(paper, "title_zh", retranslationCandidates),
    planField(paper, "abstract_zh", retranslationCandidates),
  ].filter((field): field is PlannedFieldUpdate => Boolean(field));

  if (!fields.length) return null;
  return {
    id: paper.id,
    pmid: paper.pmid,
    title: paper.title,
    fields,
  } satisfies PlannedPaperUpdate;
}

async function applyUpdates(plannedUpdates: PlannedPaperUpdate[]) {
  const supabase = createServiceSupabaseClient();
  for (const update of plannedUpdates) {
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const field of update.fields) {
      const existing = await supabase
        .from("papers")
        .select(field.field)
        .eq("id", update.id)
        .maybeSingle();
      if (existing.error) {
        throw new Error(`Reload paper ${update.id} failed: ${existing.error.message}`);
      }
      const currentValue = (existing.data as Record<string, string | null> | null)?.[field.field];
      const cleaned = cleanPaperTranslationField(field.field, currentValue);
      if (!cleaned) continue;
      payload[field.field] = cleaned;
    }

    const fieldNames = Object.keys(payload).filter((key) => key !== "updated_at");
    if (!fieldNames.length) continue;

    const { error } = await supabase.from("papers").update(payload).eq("id", update.id);
    if (error) throw new Error(`Update paper ${update.id} failed: ${error.message}`);
  }
}

function buildTitleTranslationPrompt(paper: PaperTranslationRow) {
  return {
    systemPrompt: [
      "You are a professional biomedical translator.",
      "Translate the English paper title into accurate, natural Simplified Chinese.",
      "Return only the Chinese title.",
      "Do not output markdown, explanations, analysis, chain-of-thought, <think> tags, or labels.",
    ].join("\n"),
    userPrompt: [
      `Journal: ${paper.journal ?? "Unknown"}`,
      `English title: ${paper.title ?? ""}`,
    ].join("\n"),
  };
}

function buildAbstractTranslationPrompt(paper: PaperTranslationRow) {
  return {
    systemPrompt: [
      "You are a professional biomedical translator.",
      "Translate the English paper abstract into accurate, natural Simplified Chinese.",
      "Return only the Chinese abstract text.",
      "Do not output markdown, explanations, analysis, chain-of-thought, <think> tags, or labels.",
    ].join("\n"),
    userPrompt: [
      `Journal: ${paper.journal ?? "Unknown"}`,
      `English title: ${paper.title ?? ""}`,
      `English abstract: ${paper.abstract ?? ""}`,
    ].join("\n"),
  };
}

async function loadPapersById(ids: string[]) {
  const supabase = createServiceSupabaseClient();
  const map = new Map<string, PaperTranslationRow>();
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const chunk = ids.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from("papers")
      .select("id,pmid,title,journal,abstract,title_zh,abstract_zh")
      .in("id", chunk);
    if (error) throw new Error(`Load retranslation papers failed: ${error.message}`);
    for (const paper of (data ?? []) as PaperTranslationRow[]) {
      map.set(paper.id, paper);
    }
  }
  return map;
}

async function applyRetranslations(candidates: RetranslationCandidate[]) {
  const supabase = createServiceSupabaseClient();
  const papersById = await loadPapersById(Array.from(new Set(candidates.map((item) => item.id))));
  const results: Array<{
    id: string;
    field: FieldName;
    status: "updated" | "skipped" | "failed";
    message?: string;
  }> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const candidate of candidates) {
    const paper = papersById.get(candidate.id);
    if (!paper) {
      results.push({
        id: candidate.id,
        field: candidate.field,
        status: "skipped",
        message: "paper not found",
      });
      continue;
    }
    if (candidate.field === "abstract_zh" && !paper.abstract) {
      results.push({
        id: candidate.id,
        field: candidate.field,
        status: "skipped",
        message: "paper has no English abstract",
      });
      continue;
    }

    try {
      const prompt =
        candidate.field === "title_zh"
          ? buildTitleTranslationPrompt(paper)
          : buildAbstractTranslationPrompt(paper);
      const response = await callMiniMaxChat({
        label: `cleanup_retranslate_${candidate.field}`,
        model: getMiniMaxModel(),
        ...prompt,
        temperature: 0.1,
        maxTokens: candidate.field === "title_zh" ? 1200 : 2400,
      });
      inputTokens += response.inputTokens ?? 0;
      outputTokens += response.outputTokens ?? 0;

      const cleaned = cleanPaperTranslationField(candidate.field, response.content);
      if (!cleaned || findReasoningMarkers(cleaned).length > 0) {
        results.push({
          id: candidate.id,
          field: candidate.field,
          status: "failed",
          message: "retranslation still contained no clean visible text",
        });
        continue;
      }

      const value =
        candidate.field === "title_zh"
          ? cleaned.slice(0, TITLE_MAX_LENGTH)
          : cleaned.slice(0, ABSTRACT_MAX_LENGTH);
      const { error } = await supabase
        .from("papers")
        .update({
          [candidate.field]: value,
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id);
      if (error) throw new Error(error.message);

      results.push({
        id: candidate.id,
        field: candidate.field,
        status: "updated",
      });
    } catch (error) {
      results.push({
        id: candidate.id,
        field: candidate.field,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    updatedCount: results.filter((result) => result.status === "updated").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    inputTokens,
    outputTokens,
    results,
  };
}

async function scanPapers() {
  const plannedUpdates: PlannedPaperUpdate[] = [];
  const retranslationCandidates: RetranslationCandidate[] = [];
  let scannedCount = 0;

  for (let from = 0; ; from += PAGE_SIZE) {
    const papers = await fetchPaperBatch(from, from + PAGE_SIZE - 1);
    if (!papers.length) break;
    scannedCount += papers.length;
    for (const paper of papers) {
      const plan = planPaper(paper, retranslationCandidates);
      if (plan) plannedUpdates.push(plan);
    }
    if (papers.length < PAGE_SIZE) break;
  }

  return { scannedCount, plannedUpdates, retranslationCandidates };
}

async function main() {
  loadLocalEnvFiles();

  const apply = hasFlag("--apply");
  const retranslateCandidates = hasFlag("--retranslate-candidates");
  const confirmed = hasFlag("--yes-i-understand-this-writes-to-database");
  const sampleLimit = parseNumberFlag("--sample-limit", 50);
  if (apply && !confirmed) {
    throw new Error(
      "Refusing to write. Re-run with --apply --yes-i-understand-this-writes-to-database after reviewing dry-run output.",
    );
  }

  const { scannedCount, plannedUpdates, retranslationCandidates } = await scanPapers();
  if (apply) {
    await applyUpdates(plannedUpdates);
  }
  const retranslationResult =
    apply && retranslateCandidates
      ? await applyRetranslations(retranslationCandidates)
      : null;

  const fieldUpdateCount = plannedUpdates.reduce(
    (sum, update) => sum + update.fields.length,
    0,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        scanned_papers: scannedCount,
        planned_paper_update_count: plannedUpdates.length,
        planned_field_update_count: fieldUpdateCount,
        retranslation_candidate_count: retranslationCandidates.length,
        retranslation_mode:
          apply && retranslateCandidates ? "applied" : "not-run",
        retranslation_result: retranslationResult,
        planned_updates_sample: plannedUpdates.slice(0, sampleLimit),
        retranslation_candidates_sample: retranslationCandidates.slice(0, sampleLimit),
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
