import { NextResponse } from "next/server";

import { sendResendEmail } from "@/lib/resend-email";
import {
  getDevBypassSeedEmail,
  getDevBypassUserId,
  isDevBypassAuthEnabled,
} from "@/lib/supabase/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";
import {
  getPaperForPdfEmail,
  recordPdfEmailInteraction,
} from "@/server/repositories/pdf-email";
import {
  findProfileIdByContactEmail,
  getProfileContactEmail,
} from "@/server/repositories/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  paperId?: string;
};

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

async function resolveBypassUserId(serviceClient: ReturnType<typeof createServiceSupabaseClient>) {
  const direct = getDevBypassUserId();
  if (direct) return direct;
  const seedEmail = getDevBypassSeedEmail();
  if (!seedEmail) return null;
  return findProfileIdByContactEmail(serviceClient, seedEmail);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  const devBypass = isDevBypassAuthEnabled();
  const serviceClient = createServiceSupabaseClient();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const paperId = body.paperId?.trim();
  if (!paperId) {
    return NextResponse.json({ error: "paperId is required" }, { status: 400 });
  }

  let user: { id: string; email?: string | null } | null = null;
  let userErr: { message: string } | null = null;

  if (token) {
    const userClient = createUserSupabaseClient(token);
    const r = await userClient.auth.getUser();
    user = r.data.user ? { id: r.data.user.id, email: r.data.user.email } : null;
    userErr = r.error ? { message: r.error.message } : null;
  } else if (devBypass) {
    const id = await resolveBypassUserId(serviceClient);
    if (id) {
      user = { id, email: null };
    }
  }

  if (userErr || !user) {
    return NextResponse.json(
      { error: token ? "Unauthorized" : "Missing bearer token" },
      { status: 401 },
    );
  }

  let contactEmail: string | null;
  try {
    contactEmail = await getProfileContactEmail(serviceClient, user.id);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
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
    return NextResponse.json(
      { error: "No contact email found for this user" },
      { status: 400 },
    );
  }

  const paper = await getPaperForPdfEmail(serviceClient, paperId);
  if (!paper) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }

  if (!paper.is_open_access || !paper.oa_pdf_url) {
    return NextResponse.json(
      { error: "This paper has no open-access PDF URL" },
      { status: 400 },
    );
  }

  const subject = `文献全文链接：${paper.title}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>你请求的开源文献已准备好</h2>
      <p><strong>标题：</strong>${paper.title}</p>
      <p><strong>PubMed：</strong><a href="${paper.pubmed_url}" target="_blank" rel="noreferrer">${paper.pubmed_url}</a></p>
      <p><strong>PDF直链：</strong><a href="${paper.oa_pdf_url}" target="_blank" rel="noreferrer">${paper.oa_pdf_url}</a></p>
      <p>说明：仅对 Open Access 文献提供此服务。</p>
    </div>
  `;

  try {
    await sendResendEmail({
      to: emailTo,
      subject,
      html,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Email sending failed: ${error.message}`
            : "Email sending failed",
      },
      { status: 500 },
    );
  }

  try {
    await recordPdfEmailInteraction(serviceClient, {
      userId: user.id,
      paperId: paper.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    paperId: paper.id,
    emailedTo: emailTo,
  });
}
