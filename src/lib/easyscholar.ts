import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  listActiveEasyScholarJournals,
  readEasyScholarCursor,
  updateJournalEasyScholarResult,
  writeEasyScholarCursor,
  type EasyScholarJournalRow,
  type EasyScholarJournalUpdate,
} from "@/server/repositories/easyscholar";

type EasyScholarResponse = {
  code?: number;
  msg?: string;
  data?: {
    officialRank?: {
      all?: Record<string, unknown>;
      select?: Record<string, unknown>;
    };
    customRank?: unknown;
  } | null;
};

type ParsedRank = {
  impactFactor: number | null;
  jcrQuartile: string | null;
  casZone: string | null;
};

type QueryResult = {
  ok: boolean;
  status: "success" | "failed" | "not_found";
  message: string | null;
  publicationName: string;
  parsed: ParsedRank;
  raw: Record<string, unknown> | null;
};

const EASY_SCHOLAR_ENDPOINT = "https://www.easyscholar.cc/open/getPublicationRank";
const RATE_LIMIT_MS = 550;
const REQUEST_TIMEOUT_MS = 12000;
const BATCH_SIZE_DEFAULT = 30;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toText(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

function toMaybeNumber(input: unknown) {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== "string") return null;
  const normalized = input.replace(/,/g, "").trim();
  if (!normalized) return null;
  const m = normalized.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function normalizeJournalName(input: string) {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeNames(names: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = normalizeJournalName(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function toCasZone(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const m = text.match(/[1-4一二三四]\s*区/i);
  if (m?.[0]) {
    return m[0].replace(/\s+/g, "");
  }
  return text.slice(0, 40);
}

function toJcrQuartile(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const q = text.match(/\bQ([1-4])\b/i);
  if (q?.[1]) return `Q${q[1]}`;
  const zone = text.match(/[1-4]\s*区/);
  if (zone?.[0]) return zone[0].replace(/\s+/g, "");
  return text.slice(0, 40);
}

function parseOfficialRank(all: Record<string, unknown> | undefined): ParsedRank {
  if (!all) {
    return {
      impactFactor: null,
      jcrQuartile: null,
      casZone: null,
    };
  }

  const impactFactor =
    toMaybeNumber(all.sciif) ??
    toMaybeNumber(all.sciif5) ??
    toMaybeNumber(all.jci) ??
    null;

  const jcrQuartile =
    toJcrQuartile(all.sci) ??
    toJcrQuartile(all.ssci) ??
    toJcrQuartile(all.ahci) ??
    null;

  const casZone =
    toCasZone(all.sciUp) ??
    toCasZone(all.sciBase) ??
    toCasZone(all.sciUpSmall) ??
    null;

  return { impactFactor, jcrQuartile, casZone };
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

class EasyScholarLimiter {
  private lastRunAt = 0;

  async waitTurn() {
    const now = Date.now();
    const delta = now - this.lastRunAt;
    if (delta < RATE_LIMIT_MS) {
      await sleep(RATE_LIMIT_MS - delta);
    }
    this.lastRunAt = Date.now();
  }
}

async function queryEasyScholarByName(args: {
  secretKey: string;
  publicationName: string;
  limiter: EasyScholarLimiter;
}): Promise<QueryResult> {
  const params = new URLSearchParams({
    secretKey: args.secretKey,
    publicationName: args.publicationName,
  });
  const url = `${EASY_SCHOLAR_ENDPOINT}?${params.toString()}`;

  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await args.limiter.waitTurn();
      const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
      const body = (await res.json()) as EasyScholarResponse;
      const code = Number(body?.code ?? 0);
      const msg = toText(body?.msg) || null;
      const officialAll = body?.data?.officialRank?.all;

      if (res.ok && code === 200 && officialAll && typeof officialAll === "object") {
        const parsed = parseOfficialRank(officialAll);
        return {
          ok: true,
          status: "success",
          message: msg,
          publicationName: args.publicationName,
          parsed,
          raw: officialAll,
        };
      }

      if (res.ok && code === 200) {
        return {
          ok: true,
          status: "not_found",
          message: msg ?? "No rank data",
          publicationName: args.publicationName,
          parsed: { impactFactor: null, jcrQuartile: null, casZone: null },
          raw: null,
        };
      }

      lastError = msg ?? `easyScholar code=${code || res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown request error";
    }

    if (attempt < 3) {
      await sleep(300 * attempt);
    }
  }

  return {
    ok: false,
    status: "failed",
    message: lastError,
    publicationName: args.publicationName,
    parsed: { impactFactor: null, jcrQuartile: null, casZone: null },
    raw: null,
  };
}

function getBatchByCursor(rows: EasyScholarJournalRow[], cursor: number, batchSize: number) {
  if (!rows.length || batchSize <= 0) {
    return { batch: [] as EasyScholarJournalRow[], nextCursor: 0 };
  }
  const size = Math.min(batchSize, rows.length);
  const out: EasyScholarJournalRow[] = [];
  for (let i = 0; i < size; i += 1) {
    out.push(rows[(cursor + i) % rows.length]);
  }
  const nextCursor = (cursor + size) % rows.length;
  return { batch: out, nextCursor };
}

export async function runEasyScholarSyncJob(options?: { batchSize?: number }) {
  const secretKey = process.env.EASYSCHOLAR_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Missing EASYSCHOLAR_SECRET_KEY");
  }

  const supabase = createServiceSupabaseClient();
  const batchSize = Math.max(1, Math.min(100, Number(options?.batchSize ?? BATCH_SIZE_DEFAULT)));
  const rows = await listActiveEasyScholarJournals(supabase);
  if (!rows.length) {
    return {
      syncedCount: 0,
      successCount: 0,
      notFoundCount: 0,
      failedCount: 0,
      nextCursor: 0,
      totalJournals: 0,
      message: "No active journals found",
    };
  }

  const cursor = await readEasyScholarCursor(supabase, rows.length);
  const { batch, nextCursor } = getBatchByCursor(rows, cursor, batchSize);
  const limiter = new EasyScholarLimiter();

  let successCount = 0;
  let notFoundCount = 0;
  let failedCount = 0;

  for (const row of batch) {
    const names = dedupeNames([row.journal_name, ...(row.aliases ?? [])]);
    let best: QueryResult | null = null;

    for (const name of names) {
      const result = await queryEasyScholarByName({
        secretKey,
        publicationName: name,
        limiter,
      });
      if (result.status === "success") {
        best = result;
        break;
      }
      if (result.status === "not_found") {
        best = result;
      } else if (!best) {
        best = result;
      }
    }

    const finalResult = best ?? {
      ok: false,
      status: "failed" as const,
      message: "No query candidate names",
      publicationName: row.journal_name,
      parsed: { impactFactor: null, jcrQuartile: null, casZone: null },
      raw: null,
    };

    if (finalResult.status === "success") successCount += 1;
    else if (finalResult.status === "not_found") notFoundCount += 1;
    else failedCount += 1;

    const updatePayload: EasyScholarJournalUpdate = {
      es_last_sync_at: new Date().toISOString(),
      es_sync_status: finalResult.status,
      es_error: finalResult.status === "failed" ? finalResult.message : null,
      es_raw: finalResult.raw,
      impact_factor: finalResult.parsed.impactFactor,
      jcr_quartile: finalResult.parsed.jcrQuartile,
      cas_zone: finalResult.parsed.casZone,
      updated_at: new Date().toISOString(),
    };

    const updateResult = await updateJournalEasyScholarResult(supabase, row.id, updatePayload);
    if (!updateResult.ok) {
      failedCount += 1;
    }
  }

  await writeEasyScholarCursor(supabase, nextCursor);

  return {
    syncedCount: batch.length,
    successCount,
    notFoundCount,
    failedCount,
    startCursor: cursor,
    nextCursor,
    totalJournals: rows.length,
    batchSize,
  };
}
