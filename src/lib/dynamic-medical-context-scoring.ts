import type { MedicalQueryPlan } from "@/lib/medical-query-plan";
import type { PubmedSummary } from "@/lib/pubmed-sync-client";
import { AI_TERMS, dedupeTerms, findTermMatches } from "@/lib/pubmed-sync-rules";
import { buildSearchText, normalizeMatchText } from "@/lib/subscription-matching";

export type RpcAiMedicalScore = {
  isAiMed: boolean;
  score: number;
};

export type DynamicMedicalContextScore = {
  eligible: boolean;
  score: number;
  reasons: string[];
  aiTerms: string[];
  contextTerms: string[];
  meshTerms: string[];
  plannerContextVerified: boolean;
};

const AI_SIGNAL_TERMS = [
  ...AI_TERMS,
  "ai-based",
  "ai-driven",
  "ai-enabled",
  "ai-powered",
  "ai-assisted",
  "ai-derived",
  "ai-enhanced",
  "ai-guided",
  "ai-augmented",
  "algorithm",
  "automated",
  "classification model",
  "prediction model",
  "predictive model",
  "random forest",
  "xgboost",
  "support vector",
  "radiomics",
  "image segmentation",
  "object detection",
  "vision transformer",
  "u-net",
  "unet",
  "resnet",
  "transformer-based",
];

const GENERIC_CONTEXT_TERMS = new Set([
  "ai",
  "artificial intelligence",
  "machine learning",
  "deep learning",
  "medicine",
  "medical",
  "clinical",
  "patient",
  "patients",
  "disease",
  "diseases",
  "disorder",
  "disorders",
  "study",
  "studies",
  "method",
  "methods",
  "treatment",
  "therapy",
]);

function cleanTerm(input: string) {
  return input
    .replace(/\[(?:mesh|mh|tiab|title\/abstract)\]/gi, " ")
    .replace(/["()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulContextTerm(input: string) {
  const normalized = normalizeMatchText(input);
  if (!normalized || GENERIC_CONTEXT_TERMS.has(normalized)) return false;
  if (/[\u4e00-\u9fff]/.test(normalized)) return normalized.length >= 2;
  return normalized.replace(/\s+/g, "").length >= 4;
}

function termsFromPlanGroups(plan: MedicalQueryPlan, roles: Set<string>) {
  return dedupeTerms(
    plan.groups
      .filter((group) => roles.has(group.role))
      .flatMap((group) => [
        ...group.terms,
        ...group.meshHeadings,
        ...group.entryTerms,
      ])
      .map((term) => normalizeMatchText(cleanTerm(term)))
      .filter(isUsefulContextTerm),
  );
}

function hasPlannerMedicalContext(plan: MedicalQueryPlan) {
  if (plan.warnings.some((warning) => warning.startsWith("degraded:"))) return false;
  return plan.intents.some((intent) =>
    intent.mustMatchGroupNames.some((name) => {
      const group = plan.groups.find((item) => item.name === name);
      return Boolean(group && group.role !== "method" && group.role !== "journal" && group.role !== "broad");
    }),
  );
}

function paperText(paper: PubmedSummary) {
  return buildSearchText([
    paper.title,
    paper.abstract ?? "",
    paper.journal ?? "",
    ...(paper.mesh_terms ?? []),
    ...(paper.keywords ?? []),
  ]);
}

function paperMeshText(paper: PubmedSummary) {
  return buildSearchText([...(paper.mesh_terms ?? []), ...(paper.keywords ?? [])]);
}

function computeContextScore(args: {
  rpcScore: RpcAiMedicalScore;
  aiTerms: string[];
  contextTerms: string[];
  meshTerms: string[];
  plannerContextVerified: boolean;
}) {
  let score = args.rpcScore.score;
  if (args.aiTerms.length) score = Math.max(score, 0.28 + Math.min(args.aiTerms.length, 3) * 0.04);
  if (args.contextTerms.length) score += Math.min(args.contextTerms.length, 4) * 0.03;
  if (args.meshTerms.length) score += Math.min(args.meshTerms.length, 3) * 0.04;
  if (args.plannerContextVerified) score = Math.max(score, 0.36);
  return Number(Math.min(1, score).toFixed(4));
}

export function scoreDynamicMedicalContext(args: {
  paper: PubmedSummary;
  plan: MedicalQueryPlan;
  rpcScore: RpcAiMedicalScore;
  plannerQueryVerified?: boolean;
}): DynamicMedicalContextScore {
  const methodTerms = termsFromPlanGroups(args.plan, new Set(["method"]));
  const contextTerms = termsFromPlanGroups(
    args.plan,
    new Set(["domain", "disease", "frontier"]),
  );
  const text = paperText(args.paper);
  const meshText = paperMeshText(args.paper);
  const aiTerms = findTermMatches(
    text,
    dedupeTerms([...AI_SIGNAL_TERMS, ...methodTerms].map(normalizeMatchText)),
  );
  const matchedContextTerms = findTermMatches(text, contextTerms);
  const matchedMeshTerms = findTermMatches(meshText, contextTerms);
  const plannerContextVerified =
    Boolean(args.plannerQueryVerified) && hasPlannerMedicalContext(args.plan);
  const eligibleByDynamicContext =
    aiTerms.length > 0 && (matchedContextTerms.length > 0 || plannerContextVerified);
  const eligible = args.rpcScore.isAiMed || eligibleByDynamicContext;
  const score = computeContextScore({
    rpcScore: args.rpcScore,
    aiTerms,
    contextTerms: matchedContextTerms,
    meshTerms: matchedMeshTerms,
    plannerContextVerified,
  });
  const reasons = [
    ...(args.rpcScore.isAiMed ? ["rpc_ai_med"] : []),
    ...(aiTerms.length ? ["ai_signal_matched"] : []),
    ...(matchedContextTerms.length ? ["planner_context_matched"] : []),
    ...(matchedMeshTerms.length ? ["mesh_context_matched"] : []),
    ...(plannerContextVerified ? ["planner_query_context_verified"] : []),
    ...(!eligible ? ["dynamic_context_not_eligible"] : []),
  ];

  return {
    eligible,
    score,
    reasons,
    aiTerms,
    contextTerms: matchedContextTerms,
    meshTerms: matchedMeshTerms,
    plannerContextVerified,
  };
}
