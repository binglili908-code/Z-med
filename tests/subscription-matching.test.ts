import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchText,
  expandJournalTerms,
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

  assert.equal(journalMatchesAnyTerm(journal, expandJournalTerms(["EJVES"])), true);
  assert.equal(journalMatchesAnyTerm(journal, expandJournalTerms(["EJVSE"])), true);
  assert.equal(journalMatchesAnyTerm(journal, expandJournalTerms(["cardiology"])), false);
});

test("journal expansion keeps journal aliases separate from topic aliases", () => {
  const terms = expandJournalTerms(["EJVES"]);

  assert.ok(terms.includes("ejves"));
  assert.ok(terms.includes("european journal of vascular and endovascular surgery"));
  assert.equal(terms.includes("vascular surgery"), false);
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

test("expands Chinese specialty preferences to PubMed-friendly English aliases", () => {
  const cases: Array<[string, string[]]> = [
    ["\u6d88\u5316\u5185\u79d1", ["gastroenterology", "digestive system disease"]],
    ["\u53e3\u8154\u533b\u5b66", ["oral medicine", "dentistry"]],
    ["\u653e\u5c04\u5f71\u50cf", ["radiology", "diagnostic imaging"]],
    ["\u7cbe\u795e\u533b\u5b66", ["psychiatry", "mental health"]],
    ["\u6ccc\u5c3f\u5916\u79d1", ["urology", "urinary tract"]],
    ["\u62a4\u7406", ["nursing", "patient care"]],
    ["\u75c5\u7406", ["pathology", "histopathology"]],
    ["\u513f\u79d1", ["pediatrics", "child health"]],
    ["\u80be\u5185\u79d1", ["nephrology", "chronic kidney disease"]],
    ["\u611f\u67d3\u75c5", ["infectious disease", "sepsis"]],
    ["\u6025\u8bca\u533b\u5b66", ["emergency medicine", "triage"]],
    ["\u91cd\u75c7\u533b\u5b66", ["critical care", "intensive care unit"]],
    ["\u8001\u5e74\u533b\u5b66", ["geriatrics", "frailty"]],
    ["\u76ae\u80a4\u79d1", ["dermatology", "skin disease"]],
    ["\u9aa8\u79d1", ["orthopedics", "fracture"]],
    ["\u98ce\u6e7f\u514d\u75ab", ["rheumatology", "autoimmune disease"]],
    ["\u8840\u6db2\u79d1", ["hematology", "leukemia"]],
    ["\u80bf\u7624\u5b66", ["oncology", "neoplasms"]],
    ["\u751f\u6b96\u533b\u5b66", ["reproductive medicine", "fertility"]],
    ["\u5168\u79d1\u533b\u5b66/\u521d\u7ea7\u4fdd\u5065", ["family medicine", "primary care"]],
  ];

  for (const [raw, expectedTerms] of cases) {
    const terms = expandSubscriptionTerms([raw]);
    for (const expected of expectedTerms) {
      assert.ok(terms.includes(expected), `${raw} should include ${expected}`);
    }
  }
});

test("matches papers through expanded Chinese specialty aliases", () => {
  assert.equal(
    textMatchesAnyTerm(
      buildSearchText(["Deep learning for gastrointestinal endoscopy quality control."]),
      expandSubscriptionTerms(["\u6d88\u5316\u5185\u79d1"]),
    ),
    true,
  );
  assert.equal(
    textMatchesAnyTerm(
      buildSearchText(["AI-assisted triage in the emergency department."]),
      expandSubscriptionTerms(["\u6025\u8bca\u533b\u5b66"]),
    ),
    true,
  );
  assert.equal(
    textMatchesAnyTerm(
      buildSearchText(["Foundation models for primary care decision support."]),
      expandSubscriptionTerms(["\u5168\u79d1\u533b\u5b66/\u521d\u7ea7\u4fdd\u5065"]),
    ),
    true,
  );
});
