import { PROVIDER_CONFIG, type ByokProvider } from "@/lib/byok-config";

export interface LLMRequest {
  provider: ByokProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
}

export async function callLLM(req: LLMRequest): Promise<LLMResponse> {
  const temperature = req.temperature ?? 0.2;

  if (["openai", "deepseek", "moonshot", "qwen", "zhipu"].includes(req.provider)) {
    const url = PROVIDER_CONFIG[req.provider].baseUrl;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        temperature,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      error?: { message?: string } | string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (!res.ok) {
      const msg =
        typeof json.error === "string"
          ? json.error
          : json.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) throw new Error("Model returned empty content");
    return {
      content,
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
    };
  }

  if (req.provider === "anthropic") {
    const url = PROVIDER_CONFIG.anthropic.baseUrl;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: 1024,
        temperature,
        system: req.systemPrompt,
        messages: [{ role: "user", content: req.userPrompt }],
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      error?: { message?: string } | string;
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (!res.ok) {
      const msg =
        typeof json.error === "string"
          ? json.error
          : json.error?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const content =
      json.content?.find((x) => x.type === "text")?.text?.trim() ??
      json.content?.[0]?.text?.trim() ??
      "";
    if (!content) throw new Error("Model returned empty content");
    return {
      content,
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    };
  }

  if (req.provider === "gemini") {
    const model = encodeURIComponent(req.model);
    const url = `${PROVIDER_CONFIG.gemini.baseUrl}/${model}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: req.userPrompt }] }],
        generationConfig: { temperature },
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (!res.ok) {
      throw new Error(json.error?.message || `HTTP ${res.status}`);
    }
    const content = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!content) throw new Error("Model returned empty content");
    return {
      content,
      inputTokens: json.usageMetadata?.promptTokenCount,
      outputTokens: json.usageMetadata?.candidatesTokenCount,
    };
  }

  throw new Error(`Unsupported provider: ${req.provider}`);
}
