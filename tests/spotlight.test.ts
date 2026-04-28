import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGlobalSpotlightSelection,
  buildPersonalizedSpotlightSelection,
} from "../src/lib/spotlight";
import type { DbPaper } from "../src/server/repositories/papers";

function paper(overrides: Partial<DbPaper> & Pick<DbPaper, "id" | "title">): DbPaper {
  const { id, title, ...restOverrides } = overrides;

  return {
    abstract: null,
    abstract_zh: null,
    ai_analysis: null,
    ai_med_score: 0.8,
    is_open_access: false,
    journal: "General Medicine",
    journal_cas_zone: null,
    journal_if: null,
    journal_jcr: null,
    keywords: [],
    mesh_terms: [],
    oa_pdf_url: null,
    publication_date: "2026-04-20",
    pubmed_url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    quality_score: 80,
    quality_tier: "core",
    title_zh: null,
    ...restOverrides,
    id,
    title,
  };
}

test("global spotlight uses neutral reasons for users without subscription config", () => {
  const selected = buildGlobalSpotlightSelection([
    {
      paper: paper({
        id: "lower",
        title: "Lower score paper",
        quality_score: 80,
      }),
      journalMatch: false,
      keywordMatch: false,
      relevanceScore: 0.8,
    },
    {
      paper: paper({
        id: "higher",
        title: "Higher score paper",
        quality_score: 95,
      }),
      journalMatch: false,
      keywordMatch: false,
      relevanceScore: 0.95,
    },
  ]);

  assert.deepEqual(
    selected.map((item) => item.paper.id),
    ["higher", "lower"],
  );
  assert.deepEqual(
    selected.map((item) => item.source_type),
    ["trending", "trending"],
  );
  assert.equal(selected[0].reason, "全局高质量热点文献");
  assert.equal(selected[1].reason, "近 30 天高分文献");
  assert.ok(!selected.some((item) => item.reason.includes("您的期刊订阅")));
});

test("personalized spotlight fills precision shortage with trending and cross-direction papers", () => {
  const scored = [
    ...[1, 2, 3, 4].map((n) => ({
      paper: paper({
        id: `precision-${n}`,
        title: `Ophthalmology precision ${n}`,
        quality_score: 0.9 - n * 0.01,
      }),
      journalMatch: false,
      keywordMatch: true,
      relevanceScore: 2.9 - n * 0.01,
    })),
    ...[1, 2, 3].map((n) => ({
      paper: paper({
        id: `cross-${n}`,
        title: `Cross direction ${n}`,
        quality_score: 0.8 - n * 0.01,
      }),
      journalMatch: false,
      keywordMatch: false,
      relevanceScore: 0.8 - n * 0.01,
    })),
  ];

  const result = buildPersonalizedSpotlightSelection({
    scored,
    requiresJournalMatch: false,
    requiresKeywordMatch: true,
  });

  assert.equal(result.spotlight.length, 7);
  assert.equal(result.exactMatchTotal, 4);
  assert.equal(result.precisionShortage, 1);
  assert.equal(result.strictMatchFallback, true);
  assert.equal(result.spotlight.filter((item) => item.source_type === "precision").length, 4);
  assert.equal(result.spotlight.filter((item) => item.source_type === "trending").length, 1);
  assert.equal(result.spotlight.filter((item) => item.source_type === "serendipity").length, 2);
});

test("personalized spotlight still returns seven papers when there are no precision matches", () => {
  const scored = Array.from({ length: 8 }, (_, index) => ({
    paper: paper({
      id: `global-${index + 1}`,
      title: `Global paper ${index + 1}`,
      quality_score: 0.9 - index * 0.01,
    }),
    journalMatch: false,
    keywordMatch: false,
    relevanceScore: 0.9 - index * 0.01,
  }));

  const result = buildPersonalizedSpotlightSelection({
    scored,
    requiresJournalMatch: false,
    requiresKeywordMatch: true,
  });

  assert.equal(result.spotlight.length, 7);
  assert.equal(result.exactMatchTotal, 0);
  assert.equal(result.strictMatchFallback, true);
  assert.equal(result.spotlight.filter((item) => item.source_type === "trending").length, 1);
  assert.equal(result.spotlight.filter((item) => item.source_type === "serendipity").length, 6);
});
