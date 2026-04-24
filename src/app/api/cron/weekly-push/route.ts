import { NextResponse } from "next/server";

import { authorizeDeveloperRequest } from "@/lib/dev-admin-auth";
import { isDevBypassAuthEnabled } from "@/lib/supabase/env";
import { runWeeklyPushJob } from "@/lib/weekly-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeDeveloperRequest(req);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const result = await runWeeklyPushJob();
    return NextResponse.json({
      ok: true,
      actor: auth.actor,
      devBypassAuth: isDevBypassAuthEnabled(),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
