import { NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { searchPapers } from "@/server/repositories/papers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeSearchTerms(q: string) {
  const list = q
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(list));
}

function parseNonNegativeNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeIfRange(min: number | null, max: number | null) {
  if (min != null && max != null && min > max) {
    return { min: max, max: min };
  }
  return { min, max };
}

export async function GET(req: Request) {
  const supabase = createServiceSupabaseClient();
  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") ?? "").trim();
  const tier = (searchParams.get("tier") ?? "").trim().toLowerCase();
  const from = (searchParams.get("from") ?? "").trim();
  const to = (searchParams.get("to") ?? "").trim();
  const oa = (searchParams.get("oa") ?? "").trim().toLowerCase();
  const rawIfMin = parseNonNegativeNumber(searchParams.get("ifMin"));
  const rawIfMax = parseNonNegativeNumber(searchParams.get("ifMax"));
  const ifRange = normalizeIfRange(rawIfMin, rawIfMax);
  const page = clamp(Number(searchParams.get("page") ?? 1) || 1, 1, 1000);
  const pageSize = clamp(Number(searchParams.get("pageSize") ?? 20) || 20, 1, 50);
  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize - 1;

  const terms = normalizeSearchTerms(q);
  let result;
  try {
    result = await searchPapers(supabase, {
      terms,
      tier,
      from,
      to,
      openAccessOnly: oa === "true",
      ifMin: ifRange.min,
      ifMax: ifRange.max,
      fromIndex,
      toIndex,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    page,
    pageSize,
    total: result.total,
    items: result.items,
  });
}
