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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

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

  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("contact_email")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) {
    return NextResponse.json({ error: `Profile query failed: ${profileErr.message}` }, { status: 500 });
  }

  const seedEmail = getDevBypassSeedEmail();
  const devRecipient =
    process.env.DEV_BYPASS_RECIPIENT_EMAIL?.trim() ||
    process.env.NCBI_EMAIL?.trim() ||
    seedEmail;
  const emailTo = (devBypass && devRecipient
    ? devRecipient
    : profile?.contact_email || user.email || "").trim();
  if (!emailTo) {
    return NextResponse.json({ error: "No contact email found for this user" }, { status: 400 });
  }

  let items: Awaited<ReturnType<typeof buildSpotlightPapers>>["items"] = [];
  try {
    const result = await buildSpotlightPapers({ userId: user.id, service });
    items = result.items;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `Build spotlight failed: ${error.message}` : "Build spotlight failed" },
      { status: 500 },
    );
  }
  if (!items.length) {
    return NextResponse.json({ error: "No spotlight papers available" }, { status: 400 });
  }

  try {
    await sendSpotlightDigestEmail({
      to: emailTo,
      subject: getDailySpotlightEmailSubject(),
      items,
      heading: "今日首页精选 7 篇文献",
      intro: "这是 Z‑Lab AI 为您精选的本期 7 篇文献（5 篇相关 + 1 篇热点 + 1 篇拓边）。",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `Email sending failed: ${error.message}` : "Email sending failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    emailedTo: emailTo,
    count: items.length,
  });
}
