import { parseJsonObjectFromModelOutput } from "@/lib/model-json";
import { stripReasoningBlocks } from "@/lib/model-output-cleaning";

type TranslationPayload = {
  title_zh?: unknown;
  abstract_zh?: unknown;
};

export function cleanTranslatedText(value: unknown) {
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
    titleZh: cleanTranslatedText(parsed.title_zh),
    abstractZh: cleanTranslatedText(parsed.abstract_zh),
  };
}
