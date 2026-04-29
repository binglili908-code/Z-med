import assert from "node:assert/strict";
import test from "node:test";

import {
  filterReviewLikePapers,
  getPublicationTypesFromPayload,
  isReviewLikePaper,
} from "../src/lib/paper-article-type";

test("extracts PubMed publication types from source payload", () => {
  assert.deepEqual(
    getPublicationTypesFromPayload({
      pubtype: ["Journal Article", "Systematic Review", "Meta-Analysis"],
    }),
    ["journal article", "systematic review", "meta analysis"],
  );
});

test("detects review-like papers from PubMed publication type", () => {
  assert.equal(
    isReviewLikePaper({
      title: "Deep learning for diabetic retinopathy screening",
      source_payload: { pubtype: ["Review"] },
    }),
    true,
  );
});

test("detects review-like papers from title fallback", () => {
  assert.equal(
    isReviewLikePaper({
      title: "Artificial intelligence in ophthalmology: a systematic review",
      source_payload: {},
    }),
    true,
  );
});

test("does not classify original evaluation papers as reviews", () => {
  assert.equal(
    isReviewLikePaper({
      title: "Comprehensive evaluation of ChatGPT diagnostic accuracy in ophthalmology",
      source_payload: { pubtype: ["Journal Article"] },
    }),
    false,
  );
});

test("filters review-like papers only when the user preference is enabled", () => {
  const papers = [
    {
      id: "original",
      title: "Machine learning model for retinal image classification",
      source_payload: { pubtype: ["Journal Article"] },
    },
    {
      id: "review",
      title: "Artificial intelligence in retina: a review",
      source_payload: { pubtype: ["Review"] },
    },
  ];

  assert.deepEqual(
    filterReviewLikePapers(papers, true).map((paper) => paper.id),
    ["original"],
  );
  assert.deepEqual(
    filterReviewLikePapers(papers, false).map((paper) => paper.id),
    ["original", "review"],
  );
});
