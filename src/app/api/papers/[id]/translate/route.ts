import { NextResponse } from "next/server";

import { callMiniMaxChat, getMiniMaxModel } from "@/lib/minimax";
import { parseTranslationResult } from "@/lib/paper-translation-result";
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
  const matched = auth.match(/^Bearer\s+(.+)$/i);
  return matched?.[1];
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function fallbackTranslationResponse(paper: PaperTranslationRow, message: string) {
  return {
    ok: true,
    title_zh: paper.title_zh || paper.title || "",
    abstract_zh: paper.abstract_zh || paper.abstract || "No abstract available.",
    fallback_to_english: true,
    message,
  };
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

  const systemPrompt = `
You are a professional biomedical translator.
Translate the English paper title and abstract into accurate, natural Simplified Chinese.
Return exactly one JSON object with this shape:
{"title_zh":"...","abstract_zh":"..."}
Do not output markdown, explanations, analysis, chain-of-thought, <think> tags, or extra fields.
`.trim();
  const userPrompt = `
Journal: ${paper.journal ?? "Unknown"}
English title: ${paper.title}
English abstract: ${paper.abstract ?? "No abstract available."}
`.trim();

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let model = getMiniMaxModel();
  try {
    const result = await callMiniMaxChat({
      label: "manual_paper_translation",
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
  } catch (error: unknown) {
    await recordByokTranslationUsage(service, {
      userId: user.id,
      paperId,
      provider: "minimax",
      model,
      inputTokens,
      outputTokens,
      status: "failed",
    });
    return NextResponse.json(
      fallbackTranslationResponse(
        paper,
        `Translation failed, showing the original English abstract instead: ${getErrorMessage(error)}`,
      ),
    );
  }
}
