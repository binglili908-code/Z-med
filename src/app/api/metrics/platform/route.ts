import { NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIsoDateDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const supabase = createServiceSupabaseClient();
  const windowDays = 7;
  const since = toIsoDateDaysAgo(windowDays);

  const { count: totalCandidates, error: cErr } = await supabase
    .from("papers")
    .select("id", { count: "exact", head: true })
    .eq("is_ai_med", true)
    .gte("publication_date", since);
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const { count: topCoreCount, error: tcErr } = await supabase
    .from("papers")
    .select("id", { count: "exact", head: true })
    .eq("is_ai_med", true)
    .in("quality_tier", ["top", "core"])
    .gte("publication_date", since);
  if (tcErr) {
    return NextResponse.json({ error: tcErr.message }, { status: 500 });
  }

  const candidates = totalCandidates ?? 0;
  const retained = topCoreCount ?? 0;
  const intercepted = Math.max(0, candidates - retained);
  const retentionRate = candidates > 0 ? retained / candidates : 0;
  const savedHours = Math.round((intercepted * 0.2) * 10) / 10;

  return NextResponse.json({
    windowDays,
    since,
    totalCandidates: candidates,
    intercepted,
    retained,
    retentionRate,
    savedHours,
  });
}
