import { NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("journal_quality")
    .select("id,journal_name,aliases,tier,weight,impact_factor,jcr_quartile,cas_zone,is_active")
    .eq("is_active", true)
    .order("impact_factor", { ascending: false })
    .order("weight", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}
