import { computeDynamicQualityScore } from "@/lib/journal-score";
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
  pmid: string;
  journal: string | null;
  ai_med_score: number | null;
  quality_score: number | null;
  quality_tier: string | null;
  journal_if: number | null;
  journal_jcr: string | null;
  journal_cas_zone: string | null;
  source_payload: Record<string, unknown> | null;
};

type JournalMatcher = {
  exactByName: Map<string, JournalQualityRow>;
  byAlias: Map<string, JournalQualityRow>;
};

const CURSOR_KEY = "quality_recompute_cursor_id";
const BATCH_SIZE_DEFAULT = 500;
const BATCH_SIZE_MAX = 1000;

function normalizeJournalKey(input: string) {
  return input.trim().toLowerCase();
}

async function readCursor(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const { data } = await supabase
    .from("sync_state")
    .select("value")
    .eq("key", CURSOR_KEY)
    .maybeSingle();
  return ((data as { value?: string } | null)?.value ?? "").trim();
}

async function writeCursor(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  cursor: string,
) {
  await supabase.from("sync_state").upsert(
    {
      key: CURSOR_KEY,
      value: cursor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

async function loadJournalMatcher(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
): Promise<JournalMatcher> {
  const { data, error } = await supabase
    .from("journal_quality")
    .select("journal_name,aliases,tier,weight,impact_factor,jcr_quartile,cas_zone")
    .eq("is_active", true);
  if (error || !data) {
    throw new Error(`Load journal_quality failed: ${error?.message ?? "unknown error"}`);
  }

  const exactByName = new Map<string, JournalQualityRow>();
  const byAlias = new Map<string, JournalQualityRow>();
  for (const row of data as JournalQualityRow[]) {
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
): JournalQualityRow | null {
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
  const cursor = await readCursor(supabase);

  const cutoffDate = new Date(Date.now() - 183 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let query = supabase
    .from("papers")
    .select(
      "id,pmid,journal,ai_med_score,quality_score,quality_tier,journal_if,journal_jcr,journal_cas_zone,source_payload",
    )
    .eq("is_ai_med", true)
    .gte("publication_date", cutoffDate)
    .order("id", { ascending: true })
    .limit(batchSize);

  if (cursor) {
    query = query.gt("id", cursor);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Load papers for recompute failed: ${error.message}`);
  }

  const rows = (data ?? []) as PaperRow[];
  if (!rows.length) {
    if (cursor) {
      await writeCursor(supabase, "");
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

    const { error: updateErr } = await supabase
      .from("papers")
      .update({
        quality_score: dynamic.qualityScore,
        quality_tier: nextTier,
        journal_if: dynamic.impactFactor,
        journal_jcr: dynamic.jcrQuartile,
        journal_cas_zone: dynamic.casZone,
        source_payload: payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updateErr) {
      failedCount += 1;
      continue;
    }
    updatedCount += 1;
  }

  const lastId = rows[rows.length - 1]?.id ?? "";
  await writeCursor(supabase, lastId);

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
