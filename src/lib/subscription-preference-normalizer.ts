import { callMiniMaxChat, getMiniMaxApiKey } from "@/lib/minimax";
import { parseJsonObjectFromModelOutput } from "@/lib/model-json";
import {
  expandSubscriptionTerms,
  normalizeMatchText,
} from "@/lib/subscription-matching";

export type NormalizedSubscriptionPreferences = {
  keywords: string[];
  journals: string[];
  normalizedTerms: Record<string, unknown>;
  model: string | null;
  error: string | null;
};

type MiniMaxPreferencePayload = {
  keywords?: unknown;
  journals?: unknown;
  aliases?: unknown;
  notes?: unknown;
};

function dedupeTerms(values: unknown, maxItems: number) {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    const normalized = normalizeMatchText(trimmed);
    if (!trimmed || !normalized || trimmed.length > 120) continue;
    const key = normalized.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }

  return out;
}

function localFallback(args: {
  keywords: string[];
  customJournals: string[];
  error?: string | null;
}): NormalizedSubscriptionPreferences {
  return {
    keywords: expandSubscriptionTerms(args.keywords),
    journals: expandSubscriptionTerms(args.customJournals),
    normalizedTerms: {
      source: "local_fallback",
      raw_keywords: args.keywords,
      raw_journals: args.customJournals,
      error: args.error ?? null,
    },
    model: "local_fallback",
    error: args.error ?? null,
  };
}

function buildPrompt(args: { keywords: string[]; customJournals: string[] }) {
  return `
You normalize biomedical subscription preferences for a medical literature recommendation system.

Input can include typos, acronyms, journal abbreviations, Chinese or English terms, and natural language.
Convert it into precise searchable terms. Prefer PubMed-friendly English biomedical terms and full journal names.

Rules:
- Return strict JSON only. No markdown.
- Correct obvious spelling mistakes.
- Expand journal abbreviations, for example EJVES -> European Journal of Vascular and Endovascular Surgery.
- Keep terms specific enough for literature matching. Avoid vague terms like "medicine" unless the user explicitly asked for it.
- Include common abbreviations when they are useful search terms, but do not invent unsupported interests.
- Maximum 30 keywords and 20 journals.

JSON shape:
{
  "keywords": ["standardized biomedical keyword"],
  "journals": ["full journal name or widely used journal abbreviation"],
  "aliases": {"raw user input": ["expanded alias"]},
  "notes": ["short internal note"]
}

Raw keywords:
${JSON.stringify(args.keywords)}

Raw journals:
${JSON.stringify(args.customJournals)}
`.trim();
}

export async function normalizeSubscriptionPreferences(args: {
  keywords: string[];
  customJournals: string[];
}): Promise<NormalizedSubscriptionPreferences> {
  if (!args.keywords.length && !args.customJournals.length) {
    return {
      keywords: [],
      journals: [],
      normalizedTerms: { source: "empty" },
      model: null,
      error: null,
    };
  }

  if (!getMiniMaxApiKey()) {
    return localFallback({ ...args, error: "Missing MINIMAX_API_KEY" });
  }

  try {
    const response = await callMiniMaxChat({
      label: "subscription_preference_normalization",
      userPrompt: buildPrompt(args),
      maxTokens: 900,
      temperature: 0.1,
    });
    const parsed = parseJsonObjectFromModelOutput<MiniMaxPreferencePayload>(
      response.content,
      "MiniMax preference response",
    );
    const keywords = dedupeTerms(
      [...args.keywords, ...dedupeTerms(parsed.keywords, 30)],
      40,
    );
    const journals = dedupeTerms(
      [...args.customJournals, ...dedupeTerms(parsed.journals, 20)],
      30,
    );

    return {
      keywords: expandSubscriptionTerms(keywords),
      journals: expandSubscriptionTerms(journals),
      normalizedTerms: {
        source: "minimax",
        raw_keywords: args.keywords,
        raw_journals: args.customJournals,
        keywords,
        journals,
        aliases: parsed.aliases ?? {},
        notes: parsed.notes ?? [],
        usage: {
          input_tokens: response.inputTokens ?? null,
          output_tokens: response.outputTokens ?? null,
        },
      },
      model: response.model,
      error: null,
    };
  } catch (error) {
    return localFallback({
      ...args,
      error: error instanceof Error ? error.message : "Unknown MiniMax error",
    });
  }
}
