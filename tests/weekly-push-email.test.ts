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

test("weekly push email marks cross-direction papers clearly", () => {
  const html = buildWeeklyPushDigestHtml([
    paper({
      recommendation_reason: "Cross direction",
      source_type: "serendipity",
    }),
  ]);

  assert.match(html, /\u4ea4\u53c9\u65b9\u5411/);
  assert.match(html, /Cross direction/);
});

test("weekly push email marks global trending papers clearly", () => {
  const html = buildWeeklyPushDigestHtml([
    paper({
      recommendation_reason: "Global trending",
      source_type: "trending",
    }),
  ]);

  assert.match(html, /\u5168\u5c40\u70ed\u70b9/);
  assert.match(html, /Global trending/);
});

test("weekly push email shows precision shortage notice", () => {
  const html = buildWeeklyPushDigestHtml([paper()], { precisionShortage: 2 });

  assert.match(html, /\u672c\u5468\u4e0e\u60a8\u7814\u7a76\u9886\u57df\u7cbe\u51c6\u547d\u4e2d\u6587\u732e\u4e0d\u8db35\u7bc7/);
  assert.match(html, /\u4ea4\u53c9\u65b9\u5411/);
});
