import { NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubjectCategoryRow = {
  id: string;
  name_zh: string | null;
  name_en: string | null;
  search_terms: string[] | null;
  recommended_journal_ids: string[] | null;
};

type JournalRow = {
  id: string;
  journal_name: string | null;
  tier: string | null;
  weight: number | null;
  impact_factor: number | null;
  jcr_quartile: string | null;
  cas_zone: string | null;
  is_active: boolean | null;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = normalize(searchParams.get("q") ?? "");
  if (!q) {
    return NextResponse.json({ items: [] });
  }

  const supabase = createServiceSupabaseClient();
  const { data: categories, error: categoryErr } = await supabase
    .from("subject_categories")
    .select("id,name_zh,name_en,search_terms,recommended_journal_ids")
    .eq("is_active", true);
  if (categoryErr) {
    return NextResponse.json({ error: categoryErr.message }, { status: 500 });
  }

  const matched = ((categories ?? []) as SubjectCategoryRow[]).filter((item) => {
    const terms = item.search_terms ?? [];
    return terms.some((term) => normalize(term).includes(q));
  });

  const journalIds = Array.from(
    new Set(matched.flatMap((item) => item.recommended_journal_ids ?? [])),
  );

  let journalMap = new Map<string, JournalRow>();
  if (journalIds.length) {
    const { data: journals, error: journalErr } = await supabase
      .from("journal_quality")
      .select("id,journal_name,tier,weight,impact_factor,jcr_quartile,cas_zone,is_active")
      .in("id", journalIds)
      .eq("is_active", true);
    if (journalErr) {
      return NextResponse.json({ error: journalErr.message }, { status: 500 });
    }
    journalMap = new Map(((journals ?? []) as JournalRow[]).map((row) => [row.id, row]));
  }

  const items = matched.map((item) => ({
    id: item.id,
    name_zh: item.name_zh ?? "",
    name_en: item.name_en ?? "",
    journals: (item.recommended_journal_ids ?? [])
      .map((id) => journalMap.get(id))
      .filter((row): row is JournalRow => Boolean(row))
      .sort((a, b) => {
        const ai = a.impact_factor == null ? -1 : Number(a.impact_factor);
        const bi = b.impact_factor == null ? -1 : Number(b.impact_factor);
        return bi - ai;
      })
      .map((row) => ({
        id: row.id,
        journal_name: row.journal_name ?? "",
        tier: ((row.tier ?? "emerging").toLowerCase() as "top" | "core" | "emerging"),
        weight: Number(row.weight ?? 0),
        impact_factor: row.impact_factor == null ? null : Number(row.impact_factor),
        jcr_quartile: row.jcr_quartile ?? "",
        cas_zone: row.cas_zone ?? "",
      })),
  }));

  return NextResponse.json({ items });
}
