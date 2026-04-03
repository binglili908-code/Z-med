import { NextResponse } from "next/server";

import { callLLM } from "@/lib/llm-client";
import { isByokProvider, PROVIDER_CONFIG } from "@/lib/byok-config";
import { createUserSupabaseClient } from "@/lib/supabase/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userClient = createUserSupabaseClient(token);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { provider?: string; model?: string; apiKey?: string };
  try {
    body = (await req.json()) as any;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const provider = (body.provider ?? "").trim();
  const model = (body.model ?? "").trim();
  const apiKey = (body.apiKey ?? "").trim();
  if (!provider || !model || !apiKey) {
    return NextResponse.json({ error: "provider/model/apiKey required" }, { status: 400 });
  }
  if (!isByokProvider(provider)) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }
  const modelAllowed = PROVIDER_CONFIG[provider].models.some((m) => m.value === model);
  if (!modelAllowed) {
    return NextResponse.json({ error: "Model not allowed for provider" }, { status: 400 });
  }

  try {
    const result = await callLLM({
      provider,
      model,
      apiKey,
      systemPrompt: "你是医学翻译助手。",
      userPrompt: "请把这句话翻译为中文：This is a connection test.",
      temperature: 0.1,
    });
    return NextResponse.json({
      ok: true,
      preview: result.content.slice(0, 120),
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Connection test failed" }, { status: 400 });
  }
}
