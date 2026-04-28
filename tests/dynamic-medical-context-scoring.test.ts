import assert from "node:assert/strict";
import test from "node:test";

import { scoreDynamicMedicalContext } from "../src/lib/dynamic-medical-context-scoring";
import type { MedicalQueryPlan } from "../src/lib/medical-query-plan";
import type { PubmedSummary } from "../src/lib/pubmed-sync-client";

function paper(overrides: Partial<PubmedSummary> & Pick<PubmedSummary, "title">): PubmedSummary {
  return {
    abstract: null,
    authors: [],
    doi: undefined,
    journal: "PubMed",
    keywords: [],
    mesh_terms: [],
    pmid: "1",
    publication_date: "2026-04-28",
    pubmed_url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    source_payload: {},
    ...overrides,
  };
}

function plan(args: {
  topic: string;
  domainTerms: string[];
  meshHeadings?: string[];
  methodTerms?: string[];
  warnings?: string[];
}): MedicalQueryPlan {
  const groups: MedicalQueryPlan["groups"] = [
    {
      name: "domain_terms",
      role: "domain",
      terms: args.domainTerms,
      meshHeadings: args.meshHeadings ?? [],
      entryTerms: [],
      strength: "required",
    },
  ];

  if (args.methodTerms?.length) {
    groups.push({
      name: "method_terms",
      role: "method",
      terms: args.methodTerms,
      meshHeadings: [],
      entryTerms: [],
      strength: "required",
    });
  }

  return {
    rawInput: [args.topic],
    topic: args.topic,
    language: "en",
    groups,
    intents: [
      {
        name: "default",
        description: "",
        mustMatchGroupNames: args.methodTerms?.length
          ? ["method_terms", "domain_terms"]
          : ["domain_terms"],
        optionalGroupNames: [],
        pubmedQuery: "",
      },
    ],
    warnings: args.warnings ?? [],
  };
}

const RPC_REJECT = { isAiMed: false, score: 0.33 };

test("planner-verified ophthalmology context rescues AI eye papers below the static threshold", () => {
  const result = scoreDynamicMedicalContext({
    paper: paper({
      title: "Deep learning for diabetic retinopathy detection",
    }),
    plan: plan({
      topic: "ophthalmology",
      domainTerms: ["ophthalmology", "eye diseases", "retina", "glaucoma"],
      meshHeadings: ["Ophthalmology", "Eye Diseases"],
    }),
    rpcScore: RPC_REJECT,
    plannerQueryVerified: true,
  });

  assert.equal(result.eligible, true);
  assert.ok(result.score >= 0.36);
  assert.ok(result.reasons.includes("planner_query_context_verified"));
});

test("planner context still requires an AI signal", () => {
  const result = scoreDynamicMedicalContext({
    paper: paper({
      title: "Clinical characteristics of glaucoma screening in adults",
    }),
    plan: plan({
      topic: "ophthalmology",
      domainTerms: ["ophthalmology", "eye diseases", "glaucoma"],
    }),
    rpcScore: { isAiMed: false, score: 0.2 },
    plannerQueryVerified: true,
  });

  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("dynamic_context_not_eligible"));
});

test("cardiovascular planner terms provide dynamic medical context", () => {
  const result = scoreDynamicMedicalContext({
    paper: paper({
      title: "Deep learning model for atrial fibrillation detection from electrocardiograms",
    }),
    plan: plan({
      topic: "cardiovascular disease",
      domainTerms: ["cardiovascular disease", "atrial fibrillation", "electrocardiogram"],
      methodTerms: ["deep learning"],
    }),
    rpcScore: RPC_REJECT,
    plannerQueryVerified: true,
  });

  assert.equal(result.eligible, true);
  assert.ok(result.contextTerms.includes("atrial fibrillation"));
});

test("lung cancer planner terms rescue oncology AI papers without hand-built global terms", () => {
  const result = scoreDynamicMedicalContext({
    paper: paper({
      title: "Graph neural network for EGFR-mutant lung adenocarcinoma prognosis",
    }),
    plan: plan({
      topic: "lung cancer",
      domainTerms: ["lung cancer", "lung adenocarcinoma", "EGFR"],
      methodTerms: ["graph neural network"],
    }),
    rpcScore: RPC_REJECT,
    plannerQueryVerified: true,
  });

  assert.equal(result.eligible, true);
  assert.ok(result.contextTerms.includes("lung adenocarcinoma"));
});

test("vascular planner terms support specialty-specific AI papers", () => {
  const result = scoreDynamicMedicalContext({
    paper: paper({
      title: "Machine learning for endovascular aneurysm repair outcome prediction",
    }),
    plan: plan({
      topic: "vascular disease",
      domainTerms: ["vascular disease", "endovascular aneurysm repair", "aneurysm"],
      methodTerms: ["machine learning"],
    }),
    rpcScore: RPC_REJECT,
    plannerQueryVerified: true,
  });

  assert.equal(result.eligible, true);
  assert.ok(result.contextTerms.includes("endovascular aneurysm repair"));
});

test("degraded plans do not provide verified dynamic context", () => {
  const result = scoreDynamicMedicalContext({
    paper: paper({
      title: "Deep learning for general medical image classification",
    }),
    plan: plan({
      topic: "raw input",
      domainTerms: [],
      warnings: ["degraded:minimax_unavailable"],
    }),
    rpcScore: RPC_REJECT,
    plannerQueryVerified: true,
  });

  assert.equal(result.eligible, false);
});
