import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFeedProfileTerms,
  paginateRankedFeed,
  rankPersonalizedFeedPapers,
  rankTopicFallbackFeedPapers,
  scorePaperForProfile,
} from "../src/lib/personalized-feed-ranking";
import type { DbPaper } from "../src/server/repositories/papers";
import type { ProfileSubscriptionStatus } from "../src/server/repositories/profiles";

function profileStatus(
  overrides: Partial<ProfileSubscriptionStatus> = {},
): ProfileSubscriptionStatus {
  return {
    customJournals: [],
    excludeReviews: false,
    hasSubscriptionConfig: true,
    keywords: [],
    matchingJournals: [],
    matchingKeywords: [],
    normalizationError: null,
    normalizedAt: "2026-04-27T00:00:00.000Z",
    subscriptionEnabled: true,
    ...overrides,
  };
}

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
    source_payload: null,
    title_zh: null,
    ...restOverrides,
    id,
    title,
  };
}

const NOW = new Date("2026-04-27T00:00:00.000Z");

test("Chinese preference normalized to English matches English paper text", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      keywords: ["\u8113\u6bd2\u75c7"],
      matchingKeywords: ["sepsis"],
    }),
  );
  const ranked = scorePaperForProfile(
    paper({
      id: "sepsis",
      title: "Large language model framework for sepsis management",
    }),
    terms,
    { now: NOW },
  );

  assert.ok(ranked);
  assert.equal(ranked.source_type, "precision");
});

test("journal abbreviation matches full journal name", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      customJournals: ["EJVES"],
      matchingJournals: ["EJVES"],
    }),
  );
  const ranked = scorePaperForProfile(
    paper({
      id: "ejves",
      journal: "European Journal of Vascular and Endovascular Surgery",
      title: "Endovascular repair outcomes",
    }),
    terms,
    { now: NOW },
  );

  assert.ok(ranked);
  assert.equal(ranked.source_type, "precision");
});

test("medical imaging large model preference matches title and abstract", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      keywords: ["\u533b\u5b66\u5f71\u50cf\u5927\u6a21\u578b"],
      matchingKeywords: ["medical imaging", "large language model", "foundation model"],
    }),
  );
  const ranked = scorePaperForProfile(
    paper({
      abstract: "We evaluate a foundation model for radiology image interpretation.",
      id: "imaging",
      title: "Large language model for medical imaging workflows",
    }),
    terms,
    { now: NOW },
  );

  assert.ok(ranked);
});

test("no-match preferences do not receive unrelated precision papers", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      matchingKeywords: ["dermatology"],
    }),
  );

  const ranked = scorePaperForProfile(
    paper({ id: "general", title: "Cardiology risk prediction" }),
    terms,
    { now: NOW },
  );

  assert.equal(ranked, null);
});

test("broad vascular preferences ignore abstract-only psychiatric mentions", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      keywords: ["\u8840\u7ba1"],
      matchingKeywords: ["vascular"],
    }),
  );

  const ranked = rankPersonalizedFeedPapers(
    [
      paper({
        id: "psychiatry-abstract",
        title: "Psychosis treatment response study",
        abstract: "This psychiatry cohort includes vascular risk factors.",
        keywords: ["psychosis"],
        mesh_terms: ["Schizophrenia"],
        quality_score: 99,
      }),
      paper({
        id: "vascular-title",
        title: "Vascular surgery outcomes after endovascular repair",
        keywords: ["vascular surgery"],
        mesh_terms: ["Vascular Surgical Procedures"],
        quality_score: 80,
      }),
    ],
    terms,
    { now: NOW },
  );

  assert.deepEqual(
    ranked.map((item) => item.id),
    ["vascular-title"],
  );
});

test("when journal and keyword are both configured, both groups are required", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      matchingJournals: ["nature"],
      matchingKeywords: ["pancreatic cancer"],
    }),
  );
  const ranked = rankPersonalizedFeedPapers(
    [
      paper({
        id: "nature-breast",
        journal: "Nature Medicine",
        title: "Breast cancer risk prediction",
      }),
      paper({
        id: "cancer-discovery-pancreas",
        journal: "Cancer Discovery",
        title: "Pancreatic cancer organoid model",
      }),
      paper({
        id: "nature-pancreas",
        journal: "Nature",
        title: "Pancreatic cancer multi-omics atlas",
      }),
    ],
    terms,
    { now: NOW },
  );

  assert.deepEqual(
    ranked.map((item) => item.id),
    ["nature-pancreas"],
  );
});

test("topic fallback keeps keyword relevance when exact journal plus keyword match is empty", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      matchingJournals: ["nature"],
      matchingKeywords: ["pancreatic cancer"],
    }),
  );
  const fallback = rankTopicFallbackFeedPapers(
    [
      paper({
        id: "nature-breast",
        journal: "Nature Medicine",
        title: "Breast cancer risk prediction",
      }),
      paper({
        id: "cancer-discovery-pancreas",
        journal: "Cancer Discovery",
        title: "Pancreatic cancer organoid model",
      }),
    ],
    terms,
    { now: NOW },
  );

  assert.deepEqual(
    fallback.map((item) => item.id),
    ["cancer-discovery-pancreas"],
  );
  assert.equal(fallback[0].source_type, "serendipity");
});

test("topic fallback is not used for journal-only matches", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      matchingJournals: ["nature"],
      matchingKeywords: ["pancreatic cancer"],
    }),
  );
  const fallback = rankTopicFallbackFeedPapers(
    [
      paper({
        id: "nature-breast",
        journal: "Nature Medicine",
        title: "Breast cancer risk prediction",
      }),
    ],
    terms,
    { now: NOW },
  );

  assert.equal(fallback.length, 0);
});

test("pagination total means all matched papers, not current page length", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      matchingKeywords: ["sepsis"],
    }),
  );
  const ranked = rankPersonalizedFeedPapers(
    [
      paper({ id: "one", title: "Sepsis prediction model" }),
      paper({ id: "two", title: "Sepsis treatment model" }),
    ],
    terms,
    { now: NOW },
  );
  const page = paginateRankedFeed(ranked, 2, 1);

  assert.equal(page.total, 2);
  assert.equal(page.paperRows.length, 1);
  assert.equal(page.paperRows[0].id, "two");
});

test("paper matching journal plus keyword ranks above keyword-only paper", () => {
  const terms = buildFeedProfileTerms(
    profileStatus({
      matchingJournals: ["EJVES"],
      matchingKeywords: ["sepsis"],
    }),
  );
  const ranked = rankPersonalizedFeedPapers(
    [
      paper({
        id: "keyword-only",
        journal: "General Medicine",
        title: "Sepsis prediction model",
      }),
      paper({
        id: "journal-and-keyword",
        journal: "European Journal of Vascular and Endovascular Surgery",
        title: "Sepsis outcomes after endovascular repair",
      }),
    ],
    terms,
    { now: NOW },
  );

  assert.equal(ranked[0].id, "journal-and-keyword");
});
