import { callMiniMaxChat, getMiniMaxApiKey } from "@/lib/minimax";

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

function parseJsonFromModelOutput(text: string) {
  const trimmed = text.trim();
  const cleaned = trimmed.startsWith("```")
    ? trimmed
        .replace(/^```[a-zA-Z]*\n?/, "")
        .replace(/```$/, "")
        .trim()
    : trimmed;
  return JSON.parse(cleaned) as KeywordExpansionResult;
}

export async function callMiniMaxKeywordExpansion(prompt: string) {
  if (!getMiniMaxApiKey()) return null;

  try {
    const response = await callMiniMaxChat({
      userPrompt: prompt,
      maxTokens: 500,
      temperature: 0.1,
    });
    return parseJsonFromModelOutput(response.content);
  } catch {
    return null;
  }
}
