import { NextResponse } from "next/server";

import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { listActiveResearchTopics } from "@/server/repositories/reference-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceSupabaseClient();
  try {
    const items = await listActiveResearchTopics(supabase);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
