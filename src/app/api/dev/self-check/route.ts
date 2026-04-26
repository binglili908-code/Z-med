import { NextResponse } from "next/server";

import { authorizeDeveloperRequest } from "@/lib/dev-admin-auth";
import { getResendConfigStatus } from "@/lib/resend-email";
import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  countOpenAccessPapersWithPdf,
  getDevSelfCheckProfile,
  getSampleOpenAccessPaperWithPdf,
} from "@/server/repositories/dev-self-check";
import { findProfileIdByContactEmail } from "@/server/repositories/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveBypassUserId(service: ReturnType<typeof createServiceSupabaseClient>) {
  const direct = getDevBypassUserId();
  if (direct) return direct;
  const seedEmail = getDevBypassSeedEmail();
  if (!seedEmail) return null;
  return findProfileIdByContactEmail(service, seedEmail);
}

export async function GET(req: Request) {
  const auth = await authorizeDeveloperRequest(req);
  if (!auth.authorized) {
    return auth.response;
  }

  const service = createServiceSupabaseClient();
  const bypassEnabled = isDevBypassAuthEnabled();
  const seedEmail = getDevBypassSeedEmail();
  const resolvedUserId = bypassEnabled ? await resolveBypassUserId(service) : null;

  const profile = resolvedUserId ? await getDevSelfCheckProfile(service, resolvedUserId) : null;
  const oaCount = await countOpenAccessPapersWithPdf(service);
  const samplePaper = await getSampleOpenAccessPaperWithPdf(service);

  const resendStatus = getResendConfigStatus();
  const resendConfigured = resendStatus.configured;

  const accessReady =
    auth.actor.mode === "email"
      ? true
      : Boolean(bypassEnabled && resolvedUserId && profile?.contact_email);

  const allPassed = Boolean(accessReady && resendConfigured && oaCount > 0);

  return NextResponse.json({
    ok: allPassed,
    actor: auth.actor,
    checks: {
      bypassEnabled,
      seedEmail: seedEmail ?? null,
      resolvedUserId,
      profileEmail: profile?.contact_email ?? null,
      profileActive: profile?.is_active ?? null,
      resendConfigured,
      resendFromEmail: resendStatus.fromEmail,
      resendUsesTestingDomain: resendStatus.usesTestingDomain,
      openAccessPaperCount: oaCount,
      samplePaperId: samplePaper?.id ?? null,
      samplePaperTitle: samplePaper?.title ?? null,
    },
  });
}
