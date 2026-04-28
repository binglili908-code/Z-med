import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

import type { MedicalQueryPlan } from "../src/lib/medical-query-plan";
import { normalizeSubscriptionPreferences } from "../src/lib/subscription-preference-normalizer";

const server = setupServer();
const ENV_KEYS = [
  "MINIMAX_API_KEY",
  "MINIMAX_API_BASE_URL",
  "MINIMAX_MODEL",
  "MINIMAX_GROUP_ID",
  "MINIMAX_REASONING_SPLIT",
  "PUBMED_QUERY_ASSIST_ENABLED",
  "MEDICAL_QUERY_PLANNER_ENABLED",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>;

before(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }

  process.env.MINIMAX_API_KEY = "test-minimax-key";
  process.env.MINIMAX_API_BASE_URL = "https://api.minimaxi.com";
  process.env.MINIMAX_MODEL = "MiniMax-M2.7";
  process.env.PUBMED_QUERY_ASSIST_ENABLED = "false";
});

afterEach(() => {
  server.resetHandlers();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

after(() => {
  server.close();
});

function mockPreferenceMiniMax(payload: Record<string, unknown>) {
  server.use(
    http.post("https://api.minimaxi.com/v1/chat/completions", () =>
      HttpResponse.json({
        choices: [
          {
            message: {
              content: JSON.stringify(payload),
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
        },
      }),
    ),
  );
}

const plannerResult: MedicalQueryPlan = {
  rawInput: ["lung cancer"],
  topic: "lung cancer",
  language: "en",
  groups: [
    {
      name: "disease_terms",
      role: "disease",
      terms: ["lung cancer", "lung neoplasms"],
      meshHeadings: ["Lung Neoplasms"],
      entryTerms: ["Pulmonary Cancer"],
      strength: "required",
    },
    {
      name: "method_terms",
      role: "method",
      terms: ["radiomics"],
      meshHeadings: [],
      entryTerms: [],
      strength: "strong",
    },
  ],
  intents: [
    {
      name: "lung_cancer",
      description: "Lung cancer literature.",
      mustMatchGroupNames: ["disease_terms"],
      optionalGroupNames: ["method_terms"],
      pubmedQuery: '("Lung Neoplasms"[Mesh] OR "lung cancer"[tiab])',
    },
  ],
  warnings: [],
};

test("does not call medical query planner while feature flag is disabled", async () => {
  process.env.MEDICAL_QUERY_PLANNER_ENABLED = "false";
  mockPreferenceMiniMax({
    keywords: ["lung cancer"],
    journals: [],
  });

  let plannerCalls = 0;
  const result = await normalizeSubscriptionPreferences(
    {
      keywords: ["肺癌"],
      customJournals: [],
    },
    {
      planMedicalQuery: async () => {
        plannerCalls += 1;
        throw new Error("planner should be disabled");
      },
    },
  );

  assert.equal(plannerCalls, 0);
  assert.equal(result.normalizedTerms.medical_query_planner, undefined);
  assert.ok(result.keywords.includes("lung cancer"));
});

test("stores medical query plan metadata without changing normalized keywords", async () => {
  process.env.MEDICAL_QUERY_PLANNER_ENABLED = "true";
  mockPreferenceMiniMax({
    keywords: ["lung cancer"],
    journals: [],
  });

  let plannerCalls = 0;
  const result = await normalizeSubscriptionPreferences(
    {
      keywords: ["肺癌"],
      customJournals: [],
    },
    {
      planMedicalQuery: async () => {
        plannerCalls += 1;
        return plannerResult;
      },
    },
  );

  assert.equal(plannerCalls, 1);
  assert.ok(result.keywords.includes("lung cancer"));
  assert.equal(result.keywords.includes("radiomics"), false);

  const plannerMetadata = result.normalizedTerms.medical_query_planner as {
    plan?: MedicalQueryPlan;
    error?: string | null;
  };
  assert.equal(plannerMetadata.error, null);
  assert.equal(plannerMetadata.plan?.topic, "lung cancer");
});
