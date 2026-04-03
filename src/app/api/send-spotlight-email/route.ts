import { NextResponse } from "next/server";
import { Resend } from "resend";

import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
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

function buildDigestHtml(items: Awaited<ReturnType<typeof buildSpotlightPapers>>["items"]) {
  const baseUrl = process.env.APP_BASE_URL?.trim() || "https://trae73v9r64b.vercel.app";
  const logoUrl = `${baseUrl}/api/brand/logo`;
  const rows = items
    .map(
      (item, index) => `
      <div style="margin-bottom:20px;padding:14px;border:1px solid #e2e8f0;border-radius:10px;">
        <div style="margin-bottom:6px;">
          <span style="display:inline-block;font-size:11px;color:#0f172a;background:#e2e8f0;border-radius:6px;padding:3px 8px;margin-right:6px;">#${index + 1}</span>
          <span style="display:inline-block;font-size:11px;color:#0369a1;background:#e0f2fe;border:1px solid #bae6fd;border-radius:6px;padding:3px 8px;margin-right:6px;">${item.source_type}</span>
          <span style="display:inline-block;font-size:11px;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;border-radius:6px;padding:3px 8px;">${(item.quality_tier ?? "").toUpperCase()}</span>
        </div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:8px;">${item.title}</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">${item.journal} · ${item.publication_date ?? "N/A"}</div>
        <div style="margin-bottom:8px;"><a href="${item.pubmed_url}" target="_blank" rel="noreferrer">查看 PubMed 原文</a></div>
        <div style="font-size:13px;line-height:1.7;color:#334155;white-space:pre-wrap;">${item.abstract_zh ?? "中文摘要待生成。"}</div>
      </div>
    `,
    )
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;">
      <div style="display:flex;align-items:center;margin-bottom:12px;">
        <img src="${logoUrl}" alt="Z-Lab" style="height:28px;margin-right:10px;border-radius:6px;" />
        <div style="font-size:18px;font-weight:800;color:#0f172a;">Z-Lab 医学前沿精选</div>
      </div>
      <p style="color:#475569;margin:4px 0 16px 0;font-size:13px;">这是 Z‑Lab AI 为您精选的本期 7 篇文献（5 篇相关 + 1 篇热点 + 1 篇拓边）。</p>
      ${rows}
      <div style="margin-top:16px;font-size:11px;color:#64748b;">如需调整订阅偏好，请前往 Z‑Lab 设置页面。</div>
    </div>
  `;
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

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (!resendApiKey) {
    return NextResponse.json({ error: "Missing required env: RESEND_API_KEY" }, { status: 500 });
  }
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) {
    return NextResponse.json({ error: "Missing required env: RESEND_FROM_EMAIL" }, { status: 500 });
  }
  const resend = new Resend(resendApiKey);
  const html = buildDigestHtml(items);
  let mailErr: { message: string } | null = null;
  try {
    const resp = await resend.emails.send({
      from,
      to: emailTo,
      subject: "今日精选 7 篇文献（含中文摘要）",
      html,
    });
    mailErr = resp.error ?? null;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `Email sending failed: ${error.message}` : "Email sending failed" },
      { status: 500 },
    );
  }
  if (mailErr) {
    return NextResponse.json({ error: `Email sending failed: ${mailErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    emailedTo: emailTo,
    count: items.length,
  });
}
