export type ByokProvider =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "gemini"
  | "zhipu"
  | "moonshot"
  | "qwen";

export const PROVIDER_CONFIG: Record<
  ByokProvider,
  { baseUrl: string; models: Array<{ value: string; label: string }> }
> = {
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    models: [
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini（推荐，便宜）" },
      { value: "gpt-5.4", label: "GPT 5.4" },
    ],
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    models: [
      { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5（推荐，便宜）" },
      { value: "claude-opus-4-6-20260101", label: "Claude Opus 4.6" },
    ],
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/chat/completions",
    models: [{ value: "deepseek-chat", label: "DeepSeek V3（推荐）" }],
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    models: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { value: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    ],
  },
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    models: [{ value: "glm-4-flash", label: "GLM-4 Flash（免费）" }],
  },
  moonshot: {
    baseUrl: "https://api.moonshot.cn/v1/chat/completions",
    models: [{ value: "moonshot-v1-8k", label: "Moonshot v1 8K" }],
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    models: [{ value: "qwen-turbo", label: "通义千问 Turbo" }],
  },
};

export function isByokProvider(value: string): value is ByokProvider {
  return Object.prototype.hasOwnProperty.call(PROVIDER_CONFIG, value);
}
