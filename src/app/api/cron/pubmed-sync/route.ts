import { NextResponse } from "next/server";

import { authorizeDeveloperRequest } from "@/lib/dev-admin-auth";
import { runAiAnalysisCronJob } from "@/lib/ai-analysis";
import { runPubmedSyncJob } from "@/lib/pubmed-sync";
import { isDevBypassAuthEnabled } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = await authorizeDeveloperRequest(req);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const result = await runPubmedSyncJob();
    const aiResult = await runAiAnalysisCronJob();
    return NextResponse.json({
      ok: true,
      actor: auth.actor,
      devBypassAuth: isDevBypassAuthEnabled(),
      ...result,
      aiAnalysis: aiResult,
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
