import { callMiniMaxChat, getMiniMaxApiKey } from "@/lib/minimax";
import { parseJsonObjectFromModelOutput } from "@/lib/model-json";

type KeywordExpansionResult = {
  pubmed_query?: string;
  synonyms?: string[];
  title_required?: string[];
};

export function extractPubmedQueryText(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as any;
    if (typeof first === "string") return first;
    if (typeof first?.build_pubmed_query_for_keyword === "string") {
      return first.build_pubmed_query_for_keyword as string;
    }
  }
  if (typeof (value as any)?.build_pubmed_query_for_keyword === "string") {
    return (value as any).build_pubmed_query_for_keyword as string;
  }
  return "";
}

export async function callMiniMaxKeywordExpansion(prompt: string) {
  if (!getMiniMaxApiKey()) return null;

  try {
    const response = await callMiniMaxChat({
      label: "pubmed_keyword_expansion",
      userPrompt: prompt,
      maxTokens: 500,
      temperature: 0.1,
    });
    return parseJsonObjectFromModelOutput<KeywordExpansionResult>(
      response.content,
      "MiniMax keyword response",
    );
  } catch {
    return null;
  }
}
