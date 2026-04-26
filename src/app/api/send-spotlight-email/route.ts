import { NextResponse } from "next/server";

import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
import {
  getDailySpotlightEmailSubject,
  sendSpotlightDigestEmail,
} from "@/lib/spotlight-email";
import { buildSpotlightPapers } from "@/lib/spotlight";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";
import {
  findProfileIdByContactEmail,
  getProfileContactEmail,
} from "@/server/repositories/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function resolveBypassUserId(service: ReturnType<typeof createServiceSupabaseClient>) {
  const direct = getDevBypassUserId();
  if (direct) return direct;
  const seedEmail = getDevBypassSeedEmail();
  if (!seedEmail) return null;
  return findProfileIdByContactEmail(service, seedEmail);
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  const devBypass = isDevBypassAuthEnabled();
  const service = createServiceSupabaseClient();

  let user: { id: string; email?: string | null } | null = null;
  if (token) {
    const userClient = createUserSupabaseClient(token);
    const {
      data: { user: authUser },
      error,
    } = await userClient.auth.getUser();
    if (error || !authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    user = { id: authUser.id, email: authUser.email };
  } else if (devBypass) {
    const userId = await resolveBypassUserId(service);
    if (userId) {
      user = { id: userId, email: null };
    }
  }

  if (!user) {
    return NextResponse.json(
      { error: token ? "Unauthorized" : "Missing bearer token" },
      { status: 401 },
    );
  }

  let contactEmail: string | null;
  try {
    contactEmail = await getProfileContactEmail(service, user.id);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }

  const seedEmail = getDevBypassSeedEmail();
  const devRecipient =
    process.env.DEV_BYPASS_RECIPIENT_EMAIL?.trim() ||
    process.env.NCBI_EMAIL?.trim() ||
    seedEmail;
  const emailTo = (devBypass && devRecipient
    ? devRecipient
    : contactEmail || user.email || "").trim();
  if (!emailTo) {
    return NextResponse.json({ error: "No contact email found for this user" }, { status: 400 });
  }

  let spotlightResult: Awaited<ReturnType<typeof buildSpotlightPapers>>;
  try {
    spotlightResult = await buildSpotlightPapers({ userId: user.id, service });
  } catch (error) {
    return NextResponse.json(
      { error: `Build spotlight failed: ${getErrorMessage(error)}` },
      { status: 500 },
    );
  }
  const items = spotlightResult.items;
  if (!items.length) {
    return NextResponse.json({ error: "No spotlight papers available" }, { status: 400 });
  }

  try {
    await sendSpotlightDigestEmail({
      to: emailTo,
      subject: getDailySpotlightEmailSubject(),
      items,
      heading: "今日首页精选 7 篇文献",
      intro: "这是 Z-Lab AI 为您精选的本期 7 篇文献（5 篇相关 + 1 篇热点 + 1 篇拓展），内容与首页保持同源。",
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Email sending failed: ${getErrorMessage(error)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    emailedTo: emailTo,
    count: items.length,
    personalized: spotlightResult.hasProfileConfig,
    userId: user.id,
  });
}
