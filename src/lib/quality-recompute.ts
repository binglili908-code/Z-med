import { computeDynamicQualityScore } from "@/lib/journal-score";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  listQualityJournalRows,
  listQualityRecomputePaperBatch,
  readQualityRecomputeCursor,
  updatePaperQualityRecompute,
  writeQualityRecomputeCursor,
  type QualityJournalRow,
  type QualityPaperUpdate,
} from "@/server/repositories/quality-recompute";

type JournalMatcher = {
  exactByName: Map<string, QualityJournalRow>;
  byAlias: Map<string, QualityJournalRow>;
};

const BATCH_SIZE_DEFAULT = 500;
const BATCH_SIZE_MAX = 1000;

function normalizeJournalKey(input: string) {
  return input.trim().toLowerCase();
}

async function loadJournalMatcher(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
): Promise<JournalMatcher> {
  const data = await listQualityJournalRows(supabase);

  const exactByName = new Map<string, QualityJournalRow>();
  const byAlias = new Map<string, QualityJournalRow>();
  for (const row of data) {
    const key = normalizeJournalKey(row.journal_name);
    if (key) exactByName.set(key, row);
    for (const alias of row.aliases ?? []) {
      const aliasKey = normalizeJournalKey(alias);
      if (aliasKey) byAlias.set(aliasKey, row);
    }
  }
  return { exactByName, byAlias };
}

function resolveJournal(
  journalName: string | null,
  matcher: JournalMatcher,
): QualityJournalRow | null {
  const key = normalizeJournalKey(journalName ?? "");
  if (!key) return null;
  return matcher.exactByName.get(key) ?? matcher.byAlias.get(key) ?? null;
}

function buildPayloadWithRecomputeMeta(args: {
  payload: Record<string, unknown> | null;
  previousQuality: number;
  nextQuality: number;
}) {
  const base = args.payload && typeof args.payload === "object" ? args.payload : {};
  return {
    ...base,
    quality_recompute: {
      recomputed_at: new Date().toISOString(),
      previous_quality_score: Number(args.previousQuality.toFixed(4)),
      next_quality_score: Number(args.nextQuality.toFixed(4)),
    },
  };
}

function asFiniteNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function runQualityRecomputeJob(options?: { batchSize?: number }) {
  const supabase = createServiceSupabaseClient();
  const batchSize = Math.max(
    1,
    Math.min(BATCH_SIZE_MAX, Number(options?.batchSize ?? BATCH_SIZE_DEFAULT)),
  );

  const matcher = await loadJournalMatcher(supabase);
  const cursor = await readQualityRecomputeCursor(supabase);

  const cutoffDate = new Date(Date.now() - 183 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await listQualityRecomputePaperBatch(supabase, {
    cutoffDate,
    cursor,
    batchSize,
  });
  if (!rows.length) {
    if (cursor) {
      await writeQualityRecomputeCursor(supabase, "");
      return {
        processedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        failedCount: 0,
        cycleCompleted: true,
        resetCursor: true,
        cutoffDate,
        batchSize,
      };
    }
    return {
      processedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      cycleCompleted: false,
      resetCursor: false,
      cutoffDate,
      batchSize,
    };
  }

  let updatedCount = 0;
  let unchangedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    const matched = resolveJournal(row.journal, matcher);
    const dynamic = computeDynamicQualityScore({
      aiMedScore: asFiniteNumber(row.ai_med_score, 0),
      baseWeight: matched?.weight ?? 0.5,
      impactFactor: matched?.impact_factor ?? row.journal_if ?? null,
      jcrQuartile: matched?.jcr_quartile ?? row.journal_jcr ?? null,
      casZone: matched?.cas_zone ?? row.journal_cas_zone ?? null,
    });

    const nextTier = (matched?.tier ?? "emerging").toLowerCase();
    const prevQuality = asFiniteNumber(row.quality_score, 0);
    const sameScore = Math.abs(prevQuality - dynamic.qualityScore) < 0.0001;
    const sameTier = (row.quality_tier ?? "emerging").toLowerCase() === nextTier;
    const sameIf = asFiniteNumber(row.journal_if, -1) === asFiniteNumber(dynamic.impactFactor, -1);
    const sameJcr = (row.journal_jcr ?? "").trim() === (dynamic.jcrQuartile ?? "").trim();
    const sameCas = (row.journal_cas_zone ?? "").trim() === (dynamic.casZone ?? "").trim();

    if (sameScore && sameTier && sameIf && sameJcr && sameCas) {
      unchangedCount += 1;
      continue;
    }

    const payload = buildPayloadWithRecomputeMeta({
      payload: row.source_payload,
      previousQuality: prevQuality,
      nextQuality: dynamic.qualityScore,
    });

    const updatePayload: QualityPaperUpdate = {
      quality_score: dynamic.qualityScore,
      quality_tier: nextTier,
      journal_if: dynamic.impactFactor,
      journal_jcr: dynamic.jcrQuartile,
      journal_cas_zone: dynamic.casZone,
      source_payload: payload,
      updated_at: new Date().toISOString(),
    };

    const updateResult = await updatePaperQualityRecompute(supabase, row.id, updatePayload);
    if (!updateResult.ok) {
      failedCount += 1;
      continue;
    }
    updatedCount += 1;
  }

  const lastId = rows[rows.length - 1]?.id ?? "";
  await writeQualityRecomputeCursor(supabase, lastId);

  return {
    processedCount: rows.length,
    updatedCount,
    unchangedCount,
    failedCount,
    cycleCompleted: false,
    resetCursor: false,
    startCursor: cursor || null,
    nextCursor: lastId || null,
    cutoffDate,
    batchSize,
  };
}
