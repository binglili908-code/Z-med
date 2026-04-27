import assert from "node:assert/strict";
import test from "node:test";

import { feedResponseSchema } from "../src/shared/contracts/papers.schema";

const validPaper = {
  id: "paper-1",
  title: "A useful paper",
  title_zh: null,
  journal: "Nature",
  journal_if: 64.8,
  journal_jcr: "Q1",
  journal_cas_zone: "1区",
  publication_date: "2026-04-27",
  quality_score: 92,
  quality_tier: "top",
  pubmed_url: "https://pubmed.ncbi.nlm.nih.gov/123/",
  is_open_access: true,
  oa_pdf_url: null,
  abstract: "Abstract",
  abstract_zh: null,
  ai_analysis: {
    summary_zh: "摘要",
    background: "Background",
    method: "Method",
    value: "Value",
  },
  source_type: "precision",
  recommendation_reason: null,
  pdf_emailed_at: null,
  topics: [],
  recommendation_score: 92,
};

test("accepts a valid feed response contract", () => {
  const parsed = feedResponseSchema.parse({
    papers: [validPaper],
    total: 1,
    page: 1,
    pageSize: 12,
    personalized: true,
    hasSubscription: true,
    requiresLogin: false,
    exactMatchTotal: 1,
    strictMatchFallback: false,
    strictMatchMessage: null,
    fallbackType: null,
  });

  assert.equal(parsed.papers[0].id, "paper-1");
});

test("rejects feed responses with invalid paper quality tiers", () => {
  const result = feedResponseSchema.safeParse({
    papers: [
      {
        ...validPaper,
        quality_tier: "unknown",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 12,
    personalized: true,
    hasSubscription: true,
    requiresLogin: false,
  });

  assert.equal(result.success, false);
});

test("rejects feed responses that omit required login state", () => {
  const result = feedResponseSchema.safeParse({
    papers: [],
    total: 0,
    page: 1,
    pageSize: 12,
    personalized: false,
    hasSubscription: false,
  });

  assert.equal(result.success, false);
});
