import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSemanticScholarLookupId,
  mapSemanticScholarPaperToEnrichmentRow,
  scoreSemanticScholarCandidatePaper,
} from "../src/lib/semantic-scholar";

test("builds DOI lookup IDs before falling back to PMID", () => {
  assert.equal(
    buildSemanticScholarLookupId({
      doi: "https://doi.org/10.1000/Example",
      pmid: "123",
    }),
    "DOI:10.1000/example",
  );
  assert.equal(
    buildSemanticScholarLookupId({
      doi: null,
      pmid: "123",
    }),
    "PMID:123",
  );
});

test("treats legacy DOI-like PMID values as DOI lookup IDs", () => {
  assert.equal(
    buildSemanticScholarLookupId({
      doi: null,
      pmid: "10.1038/s41746-026-02602-9",
    }),
    "DOI:10.1038/s41746-026-02602-9",
  );
});

test("maps Semantic Scholar paper details into the enrichment row shape", () => {
  const row = mapSemanticScholarPaperToEnrichmentRow({
    enrichedAt: "2026-04-29T00:00:00.000Z",
    source: {
      id: "paper-id",
      pmid: "123",
      doi: "10.1000/example",
      title: "Original PubMed title",
    },
    paper: {
      paperId: "s2-paper-id",
      corpusId: 42,
      externalIds: {
        DOI: "10.1000/example",
        PMID: "123",
      },
      url: "https://www.semanticscholar.org/paper/s2-paper-id",
      title: "AI in medicine",
      venue: "Nature Medicine",
      year: 2026,
      referenceCount: 12,
      citationCount: 34,
      influentialCitationCount: 5,
      isOpenAccess: true,
      openAccessPdf: {
        url: "https://example.com/paper.pdf",
        status: "GREEN",
      },
      fieldsOfStudy: ["Medicine"],
      s2FieldsOfStudy: [{ category: "Computer Science", source: "s2-fos-model" }],
      publicationTypes: ["JournalArticle"],
      publicationDate: "2026-04-01",
    },
  });

  assert.equal(row.paper_id, "paper-id");
  assert.equal(row.s2_paper_id, "s2-paper-id");
  assert.equal(row.corpus_id, "42");
  assert.equal(row.doi, "10.1000/example");
  assert.equal(row.citation_count, 34);
  assert.deepEqual(row.fields_of_study, ["Medicine", "Computer Science"]);
  assert.deepEqual(row.publication_types, ["JournalArticle"]);
  assert.equal(row.last_enriched_at, "2026-04-29T00:00:00.000Z");
});

test("holds review-like Semantic Scholar candidates even when topic fields match", () => {
  const quality = scoreSemanticScholarCandidatePaper({
    paperId: "s2-review",
    externalIds: { DOI: "10.1000/review" },
    title: "Artificial intelligence in radiology: an umbrella review",
    abstract: Array.from({ length: 120 }, () => "diagnostic").join(" "),
    fieldsOfStudy: ["Medicine"],
    s2FieldsOfStudy: [{ category: "Computer Science", source: "s2-fos-model" }],
    publicationTypes: ["Review", "JournalArticle"],
    citationCount: 0,
    influentialCitationCount: 0,
  });

  assert.equal(quality.isReviewLike, true);
  assert.equal(quality.eligibleForPromotion, false);
  assert.ok(quality.reasons.includes("review_like"));
  assert.ok(quality.reasons.includes("hold_for_review"));
});

test("marks original medical AI candidates as eligible for PubMed verification", () => {
  const quality = scoreSemanticScholarCandidatePaper({
    paperId: "s2-original",
    externalIds: { DOI: "10.1000/original", PMID: "12345" },
    title: "Prospective evaluation of an AI triage model in emergency radiology",
    abstract: Array.from({ length: 140 }, () => "patient").join(" "),
    fieldsOfStudy: ["Medicine"],
    s2FieldsOfStudy: [{ category: "Computer Science", source: "s2-fos-model" }],
    publicationTypes: ["JournalArticle", "ClinicalTrial"],
    citationCount: 12,
    influentialCitationCount: 1,
    openAccessPdf: {
      url: "https://example.com/original.pdf",
      status: "GREEN",
    },
  });

  assert.equal(quality.isReviewLike, false);
  assert.equal(quality.eligibleForPromotion, true);
  assert.ok(quality.score >= 0.55);
  assert.ok(quality.reasons.includes("has_pmid"));
  assert.ok(quality.reasons.includes("substantial_abstract"));
});
