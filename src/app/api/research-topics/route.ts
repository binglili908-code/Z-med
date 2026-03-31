import { NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("research_topics")
    .select("id,slug,name_zh,name_en,description,sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
  });
}
