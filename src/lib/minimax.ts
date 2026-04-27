import fs from "node:fs";
import path from "node:path";

import { fetchWithTimeout } from "@/lib/external-fetch";

export interface MiniMaxChatRequest {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface MiniMaxChatResponse {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  model: string;
}

const DEFAULT_MINIMAX_API_BASE_URL = "https://api.minimaxi.com";
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7-highspeed";

function readLocalEnvValue(name: string) {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const files = [
      path.join(process.cwd(), ".env.local"),
      path.join(process.cwd(), "zlab-web", ".env.local"),
    ];
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
      for (const line of lines) {
        const text = line.trim();
        if (!text || text.startsWith("#")) continue;
        if (!text.startsWith(`${name}=`)) continue;
        const value = text.slice(name.length + 1).trim();
        if (value) return value;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function getMiniMaxApiKey() {
  return process.env.MINIMAX_API_KEY?.trim() || readLocalEnvValue("MINIMAX_API_KEY") || null;
}

export function getMiniMaxGroupId() {
  return process.env.MINIMAX_GROUP_ID?.trim() || readLocalEnvValue("MINIMAX_GROUP_ID") || null;
}

export function getMiniMaxModel(model?: string) {
  return (
    model?.trim() ||
    process.env.MINIMAX_MODEL?.trim() ||
    readLocalEnvValue("MINIMAX_MODEL") ||
    DEFAULT_MINIMAX_MODEL
  );
}

function getMiniMaxApiBaseUrl() {
  return (
    process.env.MINIMAX_API_BASE_URL?.trim() ||
    readLocalEnvValue("MINIMAX_API_BASE_URL") ||
    DEFAULT_MINIMAX_API_BASE_URL
  ).replace(/\/+$/, "");
}

function getMiniMaxChatCompletionsEndpoint() {
  const baseUrl = getMiniMaxApiBaseUrl();
  return baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
}

function normalizeMiniMaxTemperature(value: number | undefined) {
  if (value == null) return 1;
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0.1, value));
}

export async function callMiniMaxChat(req: MiniMaxChatRequest): Promise<MiniMaxChatResponse> {
  const apiKey = getMiniMaxApiKey();
  if (!apiKey) {
    throw new Error("Missing MINIMAX_API_KEY");
  }

  const model = getMiniMaxModel(req.model);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const groupId = getMiniMaxGroupId();
  if (groupId) {
    headers.GroupId = groupId;
    headers["X-Group-Id"] = groupId;
  }

  const messages = [];
  if (req.systemPrompt?.trim()) {
    messages.push({ role: "system", content: req.systemPrompt.trim() });
  }
  messages.push({ role: "user", content: req.userPrompt });

  const response = await fetchWithTimeout(getMiniMaxChatCompletionsEndpoint(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: normalizeMiniMaxTemperature(req.temperature),
      max_completion_tokens: req.maxTokens ?? 1600,
    }),
    cache: "no-store",
    label: "MiniMax chat",
    timeoutMs: 45000,
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        base_resp?: { status_msg?: string };
        error?: { message?: string };
        message?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
      }
    | null;

  if (!response.ok) {
    const msg =
      payload?.base_resp?.status_msg ||
      payload?.error?.message ||
      payload?.message ||
      `HTTP ${response.status}`;
    throw new Error(`MiniMax request failed: ${msg}`);
  }

  const content = payload?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    throw new Error("MiniMax response has no content");
  }

  return {
    content,
    inputTokens: payload?.usage?.prompt_tokens,
    outputTokens: payload?.usage?.completion_tokens ?? payload?.usage?.total_tokens,
    model,
  };
}
