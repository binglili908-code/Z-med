import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMiniMaxMedicalQueryOutput,
  type MedicalQueryPlan,
  type PubmedAssistForMedicalQueryPlan,
} from "../src/lib/medical-query-plan";
import { createInMemoryMedicalQueryCache } from "../src/lib/medical-query-cache";
import { planMedicalQuery } from "../src/lib/medical-query-planner";

function payload(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

function allTerms(plan: MedicalQueryPlan) {
  return plan.groups.flatMap((group) => [
    ...group.terms,
    ...group.meshHeadings,
    ...group.entryTerms,
  ]);
}

function normalized(values: string[]) {
  return values.map((value) => value.toLowerCase());
}

function includesTerm(plan: MedicalQueryPlan, term: string) {
  assert.ok(
    normalized(allTerms(plan)).includes(term.toLowerCase()),
    `Expected plan to include ${term}`,
  );
}

const meshFixtures: Record<string, PubmedAssistForMedicalQueryPlan> = {
  ophthalmology: {
    keywords: ["ophthalmology", "eye diseases", "retina", "fundus", "glaucoma", "OCT"],
    correctedTerms: [],
    meshRecords: [
      {
        meshId: "68010017",
        name: "Ophthalmology",
        entryTerms: ["Eye Care"],
      },
      {
        meshId: "68004635",
        name: "Eye Diseases",
        entryTerms: ["Ocular Disease"],
      },
    ],
    errors: [],
  },
  ai: {
    keywords: [
      "artificial intelligence",
      "machine learning",
      "deep learning",
      "foundation model",
    ],
    correctedTerms: [],
    meshRecords: [
      {
        meshId: "68059455",
        name: "Artificial Intelligence",
        entryTerms: ["Machine Intelligence"],
      },
      {
        meshId: "68053562",
        name: "Machine Learning",
        entryTerms: ["Deep Learning"],
      },
    ],
    errors: [],
  },
  cardiovascular: {
    keywords: ["cardiovascular diseases", "heart diseases", "cardiology"],
    correctedTerms: [],
    meshRecords: [
      {
        meshId: "68002215",
        name: "Cardiovascular Diseases",
        entryTerms: ["Heart Diseases"],
      },
    ],
    errors: [],
  },
  lung: {
    keywords: ["lung cancer", "lung neoplasms", "pulmonary neoplasms", "Lung Neoplasms"],
    correctedTerms: [{ original: "lung cancer", corrected: "lung neoplasms" }],
    meshRecords: [
      {
        meshId: "68008565",
        name: "Lung Neoplasms",
        entryTerms: ["Lung Cancer", "Pulmonary Cancer"],
      },
    ],
    errors: [],
  },
  vascular: {
    keywords: ["vascular diseases", "endovascular surgery", "vascular surgery"],
    correctedTerms: [],
    meshRecords: [
      {
        meshId: "68014652",
        name: "Vascular Diseases",
        entryTerms: ["Blood Vessel Diseases"],
      },
    ],
    errors: [],
  },
};

async function fakePubmedAssist(terms: string[]) {
  const text = terms.join(" ").toLowerCase();
  if (/artificial intelligence|machine learning|deep learning|foundation model/.test(text)) {
    return meshFixtures.ai;
  }
  if (/ophthalmology|eye|retina|fundus|glaucoma|oct/.test(text)) {
    return meshFixtures.ophthalmology;
  }
  if (/cardiovascular|heart|cardiology/.test(text)) {
    return meshFixtures.cardiovascular;
  }
  if (/lung|pulmonary/.test(text)) {
    return meshFixtures.lung;
  }
  if (/vascular|endovascular|blood vessel/.test(text)) {
    return meshFixtures.vascular;
  }
  return {
    keywords: terms,
    correctedTerms: [],
    meshRecords: [],
    errors: [],
  };
}

test("parses strict MiniMax medical query JSON and rejects surrounding text", () => {
  const parsed = parseMiniMaxMedicalQueryOutput(
    payload({
      language: "zh",
      topic: "ophthalmology",
      core_terms: ["ophthalmology"],
    }),
  );

  assert.equal(parsed.topic, "ophthalmology");
  assert.deepEqual(parsed.core_terms, ["ophthalmology"]);
  assert.throws(
    () => parseMiniMaxMedicalQueryOutput("Here is JSON: {\"topic\":\"ophthalmology\"}"),
    /must be strict JSON/,
  );
});

test("sends compact few-shot examples to MiniMax without changing plan behavior", async () => {
  let capturedPrompt = "";
  const plan = await planMedicalQuery(["lung cancer"], {
    callMiniMax: async (request) => {
      capturedPrompt = request.userPrompt;
      return {
        model: "test-minimax",
        content: payload({
          language: "en",
          topic: "lung cancer",
          disease_terms: ["lung cancer", "lung neoplasms"],
          broad_terms: ["cancer"],
        }),
      };
    },
    assistPubmed: fakePubmedAssist,
  });

  assert.equal(plan.topic, "lung cancer");
  assert.match(capturedPrompt, /Synthetic examples for output shape only/);
  assert.match(capturedPrompt, /"topic": "lung cancer"/);
  assert.match(capturedPrompt, /broad_ai_ophthalmology/);
  assert.match(capturedPrompt, /vascular_domain/);
});

test("reuses complete in-memory query plan cache for identical input", async () => {
  const cache = createInMemoryMedicalQueryCache();
  let miniMaxCalls = 0;
  let pubmedCalls = 0;

  const first = await planMedicalQuery(["lung cancer"], {
    cache,
    callMiniMax: async () => {
      miniMaxCalls += 1;
      return {
        model: "test-minimax",
        content: payload({
          language: "en",
          topic: "lung cancer",
          disease_terms: ["lung cancer"],
        }),
      };
    },
    assistPubmed: async (terms) => {
      pubmedCalls += 1;
      return {
        keywords: terms,
        correctedTerms: [],
        meshRecords: [],
        errors: [],
      };
    },
  });

  const second = await planMedicalQuery(["lung cancer"], {
    cache,
    callMiniMax: async () => {
      miniMaxCalls += 1;
      throw new Error("complete plan cache should skip MiniMax");
    },
    assistPubmed: async (terms) => {
      pubmedCalls += 1;
      return {
        keywords: terms,
        correctedTerms: [],
        meshRecords: [],
        errors: [],
      };
    },
  });

  assert.equal(first.topic, "lung cancer");
  assert.equal(second.topic, "lung cancer");
  assert.equal(miniMaxCalls, 1);
  assert.equal(pubmedCalls, 1);
});

test("reuses atomic term cache across different composite inputs", async () => {
  const cache = createInMemoryMedicalQueryCache();
  const assistedTerms: string[] = [];

  const assistPubmed = async (terms: string[]) => {
    assistedTerms.push(...terms);
    return {
      keywords: terms,
      correctedTerms: [],
      meshRecords: [],
      errors: [],
    };
  };

  await planMedicalQuery(["lung cancer"], {
    cache,
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "en",
        topic: "lung cancer",
        disease_terms: ["lung cancer"],
      }),
    }),
    assistPubmed,
  });

  await planMedicalQuery(["lung cancer + radiomics"], {
    cache,
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "en",
        topic: "lung cancer radiomics",
        disease_terms: ["lung cancer"],
        method_terms: ["radiomics"],
      }),
    }),
    assistPubmed,
  });

  assert.deepEqual(assistedTerms, ["lung cancer", "radiomics"]);
});

test("plans ophthalmology query with PubMed-grounded terms", async () => {
  const plan = await planMedicalQuery(["眼科"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "zh",
        topic: "ophthalmology",
        core_terms: ["ophthalmology", "eye diseases"],
        subtopics: ["retina", "fundus", "glaucoma", "diabetic retinopathy", "OCT"],
        broad_terms: ["eye"],
      }),
    }),
    assistPubmed: fakePubmedAssist,
  });

  assert.equal(plan.topic, "ophthalmology");
  includesTerm(plan, "Ophthalmology");
  includesTerm(plan, "Eye Diseases");
  includesTerm(plan, "glaucoma");
  assert.match(plan.intents[0].pubmedQuery, /"Ophthalmology"\[Mesh\]/);
});

test("plans AI plus ophthalmology with two required concept groups", async () => {
  const plan = await planMedicalQuery(["AI + 眼科"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "mixed",
        topic: "AI in ophthalmology",
        domain_terms: ["ophthalmology", "eye diseases", "retina", "fundus", "glaucoma", "OCT"],
        method_terms: ["artificial intelligence", "machine learning", "deep learning"],
        frontier_terms: ["foundation model", "vision-language model"],
        broad_terms: ["eye", "AI"],
        suggested_intents: [
          {
            name: "broad_ai_ophthalmology",
            must_match_groups: [
              ["artificial intelligence", "machine learning", "deep learning"],
              ["ophthalmology", "eye diseases", "retina", "fundus", "glaucoma", "OCT"],
            ],
          },
        ],
      }),
    }),
    assistPubmed: fakePubmedAssist,
  });

  const intent = plan.intents.find((item) => item.name === "broad_ai_ophthalmology");
  assert.ok(intent);
  assert.deepEqual(intent.mustMatchGroupNames.sort(), ["domain_terms", "method_terms"].sort());
  assert.equal(plan.groups.find((group) => group.name === "method_terms")?.strength, "required");
  assert.equal(plan.groups.find((group) => group.name === "domain_terms")?.strength, "required");
  assert.match(intent.pubmedQuery, /AND/);
  includesTerm(plan, "Artificial Intelligence");
  includesTerm(plan, "Ophthalmology");
});

test("plans cardiovascular query as a required medical domain", async () => {
  const plan = await planMedicalQuery(["心血管"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "zh",
        topic: "cardiovascular medicine",
        domain_terms: ["cardiovascular diseases", "cardiology"],
        disease_terms: ["heart diseases"],
        broad_terms: ["heart"],
      }),
    }),
    assistPubmed: fakePubmedAssist,
  });

  includesTerm(plan, "Cardiovascular Diseases");
  assert.equal(plan.groups.find((group) => group.name === "domain_terms")?.strength, "required");
  assert.equal(plan.groups.find((group) => group.name === "broad_terms")?.strength, "weak");
});

test("plans lung cancer query and deduplicates PubMed assist terms", async () => {
  const plan = await planMedicalQuery(["肺癌"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "zh",
        topic: "lung cancer",
        disease_terms: ["lung cancer", "Lung Neoplasms"],
        broad_terms: ["cancer"],
      }),
    }),
    assistPubmed: fakePubmedAssist,
  });

  const diseaseGroup = plan.groups.find((group) => group.name === "disease_terms");
  assert.ok(diseaseGroup);
  includesTerm(plan, "Lung Neoplasms");
  assert.equal(
    diseaseGroup.terms.filter((term) => term.toLowerCase() === "lung neoplasms").length,
    1,
  );
  assert.match(plan.intents[0].pubmedQuery, /"Lung Neoplasms"\[Mesh\]/);
});

test("plans vascular query without making broad terms strong", async () => {
  const plan = await planMedicalQuery(["血管"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "zh",
        topic: "vascular medicine",
        domain_terms: ["vascular diseases", "vascular surgery", "endovascular surgery"],
        broad_terms: ["vascular", "blood vessel"],
      }),
    }),
    assistPubmed: fakePubmedAssist,
  });

  includesTerm(plan, "Vascular Diseases");
  assert.equal(plan.groups.find((group) => group.name === "broad_terms")?.strength, "weak");
  assert.deepEqual(plan.intents[0].mustMatchGroupNames, ["domain_terms"]);
});

test("returns a degraded plan when MiniMax output is not strict JSON", async () => {
  const plan = await planMedicalQuery(["眼科"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: "I think the answer is ophthalmology.",
    }),
    assistPubmed: async (terms) => ({
      keywords: terms,
      correctedTerms: [],
      meshRecords: [],
      errors: [],
    }),
  });

  assert.equal(plan.topic, null);
  assert.equal(plan.language, "unknown");
  assert.equal(plan.groups[0].name, "raw_input");
  assert.ok(plan.warnings.some((warning) => warning.includes("degraded:")));
});

test("degraded mixed AI and Chinese input does not call PubMed assist for broad raw text", async () => {
  let pubmedCalls = 0;
  const plan = await planMedicalQuery(["AI + 眼科"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: "not json",
    }),
    assistPubmed: async (terms) => {
      pubmedCalls += 1;
      return {
        keywords: ["antagonists and inhibitors", ...terms],
        correctedTerms: [],
        meshRecords: [
          {
            meshId: "bad",
            name: "antagonists  and  inhibitors",
            entryTerms: ["antagonists"],
          },
        ],
        errors: [],
      };
    },
  });

  assert.equal(pubmedCalls, 0);
  assert.deepEqual(plan.groups[0].terms, ["AI + 眼科"]);
  assert.deepEqual(plan.groups[0].meshHeadings, []);
});

test("does not expand broad groups with PubMed assist", async () => {
  let pubmedCalls = 0;
  const plan = await planMedicalQuery(["AI + 眼科"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "mixed",
        topic: "AI in ophthalmology",
        method_terms: ["artificial intelligence"],
        domain_terms: ["ophthalmology"],
        broad_terms: ["AI", "eye"],
      }),
    }),
    assistPubmed: async (terms) => {
      pubmedCalls += 1;
      return {
        keywords: terms,
        correctedTerms: [],
        meshRecords: [],
        errors: [],
      };
    },
  });

  const broadGroup = plan.groups.find((group) => group.name === "broad_terms");
  assert.equal(pubmedCalls, 2);
  assert.deepEqual(broadGroup?.terms, ["AI", "eye"]);
  assert.deepEqual(broadGroup?.meshHeadings, []);
});

test("filters unrelated PubMed MeSH records before merging assist terms", async () => {
  const plan = await planMedicalQuery(["眼科 OCT 血管"], {
    callMiniMax: async () => ({
      model: "test-minimax",
      content: payload({
        language: "zh",
        topic: "ophthalmology imaging vascular",
        domain_terms: ["ophthalmology", "vascular diseases"],
        subtopics: ["OCT"],
      }),
    }),
    assistPubmed: async (terms) => {
      const text = terms.join(" ").toLowerCase();
      if (text.includes("oct")) {
        return {
          keywords: ["OCT", "Octamer Transcription Factor-6"],
          correctedTerms: [],
          meshRecords: [
            {
              meshId: "bad-oct",
              name: "Octamer Transcription Factor-6",
              entryTerms: ["OCT-6 Transcription Factor"],
            },
          ],
          errors: [],
        };
      }

      return {
        keywords: [
          ...terms,
          "Ophthalmology",
          "Graves Ophthalmopathy",
          "Vascular Diseases",
          "Spinal Cord Vascular Diseases",
        ],
        correctedTerms: [],
        meshRecords: [
          {
            meshId: "ok-eye",
            name: "Ophthalmology",
            entryTerms: [],
          },
          {
            meshId: "bad-eye",
            name: "Graves Ophthalmopathy",
            entryTerms: [],
          },
          {
            meshId: "ok-vascular",
            name: "Vascular Diseases",
            entryTerms: [],
          },
          {
            meshId: "bad-vascular",
            name: "Spinal Cord Vascular Diseases",
            entryTerms: [],
          },
        ],
        errors: [],
      };
    },
  });

  includesTerm(plan, "Ophthalmology");
  includesTerm(plan, "Vascular Diseases");
  const terms = normalized(allTerms(plan));
  assert.equal(terms.includes("graves ophthalmopathy"), false);
  assert.equal(terms.includes("spinal cord vascular diseases"), false);
  assert.equal(terms.includes("octamer transcription factor-6"), false);
});
