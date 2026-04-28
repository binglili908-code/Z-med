import { parseJsonObjectFromModelOutput } from "@/lib/model-json";

type TranslationPayload = {
  title_zh?: unknown;
  abstract_zh?: unknown;
};

function stripReasoningBlocks(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .trim();
}

function cleanTranslatedField(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = stripReasoningBlocks(value)
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
  return cleaned ? cleaned : null;
}

export function parseTranslationResult(content: string) {
  const parsed = parseJsonObjectFromModelOutput<TranslationPayload>(
    content,
    "MiniMax translation response",
  );
  return {
    titleZh: cleanTranslatedField(parsed.title_zh),
    abstractZh: cleanTranslatedField(parsed.abstract_zh),
  };
}
