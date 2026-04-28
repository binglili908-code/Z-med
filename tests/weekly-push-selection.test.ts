import assert from "node:assert/strict";
import test from "node:test";

import {
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
