import assert from "node:assert/strict";
import test from "node:test";

import { buildWeeklyPushDigestHtml } from "../src/lib/weekly-push-email";
import type { WeeklyPushDigestPaper } from "../src/lib/weekly-push-email";

function paper(overrides: Partial<WeeklyPushDigestPaper> = {}): WeeklyPushDigestPaper {
  return {
    abstract: "Original English abstract.",
    abstract_zh: null,
    ai_analysis: null,
    id: "paper-1",
    journal: "Nature Medicine",
    keywords: [],
    mesh_terms: [],
    publication_date: "2026-04-24",
    pubmed_url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    quality_score: 0.9,
    quality_tier: "top",
    recommendation_reason: "Matched preferences",
    source_type: "precision",
    title: "Pancreatic cancer study",
    title_zh: null,
    ...overrides,
  };
}

test("weekly push email shows English abstract when Chinese abstract is absent", () => {
  const html = buildWeeklyPushDigestHtml([paper()]);

  assert.match(html, /English Abstract/);
  assert.match(html, /Original English abstract\./);
});

test("weekly push email marks topic fallback papers clearly", () => {
  const html = buildWeeklyPushDigestHtml([
    paper({
      recommendation_reason: "Topic fallback",
      source_type: "serendipity",
    }),
  ]);

  assert.match(html, /\u4e3b\u9898\u5907\u9009/);
  assert.match(html, /Topic fallback/);
});
