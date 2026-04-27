import fs from "node:fs";
import path from "node:path";

import { fetchWithTimeout } from "@/lib/external-fetch";

export interface MiniMaxChatRequest {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  label?: string;
}

export interface MiniMaxChatResponse {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  model: string;
}

const DEFAULT_MINIMAX_API_BASE_URL = "https://api.minimaxi.com";
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
const FALLBACK_MINIMAX_MODEL = "MiniMax-M2.7";

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

function getMiniMaxReasoningSplit() {
  const value =
    process.env.MINIMAX_REASONING_SPLIT?.trim() ||
    readLocalEnvValue("MINIMAX_REASONING_SPLIT") ||
    "";
  return value.toLowerCase() === "true";
}

function getMiniMaxChatCompletionsEndpoint() {
  const baseUrl = getMiniMaxApiBaseUrl();
  return baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
}

function shouldRetryWithFallbackModel(model: string, status: number, message: string) {
  if (model === FALLBACK_MINIMAX_MODEL) return false;
  if (!/highspeed/i.test(model)) return false;
  return status === 400 || /not support model|2061/i.test(message);
}

function normalizeMiniMaxTemperature(value: number | undefined) {
  if (value == null) return 1;
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0.1, value));
}

function extractMiniMaxContent(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    })
    .join("")
    .trim();
}

function logMiniMaxDiagnostic(
  event: string,
  details: Record<string, unknown>,
) {
  try {
    console.error(
      "[MiniMax diagnostic]",
      JSON.stringify({
        event,
        at: new Date().toISOString(),
        ...details,
      }),
    );
  } catch {
    console.error("[MiniMax diagnostic]", event, details);
  }
}

async function callMiniMaxChatWithModel(
  req: MiniMaxChatRequest,
  apiKey: string,
  model: string,
  options: { reasoningSplit: boolean; retriedWithoutReasoningSplit?: boolean },
): Promise<MiniMaxChatResponse> {
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
  const requestBody = {
    model,
    messages,
    temperature: normalizeMiniMaxTemperature(req.temperature),
    max_completion_tokens: req.maxTokens ?? 1600,
    ...(options.reasoningSplit ? { reasoning_split: true } : {}),
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(getMiniMaxChatCompletionsEndpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      cache: "no-store",
      label: "MiniMax chat",
      timeoutMs: 45000,
    });
  } catch (error) {
    logMiniMaxDiagnostic("request_failed_before_response", {
      label: req.label ?? null,
      endpoint: getMiniMaxChatCompletionsEndpoint(),
      requestBody,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        base_resp?: { status_msg?: string };
        error?: { message?: string };
        message?: string;
        choices?: Array<{
          finish_reason?: string;
          message?: {
            content?: unknown;
          };
        }>;
        usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
      }
    | null;

  if (!response.ok) {
    const msg =
      payload?.base_resp?.status_msg ||
      payload?.error?.message ||
      payload?.message ||
      `HTTP ${response.status}`;
    if (shouldRetryWithFallbackModel(model, response.status, msg)) {
      logMiniMaxDiagnostic("retry_with_fallback_model", {
        label: req.label ?? null,
        endpoint: getMiniMaxChatCompletionsEndpoint(),
        status: response.status,
        fromModel: model,
        toModel: FALLBACK_MINIMAX_MODEL,
        message: msg,
        requestBody,
        responsePayload: payload,
      });
      return callMiniMaxChatWithModel(req, apiKey, FALLBACK_MINIMAX_MODEL, options);
    }
    logMiniMaxDiagnostic("http_error", {
      label: req.label ?? null,
      endpoint: getMiniMaxChatCompletionsEndpoint(),
      status: response.status,
      statusText: response.statusText,
      message: msg,
      requestBody,
      responsePayload: payload,
    });
    throw new Error(`MiniMax request failed: ${msg}`);
  }

  const content = extractMiniMaxContent(payload?.choices?.[0]?.message?.content);
  if (!content && options.reasoningSplit && !options.retriedWithoutReasoningSplit) {
    logMiniMaxDiagnostic("empty_content_retry_without_reasoning_split", {
      label: req.label ?? null,
      endpoint: getMiniMaxChatCompletionsEndpoint(),
      status: response.status,
      requestBody,
      responsePayload: payload,
    });
    return callMiniMaxChatWithModel(req, apiKey, model, {
      reasoningSplit: false,
      retriedWithoutReasoningSplit: true,
    });
  }
  if (!content) {
    const finishReason = payload?.choices?.[0]?.finish_reason;
    logMiniMaxDiagnostic("empty_content", {
      label: req.label ?? null,
      endpoint: getMiniMaxChatCompletionsEndpoint(),
      status: response.status,
      finishReason: finishReason ?? null,
      contentType: typeof payload?.choices?.[0]?.message?.content,
      requestBody,
      responsePayload: payload,
    });
    throw new Error(
      finishReason
        ? `MiniMax response has no content (finish_reason: ${finishReason})`
        : "MiniMax response has no content",
    );
  }

  return {
    content,
    inputTokens: payload?.usage?.prompt_tokens,
    outputTokens: payload?.usage?.completion_tokens ?? payload?.usage?.total_tokens,
    model,
  };
}

export async function callMiniMaxChat(req: MiniMaxChatRequest): Promise<MiniMaxChatResponse> {
  const apiKey = getMiniMaxApiKey();
  if (!apiKey) {
    throw new Error("Missing MINIMAX_API_KEY");
  }

  return callMiniMaxChatWithModel(req, apiKey, getMiniMaxModel(req.model), {
    reasoningSplit: getMiniMaxReasoningSplit(),
  });
}
