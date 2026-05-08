import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerKeywordPubmedQueries,
  buildQueryFromKeywords,
  buildUserPreferenceJournalQueries,
  expandKeywordSeedsForSync,
  toKeywordSyncSeedList,
  toJournalList,
  toKeywordList,
  toPubmedSearchTerms,
} from "../src/lib/pubmed-sync-queries";
import type { MedicalQueryPlan } from "../src/lib/medical-query-plan";

test("keeps PubMed-friendly normalized terms and drops compact mirror terms", () => {
  const terms = toPubmedSearchTerms([
    "vascular surgery",
    "vascularsurgery",
    "endovascular surgery",
    "血管外科",
  ]);

  assert.deepEqual(terms, ["vascular surgery", "endovascular surgery"]);
});

test("profile keyword list prefers normalized English terms for PubMed search", () => {
  const keywords = toKeywordList([
    {
      subscription_keywords: ["血管外科"],
      subscription_mesh_terms: ["Vascular Surgical Procedures"],
      subscription_normalized_keywords: [
        "vascular surgery",
        "vascularsurgery",
        "endovascular surgery",
      ],
    },
  ]);

  assert.ok(keywords.includes("vascular surgery"));
  assert.ok(keywords.includes("endovascular surgery"));
  assert.ok(keywords.includes("vascular surgical procedures"));
  assert.equal(keywords.includes("血管外科"), false);
  assert.equal(keywords.includes("vascularsurgery"), false);
});

test("Chinese user interests use their normalized English PubMed terms", () => {
  const keywords = toKeywordList([
    {
      subscription_keywords: ["脓毒症", "肝癌", "医学影像大模型"],
      subscription_mesh_terms: [],
      subscription_normalized_keywords: [
        "sepsis",
        "hepatocellular carcinoma",
        "liver cancer",
        "medical imaging",
        "large language model",
        "foundation model",
      ],
    },
  ]);

  assert.deepEqual(keywords, [
    "sepsis",
    "hepatocellular carcinoma",
    "liver cancer",
    "medical imaging",
    "large language model",
    "foundation model",
  ]);
});

test("raw Chinese specialties expand into PubMed-searchable keyword terms", () => {
  const keywords = toKeywordList([
    {
      subscription_keywords: [
        "\u6d88\u5316\u5185\u79d1",
        "\u53e3\u8154\u533b\u5b66",
        "\u653e\u5c04\u5f71\u50cf",
        "\u5168\u79d1\u533b\u5b66/\u521d\u7ea7\u4fdd\u5065",
      ],
      subscription_mesh_terms: [],
    },
  ]);

  assert.ok(keywords.includes("gastroenterology"));
  assert.ok(keywords.includes("digestive system disease"));
  assert.ok(keywords.includes("oral medicine"));
  assert.ok(keywords.includes("dentistry"));
  assert.ok(keywords.includes("radiology"));
  assert.ok(keywords.includes("diagnostic imaging"));
  assert.ok(keywords.includes("family medicine"));
  assert.ok(keywords.includes("primary care"));
  assert.equal(keywords.includes("\u6d88\u5316\u5185\u79d1"), false);
});

test("keyword sync seeds keep raw Chinese specialty and add local English aliases", () => {
  const seeds = expandKeywordSeedsForSync(["\u91cd\u75c7\u533b\u5b66"]);

  assert.equal(seeds[0], "\u91cd\u75c7\u533b\u5b66");
  assert.ok(seeds.includes("critical care"));
  assert.ok(seeds.includes("intensive care unit"));
  assert.ok(seeds.includes("icu"));
});

test("profile journal list includes normalized full journal names and useful acronyms", () => {
  const journals = toJournalList([
    {
      subscription_keywords: [],
      subscription_mesh_terms: [],
      custom_journals: ["ejves"],
      subscription_normalized_journals: [
        "European Journal of Vascular and Endovascular Surgery",
        "europeanjournalofvascularandendovascularsurgery",
        "EJVES",
      ],
    },
  ]);

  assert.deepEqual(journals, [
    "european journal of vascular and endovascular surgery",
    "ejves",
  ]);
});

test("user journal queries search both PubMed journal title and abbreviation fields", () => {
  const [query] = buildUserPreferenceJournalQueries([
    "European Journal of Vascular and Endovascular Surgery",
    "EJVES",
  ]);

  assert.ok(query.includes('"European Journal of Vascular and Endovascular Surgery"[jour]'));
  assert.ok(query.includes('"European Journal of Vascular and Endovascular Surgery"[ta]'));
  assert.ok(query.includes('"EJVES"[jour]'));
  assert.ok(query.includes('"EJVES"[ta]'));
});

test("broad keyword query uses title/abstract plus MeSH clauses", () => {
  const query = buildQueryFromKeywords(["vascular surgery"]);

  assert.ok(query.includes('"vascular surgery"[tiab]'));
  assert.ok(query.includes('"vascular surgery"[mh]'));
  assert.ok(query.includes('"artificial intelligence"[Title/Abstract]'));
});

test("keyword sync seeds keep raw Chinese specialty and add local aliases", () => {
  const keywords = toKeywordSyncSeedList([
    {
      subscription_keywords: ["眼科"],
      subscription_mesh_terms: [],
    },
  ]);

  assert.equal(keywords[0], "眼科");
  assert.ok(keywords.includes("ophthalmology"));
  assert.ok(keywords.includes("eye disease"));
});

test("keyword sync seeds prefer normalized PubMed terms when available", () => {
  const keywords = toKeywordSyncSeedList([
    {
      subscription_keywords: ["眼科"],
      subscription_mesh_terms: [],
      subscription_normalized_keywords: ["ophthalmology", "eye disease"],
    },
  ]);

  assert.deepEqual(keywords, ["ophthalmology", "eye disease"]);
});

test("planner keyword PubMed queries add an AI constraint for pure domain interests", () => {
  const plan: MedicalQueryPlan = {
    rawInput: ["眼科"],
    topic: "ophthalmology",
    language: "zh",
    warnings: [],
    groups: [
      {
        name: "domain_terms",
        role: "domain",
        terms: ["ophthalmology", "eye disease"],
        meshHeadings: ["Ophthalmology", "Eye Diseases"],
        entryTerms: ["ocular disease"],
        strength: "required",
      },
    ],
    intents: [
      {
        name: "default",
        description: "AI ophthalmology papers.",
        mustMatchGroupNames: ["domain_terms"],
        optionalGroupNames: [],
        pubmedQuery:
          '("Ophthalmology"[Mesh] OR "Eye Diseases"[Mesh] OR "ophthalmology"[tiab])',
      },
    ],
  };

  const [query] = buildPlannerKeywordPubmedQueries(plan, 30);

  assert.ok(query.includes('"artificial intelligence"[Title/Abstract]'));
  assert.ok(query.includes('"Ophthalmology"[Mesh]'));
  assert.ok(query.includes('"last 30 days"[EDat]'));
  assert.ok(query.includes("hasabstract[text]"));
});

test("planner keyword PubMed queries do not duplicate AI constraints for method intents", () => {
  const plan: MedicalQueryPlan = {
    rawInput: ["AI + 眼科"],
    topic: "AI ophthalmology",
    language: "mixed",
    warnings: [],
    groups: [
      {
        name: "method_terms",
        role: "method",
        terms: ["artificial intelligence", "deep learning"],
        meshHeadings: ["Artificial Intelligence", "Deep Learning"],
        entryTerms: ["machine learning"],
        strength: "required",
      },
      {
        name: "domain_terms",
        role: "domain",
        terms: ["ophthalmology"],
        meshHeadings: ["Ophthalmology"],
        entryTerms: ["eye"],
        strength: "required",
      },
    ],
    intents: [
      {
        name: "ai_ophthalmology",
        description: "AI ophthalmology papers.",
        mustMatchGroupNames: ["method_terms", "domain_terms"],
        optionalGroupNames: [],
        pubmedQuery:
          '("Artificial Intelligence"[Mesh] OR "Deep Learning"[Mesh]) AND ("Ophthalmology"[Mesh])',
      },
    ],
  };

  const [query] = buildPlannerKeywordPubmedQueries(plan, 7);

  assert.equal(query.includes('"artificial intelligence"[Title/Abstract]'), false);
  assert.ok(query.includes('"Artificial Intelligence"[Mesh]'));
  assert.ok(query.includes('"last 7 days"[EDat]'));
});

test("planner keyword PubMed queries skip degraded plans", () => {
  const plan: MedicalQueryPlan = {
    rawInput: ["眼科"],
    topic: null,
    language: "unknown",
    warnings: ["degraded:minimax_unavailable"],
    groups: [
      {
        name: "raw_input",
        role: "broad",
        terms: ["眼科"],
        meshHeadings: [],
        entryTerms: [],
        strength: "weak",
      },
    ],
    intents: [
      {
        name: "degraded",
        description: "",
        mustMatchGroupNames: ["raw_input"],
        optionalGroupNames: [],
        pubmedQuery: '("眼科"[tiab])',
      },
    ],
  };

  assert.deepEqual(buildPlannerKeywordPubmedQueries(plan, 30), []);
});
