import { NextResponse } from "next/server";

import { runQualityRecomputeJob } from "@/lib/quality-recompute";
import { isDevBypassAuthEnabled } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isDevBypassAuthEnabled() && !isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchSize = Number(searchParams.get("batchSize") ?? 500);

  try {
    const result = await runQualityRecomputeJob({ batchSize });
    return NextResponse.json({
      ok: true,
      devBypassAuth: isDevBypassAuthEnabled(),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
