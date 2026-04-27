import { NextResponse } from "next/server";

import { callMiniMaxChat, getMiniMaxModel } from "@/lib/minimax";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createUserSupabaseClient } from "@/lib/supabase/user";
import {
  getPaperForTranslation,
  recordByokTranslationUsage,
  savePaperTranslationFields,
  type PaperTranslationRow,
} from "@/server/repositories/paper-translation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function stripMarkdownFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
}

function parseTranslationResult(content: string) {
  const cleaned = stripMarkdownFence(content);
  try {
    const parsed = JSON.parse(cleaned) as { title_zh?: unknown; abstract_zh?: unknown };
    const titleZh = typeof parsed.title_zh === "string" && parsed.title_zh.trim() ? parsed.title_zh.trim() : null;
    const abstractZh =
      typeof parsed.abstract_zh === "string" && parsed.abstract_zh.trim() ? parsed.abstract_zh.trim() : null;
    return { titleZh, abstractZh };
  } catch {
    const lines = cleaned
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const titleZh = lines[0] || null;
    return {
      titleZh,
      abstractZh: cleaned || null,
    };
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  let paper: PaperTranslationRow | null;
  try {
    paper = await getPaperForTranslation(service, paperId);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
  if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  if (paper.title_zh && paper.abstract_zh) {
    return NextResponse.json({ ok: true, title_zh: paper.title_zh, abstract_zh: paper.abstract_zh });
  }

  const systemPrompt = `你是一位专业的医学翻译。
请把英文论文标题与摘要翻译成准确、自然、简洁的中文。
必须仅输出 JSON，对象格式如下：
{"title_zh":"...","abstract_zh":"..."}
不要输出 Markdown、解释或额外字段。`;
  const userPrompt = `期刊：${paper.journal ?? "Unknown"}
英文标题：${paper.title}
英文摘要：${paper.abstract ?? "无摘要"}`;

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let model = getMiniMaxModel();
  try {
    const result = await callMiniMaxChat({
      systemPrompt,
      userPrompt,
      temperature: 0.1,
      maxTokens: 2000,
    });
    model = result.model;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;

    const parsed = parseTranslationResult(result.content);
    const titleZh = (paper.title_zh || parsed.titleZh || paper.title || "").slice(0, 120);
    const abstractZh = paper.abstract_zh || parsed.abstractZh || paper.abstract || "No abstract available.";
    await savePaperTranslationFields(service, paperId, {
      titleZh: !paper.title_zh ? parsed.titleZh : null,
      abstractZh: !paper.abstract_zh ? parsed.abstractZh : null,
    });

    await recordByokTranslationUsage(service, {
      userId: user.id,
      paperId,
      provider: "minimax",
      model,
      inputTokens,
      outputTokens,
      status: "success",
    });

    return NextResponse.json({ ok: true, title_zh: titleZh, abstract_zh: abstractZh });
  } catch (e: unknown) {
    await recordByokTranslationUsage(service, {
      userId: user.id,
      paperId,
      provider: "minimax",
      model,
      inputTokens,
      outputTokens,
      status: "failed",
    });
    return NextResponse.json({
      ok: true,
      title_zh: paper.title_zh || paper.title || "",
      abstract_zh: paper.abstract_zh || paper.abstract || "No abstract available.",
      fallback_to_english: true,
      message: `翻译失败，已回退英文原文：${getErrorMessage(e)}`,
    });
  }
}
