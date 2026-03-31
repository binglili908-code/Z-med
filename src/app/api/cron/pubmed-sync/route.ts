import { NextResponse } from "next/server";

import { runPubmedSyncJob } from "@/lib/pubmed-sync";
import { isDevBypassAuthEnabled } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    const result = await runPubmedSyncJob();
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
