import { NextResponse } from "next/server";

import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveBypassUserId(service: ReturnType<typeof createServiceSupabaseClient>) {
  const direct = getDevBypassUserId();
  if (direct) return direct;
  const seedEmail = getDevBypassSeedEmail();
  if (!seedEmail) return null;
  const { data } = await service
    .from("profiles")
    .select("id")
    .eq("contact_email", seedEmail)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const service = createServiceSupabaseClient();
  const bypassEnabled = isDevBypassAuthEnabled();
  const seedEmail = getDevBypassSeedEmail();
  const resolvedUserId = bypassEnabled ? await resolveBypassUserId(service) : null;

  const { data: profile } = resolvedUserId
    ? await service
        .from("profiles")
        .select("contact_email,is_active")
        .eq("id", resolvedUserId)
        .maybeSingle()
    : { data: null as { contact_email: string | null; is_active: boolean } | null };

  const { count: oaCount } = await service
    .from("papers")
    .select("id", { count: "exact", head: true })
    .eq("is_open_access", true)
    .not("oa_pdf_url", "is", null);

  const { data: samplePaper } = await service
    .from("papers")
    .select("id,title")
    .eq("is_open_access", true)
    .not("oa_pdf_url", "is", null)
    .limit(1)
    .maybeSingle();

  const resendConfigured = Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim(),
  );

  const allPassed = Boolean(
    bypassEnabled &&
      resolvedUserId &&
      profile?.contact_email &&
      resendConfigured &&
      (oaCount ?? 0) > 0,
  );

  return NextResponse.json({
    ok: allPassed,
    checks: {
      bypassEnabled,
      seedEmail: seedEmail ?? null,
      resolvedUserId,
      profileEmail: profile?.contact_email ?? null,
      profileActive: profile?.is_active ?? null,
      resendConfigured,
      openAccessPaperCount: oaCount ?? 0,
      samplePaperId: samplePaper?.id ?? null,
      samplePaperTitle: samplePaper?.title ?? null,
    },
  });
}
