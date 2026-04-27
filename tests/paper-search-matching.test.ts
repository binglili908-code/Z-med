import assert from "node:assert/strict";
import test from "node:test";

import {
  paperMatchesSearchTerms,
  type SearchPaperRow,
} from "../src/server/repositories/papers";

function paper(overrides: Partial<SearchPaperRow>): SearchPaperRow {
  return {
    abstract: null,
    abstract_zh: null,
    ai_med_score: 0.9,
    id: "paper",
    is_ai_med: true,
    is_open_access: false,
    journal: "General Medicine",
    journal_cas_zone: null,
    journal_if: null,
    keywords: [],
    mesh_terms: [],
    oa_pdf_url: null,
    publication_date: "2026-04-20",
    pubmed_url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    quality_score: 90,
    quality_tier: "core",
    title: "Untitled",
    title_zh: null,
    ...overrides,
  };
}

test("search terms use AND semantics across query groups", () => {
  const terms = ["nature", "\u80f0\u817a\u764c"];

  assert.equal(
    paperMatchesSearchTerms(
      paper({
        journal: "Nature Medicine",
        title: "Breast cancer risk prediction",
      }),
      terms,
    ),
    false,
  );
  assert.equal(
    paperMatchesSearchTerms(
      paper({
        journal: "Cancer Discovery",
        title: "Pancreatic cancer organoid model",
      }),
      terms,
    ),
    false,
  );
  assert.equal(
    paperMatchesSearchTerms(
      paper({
        journal: "Nature",
        title: "Pancreatic cancer multi-omics atlas",
      }),
      terms,
    ),
    true,
  );
});

test("Chinese pancreatic cancer query expands to English aliases", () => {
  assert.equal(
    paperMatchesSearchTerms(
      paper({
        journal: "Nature",
        title: "Pancreatic ductal adenocarcinoma treatment response",
      }),
      ["nature", "\u80f0\u817a\u764c"],
    ),
    true,
  );
});
