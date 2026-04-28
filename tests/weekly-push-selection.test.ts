import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyPushCandidatePools,
  buildWeeklyPushDigestSelection,
  diversifyWeeklyPushCandidates,
  selectPersonalizedWeeklyPushPool,
  selectTopicFallbackWeeklyPushPool,
  sortWeeklyPushCandidates,
} from "../src/lib/weekly-push-selection";
import type {
  WeeklyPushCandidatePaper,
  WeeklyPushProfileRow,
} from "../src/server/repositories/weekly-push";

function paper(
  overrides: Partial<WeeklyPushCandidatePaper> & Pick<WeeklyPushCandidatePaper, "id" | "title">,
): WeeklyPushCandidatePaper {
  return {
    abstract: null,
    abstract_zh: null,
    ai_analysis: null,
    journal: "General Medicine",
    keywords: [],
    mesh_terms: [],
    publication_date: "2026-04-20",
    pubmed_url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    quality_score: 0.8,
    quality_tier: "core",
    source_payload: null,
    title_zh: null,
    ...overrides,
  };
}

function profile(overrides: Partial<WeeklyPushProfileRow> = {}): WeeklyPushProfileRow {
  return {
    contact_email: "test@example.com",
    custom_journals: [],
    id: "user-1",
    is_active: true,
    subscription_keywords: [],
    subscription_normalized_journals: [],
    subscription_normalized_keywords: [],
    ...overrides,
  };
}

test("sorts candidates by quality score, then publication date", () => {
  const sorted = sortWeeklyPushCandidates([
    paper({ id: "old-high", title: "Old high", publication_date: "2026-04-01", quality_score: 0.9 }),
    paper({ id: "new-high", title: "New high", publication_date: "2026-04-20", quality_score: 0.9 }),
    paper({ id: "low", title: "Low", publication_date: "2026-04-25", quality_score: 0.7 }),
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["new-high", "old-high", "low"],
  );
});

test("diversifies candidates before taking multiple papers from the same journal", () => {
  const selected = diversifyWeeklyPushCandidates(
    [
      paper({ id: "a1", title: "A 1", journal: "Journal A", quality_score: 0.95 }),
      paper({ id: "a2", title: "A 2", journal: "Journal A", quality_score: 0.94 }),
      paper({ id: "b1", title: "B 1", journal: "Journal B", quality_score: 0.9 }),
    ],
    2,
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ["a1", "b1"],
  );
});

test("filters personalized pool with normalized journal acronyms", () => {
  const selected = selectPersonalizedWeeklyPushPool(
    [
      paper({
        id: "vascular",
        title: "Endovascular repair outcomes",
        journal: "European Journal of Vascular and Endovascular Surgery",
      }),
      paper({
        id: "cardiology",
        title: "Cardiology outcomes",
        journal: "Journal of Cardiology",
      }),
    ],
    profile({ subscription_normalized_journals: ["EJVES"] }),
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ["vascular"],
  );
});

test("returns an empty pool when explicit preferences have no match", () => {
  const selected = selectPersonalizedWeeklyPushPool(
    [paper({ id: "general", title: "General medicine update" })],
    profile({ subscription_normalized_keywords: ["dermatology"] }),
  );

  assert.deepEqual(selected, []);
});

test("broad vascular preferences do not match psychiatric papers by abstract-only mentions", () => {
  const selected = selectPersonalizedWeeklyPushPool(
    [
      paper({
        id: "psychiatry-vascular-abstract",
        title: "Psychosis treatment response study",
        abstract: "We evaluate vascular risk factors in a psychiatry cohort.",
        keywords: ["psychosis"],
        mesh_terms: ["Schizophrenia"],
        quality_score: 0.99,
      }),
      paper({
        id: "vascular-title",
        title: "Vascular surgery outcomes after endovascular repair",
        abstract: "A registry study.",
        keywords: ["vascular surgery"],
        mesh_terms: ["Vascular Surgical Procedures"],
        quality_score: 0.8,
      }),
    ],
    profile({ subscription_normalized_keywords: ["vascular"] }),
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ["vascular-title"],
  );
});

test("topic fallback keeps keyword matches when strict journal plus keyword pool is empty", () => {
  const selected = selectTopicFallbackWeeklyPushPool(
    [
      paper({
        id: "nature-breast",
        journal: "Nature Medicine",
        title: "Breast cancer risk prediction",
      }),
      paper({
        id: "pancreas",
        journal: "Cancer Discovery",
        title: "Pancreatic cancer organoid model",
      }),
    ],
    profile({
      subscription_normalized_journals: ["nature"],
      subscription_normalized_keywords: ["pancreatic cancer"],
    }),
  );

  assert.deepEqual(
    selected.map((item) => item.id),
    ["pancreas"],
  );
});

test("topic fallback does not use journal-only papers", () => {
  const selected = selectTopicFallbackWeeklyPushPool(
    [
      paper({
        id: "nature-breast",
        journal: "Nature Medicine",
        title: "Breast cancer risk prediction",
      }),
    ],
    profile({
      subscription_normalized_journals: ["nature"],
      subscription_normalized_keywords: ["pancreatic cancer"],
    }),
  );

  assert.deepEqual(selected, []);
});

test("weekly digest selection fills precision shortage with trending and cross papers", () => {
  const candidates = [
    ...[1, 2, 3, 4].map((n) =>
      paper({
        id: `eye-${n}`,
        title: `Diabetic retinopathy model ${n}`,
        journal: `Eye Journal ${n}`,
        quality_score: 0.9 - n * 0.01,
      }),
    ),
    ...[1, 2, 3].map((n) =>
      paper({
        id: `global-${n}`,
        title: `Global high quality ${n}`,
        journal: `Global Journal ${n}`,
        quality_score: 0.8 - n * 0.01,
      }),
    ),
  ];

  const selection = buildWeeklyPushDigestSelection(
    candidates,
    profile({ subscription_normalized_keywords: ["diabetic retinopathy"] }),
    { targetCount: 7 },
  );

  assert.equal(selection.exactSelected.length, 4);
  assert.equal(selection.trendingSelected.length, 1);
  assert.equal(selection.crossSelected.length, 2);
  assert.equal(selection.precisionShortage, 1);
});

test("weekly digest selection still fills seven papers when there are no precision matches", () => {
  const candidates = Array.from({ length: 8 }, (_, index) =>
    paper({
      id: `global-${index + 1}`,
      title: `Global paper ${index + 1}`,
      journal: `Global Journal ${index + 1}`,
      quality_score: 0.9 - index * 0.01,
    }),
  );

  const selection = buildWeeklyPushDigestSelection(
    candidates,
    profile({ subscription_normalized_keywords: ["dermatology"] }),
    { targetCount: 7 },
  );

  assert.equal(selection.exactSelected.length, 0);
  assert.equal(selection.trendingSelected.length, 1);
  assert.equal(selection.crossSelected.length, 6);
  assert.equal(selection.precisionShortage, 5);
});

test("weekly candidate pools keep dynamic precision papers out of fallback candidates", () => {
  const pools = buildWeeklyPushCandidatePools([
    paper({
      id: "dynamic-eye",
      title: "Machine learning in ophthalmology",
      keywords: ["ophthalmology", "machine learning"],
      quality_score: 0.45,
      quality_tier: "emerging",
      source_payload: {
        keyword_sync: {
          recommendation_eligible: true,
          dynamic_context: { eligible: true },
        },
      },
    }),
    paper({
      id: "low-general",
      title: "General low quality AI paper",
      quality_score: 0.45,
      quality_tier: "emerging",
    }),
    paper({
      id: "high-global",
      title: "High quality global paper",
      quality_score: 0.82,
      quality_tier: "core",
    }),
  ]);

  assert.deepEqual(
    pools.precisionCandidates.map((item) => item.id),
    ["high-global", "dynamic-eye"],
  );
  assert.deepEqual(
    pools.fallbackCandidates.map((item) => item.id),
    ["high-global"],
  );
  assert.equal(pools.dynamicPrecisionCandidateCount, 1);
});

test("weekly digest uses dynamic precision candidates only for exact matches", () => {
  const dynamicEye = paper({
    id: "dynamic-eye",
    title: "Machine learning in ophthalmology",
    keywords: ["ophthalmology", "machine learning"],
    quality_score: 0.45,
    quality_tier: "emerging",
    source_payload: {
      keyword_sync: {
        recommendation_eligible: true,
        dynamic_context: { eligible: true },
      },
    },
  });
  const highGlobal = paper({
    id: "high-global",
    title: "High quality global paper",
    journal: "Global Journal",
    quality_score: 0.82,
    quality_tier: "core",
  });
  const pools = buildWeeklyPushCandidatePools([dynamicEye, highGlobal]);

  const selection = buildWeeklyPushDigestSelection(
    pools.precisionCandidates,
    profile({ subscription_normalized_keywords: ["ophthalmology"] }),
    {
      targetCount: 2,
      fallbackCandidates: pools.fallbackCandidates,
    },
  );

  assert.deepEqual(
    selection.exactSelected.map((item) => item.id),
    ["dynamic-eye"],
  );
  assert.deepEqual(
    selection.trendingSelected.map((item) => item.id),
    ["high-global"],
  );
  assert.deepEqual(selection.crossSelected, []);
});
