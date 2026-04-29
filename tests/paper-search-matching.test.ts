import assert from "node:assert/strict";
import test from "node:test";

import {
  paperMatchesSearchTerms,
  searchPapers,
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

test("paper search paginates in the database when no keyword terms are provided", async () => {
  const calls: string[] = [];
  const rows = [paper({ id: "paper-1", title: "High quality AI medicine" })];
  const query = {
    select(_columns: string, options?: { count?: string }) {
      calls.push(`select:${options?.count ?? "none"}`);
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    range(from: number, to: number) {
      calls.push(`range:${from}-${to}`);
      return Promise.resolve({ data: rows, error: null, count: 123 });
    },
  };
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      return query;
    },
  };

  const result = await searchPapers(client as never, {
    terms: [],
    tier: "",
    from: "",
    to: "",
    openAccessOnly: false,
    ifMin: null,
    ifMax: null,
    fromIndex: 10,
    toIndex: 19,
  });

  assert.equal(result.total, 123);
  assert.deepEqual(result.items.map((item) => item.id), ["paper-1"]);
  assert.ok(calls.includes("select:exact"));
  assert.ok(calls.includes("range:10-19"));
});
