import { callMiniMaxChat, getMiniMaxApiKey, type MiniMaxChatRequest } from "@/lib/minimax";
import {
  defaultMedicalQueryCache,
  type MedicalQueryCacheStore,
} from "@/lib/medical-query-cache";
import {
  buildDegradedMedicalQueryPlan,
  buildMedicalQueryPlanFromPayload,
  dedupeMedicalTerms,
  finalizeMedicalQueryPlan,
  mergePubmedAssistIntoGroup,
  parseMiniMaxMedicalQueryOutput,
  type MedicalQueryPlan,
  type PubmedAssistForMedicalQueryPlan,
} from "@/lib/medical-query-plan";
import { assistPubmedKeywords } from "@/lib/pubmed-query-assist";
import { normalizeMatchText } from "@/lib/subscription-matching";

type MiniMaxPlannerResponse = {
  content: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type MedicalQueryPlannerDependencies = {
  callMiniMax?: (request: MiniMaxChatRequest) => Promise<MiniMaxPlannerResponse>;
  assistPubmed?: (
    keywords: string[],
    options?: {
      maxTerms?: number;
      maxMeshRecordsPerTerm?: number;
      maxEntryTermsPerRecord?: number;
    },
  ) => Promise<PubmedAssistForMedicalQueryPlan>;
  cache?: MedicalQueryCacheStore | null;
};

const SYSTEM_PROMPT = `
You are a JSON-only biomedical query planner.
Return exactly one valid JSON object.
Do not include markdown, code fences, explanations, thinking, or text before/after JSON.
The first character of your answer must be { and the last character must be }.
`.trim();

const FEW_SHOT_EXAMPLES = `
Synthetic examples for output shape only. Do not copy example terms into unrelated inputs.

Example 1
Input: ["\u80ba\u764c"]
Output:
{
  "language": "zh",
  "topic": "lung cancer",
  "core_terms": [],
  "domain_terms": [],
  "disease_terms": ["lung cancer", "lung neoplasms", "pulmonary neoplasms"],
  "method_terms": [],
  "related_methods": [],
  "journal_terms": [],
  "subtopics": ["non-small cell lung cancer", "small cell lung cancer", "lung adenocarcinoma"],
  "frontier_terms": [],
  "broad_terms": ["cancer", "lung"],
  "suggested_intents": [
    {
      "name": "lung_cancer",
      "description": "Specific lung cancer literature.",
      "must_match_groups": [["lung cancer", "lung neoplasms", "pulmonary neoplasms"]],
      "optional_groups": [["non-small cell lung cancer", "small cell lung cancer", "lung adenocarcinoma"]]
    }
  ],
  "notes": ["Single disease topic."],
  "warnings": []
}

Example 2
Input: ["AI + \u773c\u79d1"]
Output:
{
  "language": "mixed",
  "topic": "AI in ophthalmology",
  "core_terms": [],
  "domain_terms": ["ophthalmology", "eye diseases", "retina", "fundus", "glaucoma", "optical coherence tomography"],
  "disease_terms": ["diabetic retinopathy", "macular degeneration"],
  "method_terms": ["artificial intelligence", "machine learning", "deep learning"],
  "related_methods": ["computer vision", "neural network"],
  "journal_terms": [],
  "subtopics": ["retinal imaging", "fundus photography", "OCT"],
  "frontier_terms": ["foundation model", "vision-language model", "multimodal model"],
  "broad_terms": ["AI", "eye"],
  "suggested_intents": [
    {
      "name": "broad_ai_ophthalmology",
      "description": "AI methods applied to ophthalmology and eye disease literature.",
      "must_match_groups": [
        ["artificial intelligence", "machine learning", "deep learning"],
        ["ophthalmology", "eye diseases", "retina", "fundus", "glaucoma", "OCT"]
      ],
      "optional_groups": [["foundation model", "vision-language model", "multimodal model"]]
    }
  ],
  "notes": ["Combined method and medical domain intent."],
  "warnings": []
}

Example 3
Input: ["\u8840\u7ba1"]
Output:
{
  "language": "zh",
  "topic": "vascular medicine",
  "core_terms": [],
  "domain_terms": ["vascular diseases", "vascular surgery", "endovascular surgery"],
  "disease_terms": ["blood vessel diseases"],
  "method_terms": [],
  "related_methods": [],
  "journal_terms": [],
  "subtopics": ["peripheral arterial disease", "aortic aneurysm", "carotid artery disease"],
  "frontier_terms": [],
  "broad_terms": ["vascular", "blood vessel"],
  "suggested_intents": [
    {
      "name": "vascular_domain",
      "description": "Broad vascular and endovascular medicine literature.",
      "must_match_groups": [["vascular diseases", "vascular surgery", "endovascular surgery"]],
      "optional_groups": [["peripheral arterial disease", "aortic aneurysm", "carotid artery disease"]]
    }
  ],
  "notes": ["The raw term is broad, so generic broad terms should stay weak."],
  "warnings": ["Avoid abstract-only incidental vascular mentions when matching."]
}
`.trim();

function cleanRawInput(input: string[]) {
  return input.map((item) => item.trim()).filter(Boolean);
}

function buildPlannerPrompt(input: string[]) {
  return `
Turn the user's medical literature interests into a structured PubMed-friendly query plan.

Rules:
- Understand Chinese, English, and mixed biomedical topics.
- Expand broad Chinese medical domains into useful English biomedical terms.
- Keep domain, disease, method, journal, frontier, and broad terms separated.
- Use broad_terms only for weak generic terms such as eye, vascular, cancer, AI.
- For combined intents such as AI + ophthalmology, create suggested_intents with one must_match group for the method and one for the medical domain.
- Return strict JSON only.

JSON shape:
{
  "language": "zh" | "en" | "mixed" | "unknown",
  "topic": "short English topic or null",
  "core_terms": ["central biomedical terms"],
  "domain_terms": ["specialty or body-system terms"],
  "disease_terms": ["specific disease terms"],
  "method_terms": ["AI, imaging, statistics, or technical method terms"],
  "related_methods": ["method aliases"],
  "journal_terms": ["journal names only when explicit"],
  "subtopics": ["specific subdomains"],
  "frontier_terms": ["modern frontier phrases"],
  "broad_terms": ["generic weak terms"],
  "suggested_intents": [
    {
      "name": "machine_readable_name",
      "description": "short description",
      "must_match_groups": [["terms in one required concept group"]],
      "optional_groups": [["optional concept terms"]]
    }
  ],
  "notes": ["short internal note"],
  "warnings": ["short warning when uncertain"]
}

${FEW_SHOT_EXAMPLES}

User input:
${JSON.stringify(input)}
`.trim();
}

async function addPubmedAssistToPlan(
  plan: MedicalQueryPlan,
  assistPubmed: NonNullable<MedicalQueryPlannerDependencies["assistPubmed"]>,
  cache: MedicalQueryCacheStore | null,
) {
  for (const group of plan.groups) {
    if (group.role === "broad") continue;
    const termsForAssist =
      isDegradedPlan(plan) && group.name === "raw_input"
        ? getDegradedRawPubmedAssistTerms(group.terms)
        : group.terms;
    if (!termsForAssist.length) continue;
    const options = {
      maxTerms: Math.min(8, termsForAssist.length),
      maxMeshRecordsPerTerm: 2,
      maxEntryTermsPerRecord: 8,
    };
    const assist = cache
      ? await getPubmedAssistWithAtomicCache({
          terms: termsForAssist,
          groupRole: group.role,
          language: plan.language,
          assistPubmed,
          cache,
          options,
        })
      : await assistPubmed(termsForAssist, options);
    const filteredAssist = filterPubmedAssistForGroup(termsForAssist, assist);
    mergePubmedAssistIntoGroup(group, filteredAssist);
    if (assist.errors.length) {
      plan.warnings.push(...assist.errors.map((error) => `pubmed_assist:${group.name}:${error}`));
    }
  }

  return finalizeMedicalQueryPlan(plan);
}

function mergePubmedAssistResults(
  results: PubmedAssistForMedicalQueryPlan[],
): PubmedAssistForMedicalQueryPlan {
  const meshRecords = [];
  const seenMeshRecords = new Set<string>();

  for (const result of results) {
    for (const record of result.meshRecords) {
      const key = record.meshId || record.name.toLowerCase();
      if (seenMeshRecords.has(key)) continue;
      seenMeshRecords.add(key);
      meshRecords.push(record);
    }
  }

  return {
    keywords: dedupeMedicalTerms(results.flatMap((result) => result.keywords)),
    correctedTerms: results.flatMap((result) => result.correctedTerms),
    meshRecords,
    errors: dedupeMedicalTerms(results.flatMap((result) => result.errors), 50),
  };
}

async function getPubmedAssistWithAtomicCache(args: {
  terms: string[];
  groupRole: MedicalQueryPlan["groups"][number]["role"];
  language: MedicalQueryPlan["language"];
  assistPubmed: NonNullable<MedicalQueryPlannerDependencies["assistPubmed"]>;
  cache: MedicalQueryCacheStore;
  options: {
    maxTerms: number;
    maxMeshRecordsPerTerm: number;
    maxEntryTermsPerRecord: number;
  };
}) {
  const results: PubmedAssistForMedicalQueryPlan[] = [];

  for (const term of args.terms) {
    const key = {
      term,
      role: args.groupRole,
      language: args.language,
    };
    const cached = await args.cache.getTermMapping(key);
    if (cached) {
      results.push(cached);
      continue;
    }

    const fresh = await args.assistPubmed([term], {
      ...args.options,
      maxTerms: 1,
    });
    await args.cache.setTermMapping(key, fresh);
    results.push(fresh);
  }

  return mergePubmedAssistResults(results);
}

function isDegradedPlan(plan: MedicalQueryPlan) {
  return plan.warnings.some((warning) => warning.startsWith("degraded:"));
}

function meshRelevanceKey(input: string) {
  return normalizeMatchText(input);
}

function sortedMeshTokenKey(input: string) {
  return meshRelevanceKey(input).split(/\s+/).filter(Boolean).sort().join(" ");
}

function meshRecordValues(record: PubmedAssistForMedicalQueryPlan["meshRecords"][number]) {
  return [record.name, ...record.entryTerms];
}

function meshValueMatchesTerm(value: string, term: string) {
  const valueKey = meshRelevanceKey(value);
  const termKey = meshRelevanceKey(term);
  if (!valueKey || !termKey) return false;
  if (valueKey === termKey) return true;
  if (termKey.length <= 3) return false;
  return sortedMeshTokenKey(value) === sortedMeshTokenKey(term);
}

function isRelevantMeshRecord(
  record: PubmedAssistForMedicalQueryPlan["meshRecords"][number],
  terms: string[],
) {
  return terms.some((term) =>
    meshRecordValues(record).some((value) => meshValueMatchesTerm(value, term)),
  );
}

function filterPubmedAssistForGroup(
  terms: string[],
  assist: PubmedAssistForMedicalQueryPlan,
): PubmedAssistForMedicalQueryPlan {
  const correctedTerms = assist.correctedTerms.filter((item) =>
    meshValueMatchesTerm(item.original, item.corrected),
  );
  const relevantMeshRecords = assist.meshRecords.filter((record) =>
    isRelevantMeshRecord(record, terms),
  );

  return {
    keywords: dedupeMedicalTerms([
      ...correctedTerms.map((item) => item.corrected),
      ...relevantMeshRecords.flatMap((record) => [record.name, ...record.entryTerms]),
    ]),
    correctedTerms,
    meshRecords: relevantMeshRecords,
    errors: assist.errors,
  };
}

function hasCjk(input: string) {
  return /[\u4e00-\u9fff]/.test(input);
}

function isSafeDegradedAssistTerm(input: string) {
  const value = input.trim();
  if (!value || hasCjk(value)) return false;
  if (!/[a-z]/i.test(value)) return false;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized || normalized === "ai" || normalized === "ml") return false;
  return /[a-z]{4,}/i.test(normalized);
}

function getDegradedRawPubmedAssistTerms(terms: string[]) {
  return dedupeMedicalTerms(
    terms.flatMap((term) =>
      term
        .normalize("NFKC")
        .split(/\s*(?:\+|,|;|，|、|\/|\band\b)\s*/i)
        .filter(isSafeDegradedAssistTerm),
    ),
    8,
  );
}

export async function planMedicalQuery(
  input: string[],
  dependencies: MedicalQueryPlannerDependencies = {},
): Promise<MedicalQueryPlan> {
  const rawInput = cleanRawInput(input);
  if (!rawInput.length) {
    return finalizeMedicalQueryPlan({
      rawInput: [],
      topic: null,
      language: "unknown",
      groups: [],
      intents: [],
      warnings: [],
    });
  }

  const miniMax = dependencies.callMiniMax ?? callMiniMaxChat;
  const pubmedAssist = dependencies.assistPubmed ?? assistPubmedKeywords;
  const cache =
    dependencies.cache === undefined
      ? dependencies.callMiniMax || dependencies.assistPubmed
        ? null
        : defaultMedicalQueryCache
      : dependencies.cache;

  const cachedPlan = cache ? await cache.getPlan(rawInput) : null;
  if (cachedPlan) return cachedPlan;

  try {
    if (!dependencies.callMiniMax && !getMiniMaxApiKey()) {
      throw new Error("Missing MINIMAX_API_KEY");
    }

    const response = await miniMax({
      label: "medical_query_planner",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildPlannerPrompt(rawInput),
      maxTokens: 5000,
      temperature: 0.1,
      reasoningSplit: true,
    });
    const payload = parseMiniMaxMedicalQueryOutput(response.content);
    const plan = buildMedicalQueryPlanFromPayload({
      rawInput,
      payload,
      warnings: [
        `model:${response.model}`,
        ...(response.inputTokens != null ? [`input_tokens:${response.inputTokens}`] : []),
        ...(response.outputTokens != null ? [`output_tokens:${response.outputTokens}`] : []),
      ],
    });

    const assistedPlan = await addPubmedAssistToPlan(plan, pubmedAssist, cache);
    if (cache && !isDegradedPlan(assistedPlan)) {
      await cache.setPlan(rawInput, assistedPlan);
    }
    return assistedPlan;
  } catch (error) {
    const plan = buildDegradedMedicalQueryPlan({
      rawInput,
      warning: `degraded:${error instanceof Error ? error.message : "unknown planner error"}`,
    });

    return addPubmedAssistToPlan(plan, pubmedAssist, cache);
  }
}
