import assert from "node:assert/strict";
import test from "node:test";

import { buildGlobalSpotlightSelection } from "../src/lib/spotlight";
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
