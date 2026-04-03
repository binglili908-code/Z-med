import { NextResponse } from "next/server";

import { decryptText } from "@/lib/crypto-util";
import { callLLM } from "@/lib/llm-client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: paperId } = await params;
  const service = createServiceSupabaseClient();
  const { data: paper, error: pErr } = await service
    .from("papers")
    .select("id,title,title_zh,journal,abstract,abstract_zh,is_open_access")
    .eq("id", paperId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  if (paper.title_zh && paper.abstract_zh) {
    return NextResponse.json({ ok: true, title_zh: paper.title_zh, abstract_zh: paper.abstract_zh });
  }

  const { data: profile, error: profErr } = await service
    .from("profiles")
    .select("byok_provider,byok_api_key_encrypted,byok_model")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  if (!profile?.byok_provider || !profile?.byok_api_key_encrypted || !profile?.byok_model) {
    return NextResponse.json({ error: "BYOK not configured" }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = decryptText(profile.byok_api_key_encrypted);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Decrypt failed" }, { status: 500 });
  }

  const systemPrompt =
    "你是一位专业的医学翻译。请将以下英文论文标题与摘要翻译为准确、流畅的中文。仅输出中文内容。";
  const userPrompt = `期刊：${paper.journal ?? "Unknown"}
英文标题：${paper.title}
英文摘要：${paper.abstract ?? "无摘要"}`;

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  try {
    const result = await callLLM({
      provider: profile.byok_provider,
      apiKey,
      model: profile.byok_model,
      systemPrompt,
      userPrompt,
      temperature: 0.1,
    });
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;

    const titleZh = result.content.split("\n")[0].slice(0, 120);
    const abstractZh = result.content;
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    if (!paper.title_zh && titleZh) update.title_zh = titleZh;
    if (!paper.abstract_zh && abstractZh) update.abstract_zh = abstractZh;
    await service.from("papers").update(update).eq("id", paperId);

    await service.from("byok_usage_log").insert({
      user_id: user.id,
      paper_id: paperId,
      provider: profile.byok_provider,
      model: profile.byok_model,
      usage_type: "translate",
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      status: "success",
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, title_zh: titleZh, abstract_zh: abstractZh });
  } catch (e: any) {
    await service.from("byok_usage_log").insert({
      user_id: user.id,
      paper_id: paperId,
      provider: profile.byok_provider,
      model: profile.byok_model,
      usage_type: "translate",
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      status: "failed",
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ error: e?.message || "Translate failed" }, { status: 400 });
  }
}
