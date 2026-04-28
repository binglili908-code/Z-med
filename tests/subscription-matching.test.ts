import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchText,
  expandSubscriptionTerms,
  journalMatchesAnyTerm,
  textMatchesAnyTerm,
} from "../src/lib/subscription-matching";

test("expands known medical and journal acronyms", () => {
  const terms = expandSubscriptionTerms(["EJVES", "LLM"]);

  assert.ok(terms.includes("ejves"));
  assert.ok(terms.includes("european journal of vascular and endovascular surgery"));
  assert.ok(terms.includes("large language model"));
});

test("matches journal acronyms and small acronym typos", () => {
  const journal = "European Journal of Vascular and Endovascular Surgery";

  assert.equal(journalMatchesAnyTerm(journal, expandSubscriptionTerms(["EJVES"])), true);
  assert.equal(journalMatchesAnyTerm(journal, expandSubscriptionTerms(["EJVSE"])), true);
  assert.equal(journalMatchesAnyTerm(journal, expandSubscriptionTerms(["cardiology"])), false);
});

test("matches normalized English research terms in paper text", () => {
  const text = buildSearchText([
    "Large language model-augmented reinforcement learning for sepsis management.",
    "Critical care ICU cohort.",
  ]);

  assert.equal(textMatchesAnyTerm(text, expandSubscriptionTerms(["llm"])), true);
  assert.equal(textMatchesAnyTerm(text, expandSubscriptionTerms(["ICU"])), true);
  assert.equal(textMatchesAnyTerm(text, expandSubscriptionTerms(["dermatology"])), false);
});

test("expands Chinese ophthalmology preference to English eye disease terms", () => {
  const terms = expandSubscriptionTerms(["\u773c\u79d1"]);

  assert.ok(terms.includes("ophthalmology"));
  assert.ok(terms.includes("diabetic retinopathy"));
  assert.equal(
    textMatchesAnyTerm(
      buildSearchText(["Lesion Learning Network for Diabetic Retinopathy Grading."]),
      terms,
    ),
    true,
  );
});
