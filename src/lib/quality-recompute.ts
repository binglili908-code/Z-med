import { computeDynamicQualityScore } from "@/lib/journal-score";
import { getJournalKeyCandidates } from "@/lib/journal-normalization";
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
const CUTOFF_DAYS_DEFAULT = 183;
const CUTOFF_DAYS_MAX = 3650;

async function loadJournalMatcher(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
): Promise<JournalMatcher> {
  const data = await listQualityJournalRows(supabase);

  const exactByName = new Map<string, QualityJournalRow>();
  const byAlias = new Map<string, QualityJournalRow>();
  for (const row of data) {
    for (const key of getJournalKeyCandidates(row.journal_name)) {
      exactByName.set(key, row);
    }
    for (const alias of row.aliases ?? []) {
      for (const aliasKey of getJournalKeyCandidates(alias)) {
        byAlias.set(aliasKey, row);
      }
    }
  }
  return { exactByName, byAlias };
}

function resolveJournal(
  journalName: string | null,
  matcher: JournalMatcher,
): QualityJournalRow | null {
  for (const key of getJournalKeyCandidates(journalName)) {
    const matched = matcher.exactByName.get(key) ?? matcher.byAlias.get(key);
    if (matched) return matched;
  }
  return null;
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

export async function runQualityRecomputeJob(options?: {
  batchSize?: number;
  cutoffDays?: number;
}) {
  const supabase = createServiceSupabaseClient();
  const batchSize = Math.max(
    1,
    Math.min(BATCH_SIZE_MAX, Number(options?.batchSize ?? BATCH_SIZE_DEFAULT)),
  );
  const cutoffDays = Math.max(
    1,
    Math.min(CUTOFF_DAYS_MAX, Number(options?.cutoffDays ?? CUTOFF_DAYS_DEFAULT)),
  );

  const matcher = await loadJournalMatcher(supabase);
  const cursor = await readQualityRecomputeCursor(supabase);

  const cutoffDate = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
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
        unmatchedJournalCount: 0,
        unmatchedJournalSamples: [],
        cycleCompleted: true,
        resetCursor: true,
        cutoffDate,
        cutoffDays,
        batchSize,
      };
    }
    return {
      processedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      unmatchedJournalCount: 0,
      unmatchedJournalSamples: [],
      cycleCompleted: false,
      resetCursor: false,
      cutoffDate,
      cutoffDays,
      batchSize,
    };
  }

  let updatedCount = 0;
  let unchangedCount = 0;
  let failedCount = 0;
  let unmatchedJournalCount = 0;
  const unmatchedJournalSamples: string[] = [];

  for (const row of rows) {
    const matched = resolveJournal(row.journal, matcher);
    if (!matched) {
      unmatchedJournalCount += 1;
      const sample = (row.journal ?? "").trim();
      if (
        sample &&
        !unmatchedJournalSamples.includes(sample) &&
        unmatchedJournalSamples.length < 10
      ) {
        unmatchedJournalSamples.push(sample);
      }
      unchangedCount += 1;
      continue;
    }

    const dynamic = computeDynamicQualityScore({
      aiMedScore: asFiniteNumber(row.ai_med_score, 0),
      baseWeight: matched.weight ?? 0.5,
      impactFactor: matched.impact_factor,
      jcrQuartile: matched.jcr_quartile,
      casZone: matched.cas_zone,
    });

    const nextTier = matched.tier.toLowerCase();
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
    unmatchedJournalCount,
    unmatchedJournalSamples,
    cycleCompleted: false,
    resetCursor: false,
    startCursor: cursor || null,
    nextCursor: lastId || null,
    cutoffDate,
    cutoffDays,
    batchSize,
  };
}
