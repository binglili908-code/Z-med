import assert from "node:assert/strict";
import test from "node:test";

import { NextResponse } from "next/server";

import {
  createMedicalQueryPlannerDebugRouteHandler,
  type MedicalQueryPlannerDebugRouteDependencies,
} from "../src/server/routes/medical-query-planner-debug-route";

const authorizedActor = {
  mode: "dev-bypass" as const,
  userId: null,
  email: null,
};

function makeDeps(
  overrides: Partial<MedicalQueryPlannerDebugRouteDependencies> = {},
): MedicalQueryPlannerDebugRouteDependencies {
  const deps: MedicalQueryPlannerDebugRouteDependencies = {
    authorizeDeveloperRequest: async () => ({
      authorized: true,
      actor: authorizedActor,
    }),
    normalizeSubscriptionPreferences: async (args, dependencies) => {
      assert.equal(dependencies?.medicalQueryPlannerEnabled, false);
      return {
        keywords: args.keywords.map((keyword) =>
          keyword === "肺癌" ? "lung cancer" : keyword,
        ),
        journals: args.customJournals,
        normalizedTerms: {
          source: "test_legacy_normalizer",
        },
        model: "test-normalizer",
        error: null,
      };
    },
    planMedicalQuery: async (input) => ({
      rawInput: input,
      topic: "lung cancer",
      language: "en",
      groups: [
        {
          name: "disease_terms",
          role: "disease",
          terms: ["lung cancer"],
          meshHeadings: ["Lung Neoplasms"],
          entryTerms: [],
          strength: "required",
        },
      ],
      intents: [
        {
          name: "default",
          description: "Default intent.",
          mustMatchGroupNames: ["disease_terms"],
          optionalGroupNames: [],
          pubmedQuery: '("Lung Neoplasms"[Mesh] OR "lung cancer"[tiab])',
        },
      ],
      warnings: [],
    }),
  };

  return {
    ...deps,
    ...overrides,
  };
}

test("medical query planner debug route requires developer authorization", async () => {
  const handler = createMedicalQueryPlannerDebugRouteHandler(
    makeDeps({
      authorizeDeveloperRequest: async () => ({
        authorized: false,
        response: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }),
      }),
    }),
  );

  const res = await handler(
    new Request("https://example.test/api/dev/medical-query-planner", {
      method: "POST",
      body: JSON.stringify({ input: "肺癌" }),
    }),
  );
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.equal(body.error, "Missing bearer token");
});

test("medical query planner debug route validates empty input", async () => {
  const handler = createMedicalQueryPlannerDebugRouteHandler(makeDeps());

  const res = await handler(
    new Request("https://example.test/api/dev/medical-query-planner", {
      method: "POST",
      body: JSON.stringify({ keywords: [] }),
    }),
  );
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.error, "Provide input, keywords, or customJournals");
});

test("medical query planner debug route returns legacy and planner outputs", async () => {
  let plannerInput: string[] | null = null;
  const handler = createMedicalQueryPlannerDebugRouteHandler(
    makeDeps({
      planMedicalQuery: async (input) => {
        plannerInput = input;
        return {
          rawInput: input,
          topic: "lung cancer",
          language: "en",
          groups: [],
          intents: [],
          warnings: [],
        };
      },
    }),
  );

  const res = await handler(
    new Request("https://example.test/api/dev/medical-query-planner", {
      method: "POST",
      body: JSON.stringify({
        keywords: ["肺癌"],
        customJournals: ["Nature"],
      }),
    }),
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.input.keywords, ["肺癌"]);
  assert.deepEqual(body.input.customJournals, ["Nature"]);
  assert.deepEqual(plannerInput, ["肺癌"]);
  assert.deepEqual(body.legacy_normalizer.keywords, ["lung cancer"]);
  assert.equal(body.dynamic_planner.plan.topic, "lung cancer");
  assert.equal(body.behavior.changesRecommendationBehavior, false);
});
