import { callMiniMaxChat, getMiniMaxApiKey } from "@/lib/minimax";
import {
  planMedicalQuery,
  type MedicalQueryPlannerDependencies,
} from "@/lib/medical-query-planner";
import type { MedicalQueryPlan } from "@/lib/medical-query-plan";
import { parseJsonObjectFromModelOutput } from "@/lib/model-json";
import { assistPubmedKeywords } from "@/lib/pubmed-query-assist";
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

export type SubscriptionPreferenceNormalizerDependencies = {
  planMedicalQuery?: (
    input: string[],
    dependencies?: MedicalQueryPlannerDependencies,
  ) => Promise<MedicalQueryPlan>;
  medicalQueryPlannerDependencies?: MedicalQueryPlannerDependencies;
  medicalQueryPlannerEnabled?: boolean;
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

const SYSTEM_PROMPT = `
You are a JSON-only biomedical preference normalizer.
Return exactly one valid JSON object.
Do not include markdown, code fences, explanations, thinking, or text before/after JSON.
The first character of your answer must be { and the last character must be }.
`.trim();

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

function logPreferenceParseDiagnostic(details: Record<string, unknown>) {
  try {
    console.error(
      "[MiniMax preference parse diagnostic]",
      JSON.stringify({
        at: new Date().toISOString(),
        ...details,
      }),
    );
  } catch {
    console.error("[MiniMax preference parse diagnostic]", details);
  }
}

export function isMedicalQueryPlannerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.MEDICAL_QUERY_PLANNER_ENABLED?.trim().toLowerCase() === "true";
}

async function maybeAddMedicalQueryPlanMetadata(args: {
  normalizedTerms: Record<string, unknown>;
  rawKeywords: string[];
  normalizedKeywords: string[];
  dependencies: SubscriptionPreferenceNormalizerDependencies;
}) {
  const enabled =
    args.dependencies.medicalQueryPlannerEnabled ?? isMedicalQueryPlannerEnabled();
  if (!enabled) return args.normalizedTerms;
  const input = dedupeTerms([...args.rawKeywords, ...args.normalizedKeywords], 40);
  if (!input.length) return args.normalizedTerms;

  try {
    const planner = args.dependencies.planMedicalQuery ?? planMedicalQuery;
    const plan = await planner(input, args.dependencies.medicalQueryPlannerDependencies);
    return {
      ...args.normalizedTerms,
      medical_query_planner: {
        source: "dynamic_medical_query_planner",
        plan,
        error: null,
      },
    };
  } catch (error) {
    return {
      ...args.normalizedTerms,
      medical_query_planner: {
        source: "dynamic_medical_query_planner",
        plan: null,
        error: error instanceof Error ? error.message : "Unknown medical query planner error",
      },
    };
  }
}

export async function normalizeSubscriptionPreferences(args: {
  keywords: string[];
  customJournals: string[];
}, dependencies: SubscriptionPreferenceNormalizerDependencies = {}): Promise<NormalizedSubscriptionPreferences> {
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
    const userPrompt = buildPrompt(args);
    const response = await callMiniMaxChat({
      label: "subscription_preference_normalization",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1200,
      temperature: 0.1,
    });
    let parsed: MiniMaxPreferencePayload;
    try {
      parsed = parseJsonObjectFromModelOutput<MiniMaxPreferencePayload>(
        response.content,
        "MiniMax preference response",
      );
    } catch (parseError) {
      logPreferenceParseDiagnostic({
        label: "subscription_preference_normalization",
        model: response.model,
        inputTokens: response.inputTokens ?? null,
        outputTokens: response.outputTokens ?? null,
        rawKeywords: args.keywords,
        rawJournals: args.customJournals,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        modelOutput: response.content,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw parseError;
    }
    const keywords = dedupeTerms(
      [...args.keywords, ...dedupeTerms(parsed.keywords, 30)],
      40,
    );
    const journals = dedupeTerms(
      [...args.customJournals, ...dedupeTerms(parsed.journals, 20)],
      30,
    );
    const pubmedAssist = await assistPubmedKeywords(keywords, {
      maxTerms: 8,
      maxMeshRecordsPerTerm: 2,
      maxEntryTermsPerRecord: 8,
    });
    const assistedKeywords = pubmedAssist.keywords.length ? pubmedAssist.keywords : keywords;
    const normalizedTerms = await maybeAddMedicalQueryPlanMetadata({
      normalizedTerms: {
        source: "minimax",
        raw_keywords: args.keywords,
        raw_journals: args.customJournals,
        keywords,
        assisted_keywords: assistedKeywords,
        journals,
        aliases: parsed.aliases ?? {},
        notes: parsed.notes ?? [],
        pubmed_assist: {
          corrected_terms: pubmedAssist.correctedTerms,
          mesh_records: pubmedAssist.meshRecords.map((record) => ({
            mesh_id: record.meshId,
            name: record.name,
            entry_terms: record.entryTerms,
          })),
          errors: pubmedAssist.errors,
        },
        usage: {
          input_tokens: response.inputTokens ?? null,
          output_tokens: response.outputTokens ?? null,
        },
      },
      rawKeywords: args.keywords,
      normalizedKeywords: assistedKeywords,
      dependencies,
    });

    return {
      keywords: expandSubscriptionTerms(assistedKeywords),
      journals: expandSubscriptionTerms(journals),
      normalizedTerms,
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
