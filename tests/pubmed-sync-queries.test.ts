import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQueryFromKeywords,
  buildUserPreferenceJournalQueries,
  toJournalList,
  toKeywordList,
  toPubmedSearchTerms,
} from "../src/lib/pubmed-sync-queries";

test("keeps PubMed-friendly normalized terms and drops compact mirror terms", () => {
  const terms = toPubmedSearchTerms([
    "vascular surgery",
    "vascularsurgery",
    "endovascular surgery",
    "血管外科",
  ]);

  assert.deepEqual(terms, ["vascular surgery", "endovascular surgery"]);
});

test("profile keyword list prefers normalized English terms for PubMed search", () => {
  const keywords = toKeywordList([
    {
      subscription_keywords: ["血管外科"],
      subscription_mesh_terms: ["Vascular Surgical Procedures"],
      subscription_normalized_keywords: [
        "vascular surgery",
        "vascularsurgery",
        "endovascular surgery",
      ],
    },
  ]);

  assert.ok(keywords.includes("vascular surgery"));
  assert.ok(keywords.includes("endovascular surgery"));
  assert.ok(keywords.includes("vascular surgical procedures"));
  assert.equal(keywords.includes("血管外科"), false);
  assert.equal(keywords.includes("vascularsurgery"), false);
});

test("Chinese user interests use their normalized English PubMed terms", () => {
  const keywords = toKeywordList([
    {
      subscription_keywords: ["脓毒症", "肝癌", "医学影像大模型"],
      subscription_mesh_terms: [],
      subscription_normalized_keywords: [
        "sepsis",
        "hepatocellular carcinoma",
        "liver cancer",
        "medical imaging",
        "large language model",
        "foundation model",
      ],
    },
  ]);

  assert.deepEqual(keywords, [
    "sepsis",
    "hepatocellular carcinoma",
    "liver cancer",
    "medical imaging",
    "large language model",
    "foundation model",
  ]);
});

test("profile journal list includes normalized full journal names and useful acronyms", () => {
  const journals = toJournalList([
    {
      subscription_keywords: [],
      subscription_mesh_terms: [],
      custom_journals: ["ejves"],
      subscription_normalized_journals: [
        "European Journal of Vascular and Endovascular Surgery",
        "europeanjournalofvascularandendovascularsurgery",
        "EJVES",
      ],
    },
  ]);

  assert.deepEqual(journals, [
    "european journal of vascular and endovascular surgery",
    "ejves",
  ]);
});

test("user journal queries search both PubMed journal title and abbreviation fields", () => {
  const [query] = buildUserPreferenceJournalQueries([
    "European Journal of Vascular and Endovascular Surgery",
    "EJVES",
  ]);

  assert.ok(query.includes('"European Journal of Vascular and Endovascular Surgery"[jour]'));
  assert.ok(query.includes('"European Journal of Vascular and Endovascular Surgery"[ta]'));
  assert.ok(query.includes('"EJVES"[jour]'));
  assert.ok(query.includes('"EJVES"[ta]'));
});

test("broad keyword query uses title/abstract plus MeSH clauses", () => {
  const query = buildQueryFromKeywords(["vascular surgery"]);

  assert.ok(query.includes('"vascular surgery"[tiab]'));
  assert.ok(query.includes('"vascular surgery"[mh]'));
  assert.ok(query.includes('"artificial intelligence"[Title/Abstract]'));
});
