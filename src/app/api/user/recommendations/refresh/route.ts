import { NextResponse } from "next/server";

import { generateRecommendations } from "@/lib/recommendation-engine";
import { createUserSupabaseClient } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batchDate = new Date().toISOString().slice(0, 10);
  const items = await generateRecommendations({ user_id: user.id, batch_date: batchDate });

  return NextResponse.json({
    ok: true,
    batch_date: batchDate,
    count: items.length,
  });
}
