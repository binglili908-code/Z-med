import { z } from "zod";

import { normalizeMatchText } from "@/lib/subscription-matching";

export type MedicalQueryLanguage = "zh" | "en" | "mixed" | "unknown";
export type MedicalQueryGroupRole =
  | "domain"
  | "disease"
  | "method"
  | "journal"
  | "broad"
  | "frontier";
export type MedicalQueryGroupStrength = "required" | "strong" | "weak";

export type MedicalQueryPlanGroup = {
  name: string;
  role: MedicalQueryGroupRole;
  terms: string[];
  meshHeadings: string[];
  entryTerms: string[];
  strength: MedicalQueryGroupStrength;
};

export type MedicalQueryPlanIntent = {
  name: string;
  description: string;
  mustMatchGroupNames: string[];
  optionalGroupNames: string[];
  pubmedQuery: string;
};

export type MedicalQueryPlan = {
  rawInput: string[];
  topic: string | null;
  language: MedicalQueryLanguage;
  groups: MedicalQueryPlanGroup[];
  intents: MedicalQueryPlanIntent[];
  warnings: string[];
};

export type PubmedAssistForMedicalQueryPlan = {
  keywords: string[];
  correctedTerms: Array<{
    original: string;
    corrected: string;
  }>;
  meshRecords: Array<{
    meshId: string;
    name: string;
    entryTerms: string[];
    scopeNote?: string | null;
  }>;
  errors: string[];
};

const termSchema = z.string().trim().min(1).max(120);
const termArraySchema = z.array(termSchema).default([]);

const suggestedIntentSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional().default(""),
    must_match_groups: z.array(z.array(termSchema).min(1)).default([]),
    optional_groups: z.array(z.array(termSchema).min(1)).optional().default([]),
  })
  .passthrough();

export const miniMaxMedicalQueryPayloadSchema = z
  .object({
    language: z.enum(["zh", "en", "mixed", "unknown"]).optional().default("unknown"),
    topic: z.string().trim().min(1).max(160).nullable().optional().default(null),
    core_terms: termArraySchema,
    domain_terms: termArraySchema,
    disease_terms: termArraySchema,
    method_terms: termArraySchema,
    related_methods: termArraySchema,
    journal_terms: termArraySchema,
    subtopics: termArraySchema,
    frontier_terms: termArraySchema,
    broad_terms: termArraySchema,
    suggested_intents: z.array(suggestedIntentSchema).default([]),
    notes: z.array(z.string().trim().min(1).max(500)).default([]),
    warnings: z.array(z.string().trim().min(1).max(500)).default([]),
  })
  .passthrough();

export type MiniMaxMedicalQueryPayload = z.infer<typeof miniMaxMedicalQueryPayloadSchema>;

export class MedicalQueryPlanParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MedicalQueryPlanParseError";
  }
}

function termKey(value: string) {
  return normalizeMatchText(value).replace(/\s+/g, "");
}

export function dedupeMedicalTerms(values: string[], maxItems = 100) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    const key = termKey(trimmed);
    if (!trimmed || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }

  return out;
}

export function parseMiniMaxMedicalQueryOutput(
  text: string,
  label = "MiniMax medical query planner response",
): MiniMaxMedicalQueryPayload {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new MedicalQueryPlanParseError(`${label} must be strict JSON with no surrounding text`);
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (error) {
    throw new MedicalQueryPlanParseError(
      `${label} was not valid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
    );
  }

  const parsed = miniMaxMedicalQueryPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new MedicalQueryPlanParseError(`${label} had an invalid shape: ${issues}`);
  }

  return parsed.data;
}

function slugifyGroupName(input: string) {
  const normalized = normalizeMatchText(input).replace(/\s+/g, "_");
  return normalized || "group";
}

function escapePubmedQuotedTerm(input: string) {
  return input.replace(/"/g, '\\"');
}

function buildGroupPubmedClause(group: MedicalQueryPlanGroup) {
  const meshClauses = dedupeMedicalTerms(group.meshHeadings).map(
    (term) => `"${escapePubmedQuotedTerm(term)}"[Mesh]`,
  );
  const termClauses = dedupeMedicalTerms([...group.terms, ...group.entryTerms]).map(
    (term) => `"${escapePubmedQuotedTerm(term)}"[tiab]`,
  );
  const clauses = dedupeMedicalTerms([...meshClauses, ...termClauses], 80);
  return clauses.length ? `(${clauses.join(" OR ")})` : "";
}

export function buildPubmedQueryForGroupNames(
  groups: MedicalQueryPlanGroup[],
  groupNames: string[],
) {
  const selected = groupNames
    .map((name) => groups.find((group) => group.name === name))
    .filter((group): group is MedicalQueryPlanGroup => Boolean(group));

  const clauses = selected.map(buildGroupPubmedClause).filter(Boolean);
  return clauses.join(" AND ");
}

function addGroup(
  groups: MedicalQueryPlanGroup[],
  args: {
    name: string;
    role: MedicalQueryGroupRole;
    terms: string[];
    strength: MedicalQueryGroupStrength;
  },
) {
  const terms = dedupeMedicalTerms(args.terms);
  if (!terms.length) return;

  const existing = groups.find((group) => group.name === args.name);
  if (existing) {
    existing.terms = dedupeMedicalTerms([...existing.terms, ...terms]);
    if (existing.strength !== "required") existing.strength = args.strength;
    return;
  }

  groups.push({
    name: args.name,
    role: args.role,
    terms,
    meshHeadings: [],
    entryTerms: [],
    strength: args.strength,
  });
}

function countOverlap(left: string[], right: string[]) {
  const rightKeys = new Set(right.map(termKey).filter(Boolean));
  return left.reduce((count, value) => count + (rightKeys.has(termKey(value)) ? 1 : 0), 0);
}

function findBestGroupName(groups: MedicalQueryPlanGroup[], terms: string[]) {
  let best: { name: string; score: number } | null = null;
  for (const group of groups) {
    const score = countOverlap(terms, [...group.terms, ...group.meshHeadings, ...group.entryTerms]);
    if (score > (best?.score ?? 0)) best = { name: group.name, score };
  }
  return best?.score ? best.name : null;
}

function ensureIntentGroup(
  groups: MedicalQueryPlanGroup[],
  intentName: string,
  index: number,
  terms: string[],
  strength: MedicalQueryGroupStrength,
) {
  const existingName = findBestGroupName(groups, terms);
  if (existingName) return existingName;

  const name = `${slugifyGroupName(intentName)}_${index + 1}`;
  addGroup(groups, {
    name,
    role: "frontier",
    terms,
    strength,
  });
  return name;
}

export function buildMedicalQueryPlanFromPayload(args: {
  rawInput: string[];
  payload: MiniMaxMedicalQueryPayload;
  warnings?: string[];
}): MedicalQueryPlan {
  const groups: MedicalQueryPlanGroup[] = [];

  addGroup(groups, {
    name: "core_terms",
    role: "domain",
    terms: args.payload.core_terms,
    strength: "strong",
  });
  addGroup(groups, {
    name: "domain_terms",
    role: "domain",
    terms: args.payload.domain_terms,
    strength: "strong",
  });
  addGroup(groups, {
    name: "disease_terms",
    role: "disease",
    terms: args.payload.disease_terms,
    strength: "strong",
  });
  addGroup(groups, {
    name: "method_terms",
    role: "method",
    terms: [...args.payload.method_terms, ...args.payload.related_methods],
    strength: "strong",
  });
  addGroup(groups, {
    name: "journal_terms",
    role: "journal",
    terms: args.payload.journal_terms,
    strength: "strong",
  });
  addGroup(groups, {
    name: "subtopics",
    role: "domain",
    terms: args.payload.subtopics,
    strength: "strong",
  });
  addGroup(groups, {
    name: "frontier_terms",
    role: "frontier",
    terms: args.payload.frontier_terms,
    strength: "strong",
  });
  addGroup(groups, {
    name: "broad_terms",
    role: "broad",
    terms: args.payload.broad_terms,
    strength: "weak",
  });

  if (!groups.length) {
    addGroup(groups, {
      name: "raw_input",
      role: "broad",
      terms: args.rawInput,
      strength: "weak",
    });
  }

  const intents: MedicalQueryPlanIntent[] = args.payload.suggested_intents.map((intent) => {
    const mustMatchGroupNames = dedupeMedicalTerms(
      intent.must_match_groups.map((terms, index) =>
        ensureIntentGroup(groups, intent.name, index, terms, "required"),
      ),
    );
    const optionalGroupNames = dedupeMedicalTerms(
      intent.optional_groups.map((terms, index) =>
        ensureIntentGroup(groups, `${intent.name}_optional`, index, terms, "strong"),
      ),
    );

    for (const groupName of mustMatchGroupNames) {
      const group = groups.find((item) => item.name === groupName);
      if (group) group.strength = "required";
    }

    return {
      name: intent.name,
      description: intent.description,
      mustMatchGroupNames,
      optionalGroupNames,
      pubmedQuery: "",
    };
  });

  if (!intents.length) {
    const mustMatchGroupNames = groups
      .filter((group) => group.role !== "broad" && group.terms.length)
      .map((group) => group.name);
    const fallbackMustMatchGroupNames = mustMatchGroupNames.length
      ? mustMatchGroupNames
      : groups.map((group) => group.name);

    for (const groupName of fallbackMustMatchGroupNames) {
      const group = groups.find((item) => item.name === groupName);
      if (group && group.role !== "broad") group.strength = "required";
    }

    intents.push({
      name: "default",
      description: "Default structured medical query intent.",
      mustMatchGroupNames: fallbackMustMatchGroupNames,
      optionalGroupNames: groups
        .filter((group) => !fallbackMustMatchGroupNames.includes(group.name))
        .map((group) => group.name),
      pubmedQuery: "",
    });
  }

  return finalizeMedicalQueryPlan({
    rawInput: dedupeMedicalTerms(args.rawInput),
    topic: args.payload.topic,
    language: args.payload.language,
    groups,
    intents,
    warnings: dedupeMedicalTerms([
      ...(args.warnings ?? []),
      ...args.payload.warnings,
      ...args.payload.notes.map((note) => `note:${note}`),
    ]),
  });
}

export function mergePubmedAssistIntoGroup(
  group: MedicalQueryPlanGroup,
  assist: PubmedAssistForMedicalQueryPlan,
) {
  group.terms = dedupeMedicalTerms([
    ...group.terms,
    ...assist.correctedTerms.map((term) => term.corrected),
    ...assist.keywords,
  ]);
  group.meshHeadings = dedupeMedicalTerms([
    ...group.meshHeadings,
    ...assist.meshRecords.map((record) => record.name),
  ]);
  group.entryTerms = dedupeMedicalTerms([
    ...group.entryTerms,
    ...assist.meshRecords.flatMap((record) => record.entryTerms),
  ]);
}

export function finalizeMedicalQueryPlan(plan: MedicalQueryPlan): MedicalQueryPlan {
  const groups = plan.groups.map((group) => ({
    ...group,
    terms: dedupeMedicalTerms(group.terms),
    meshHeadings: dedupeMedicalTerms(group.meshHeadings),
    entryTerms: dedupeMedicalTerms(group.entryTerms),
  }));

  const intents = plan.intents.map((intent) => ({
    ...intent,
    mustMatchGroupNames: dedupeMedicalTerms(intent.mustMatchGroupNames),
    optionalGroupNames: dedupeMedicalTerms(intent.optionalGroupNames),
    pubmedQuery: buildPubmedQueryForGroupNames(groups, intent.mustMatchGroupNames),
  }));

  return {
    ...plan,
    rawInput: dedupeMedicalTerms(plan.rawInput),
    groups,
    intents,
    warnings: dedupeMedicalTerms(plan.warnings, 50),
  };
}

export function buildDegradedMedicalQueryPlan(args: {
  rawInput: string[];
  warning: string;
}): MedicalQueryPlan {
  return finalizeMedicalQueryPlan({
    rawInput: args.rawInput,
    topic: null,
    language: "unknown",
    groups: [
      {
        name: "raw_input",
        role: "broad",
        terms: dedupeMedicalTerms(args.rawInput),
        meshHeadings: [],
        entryTerms: [],
        strength: "weak",
      },
    ],
    intents: [
      {
        name: "degraded",
        description: "Degraded query plan built from raw input only.",
        mustMatchGroupNames: ["raw_input"],
        optionalGroupNames: [],
        pubmedQuery: "",
      },
    ],
    warnings: [args.warning],
  });
}
