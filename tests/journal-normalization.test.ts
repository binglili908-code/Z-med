import assert from "node:assert/strict";
import test from "node:test";

import { getJournalKeyCandidates } from "../src/lib/journal-normalization";

test("normalizes Lancet Digital Health punctuation and leading article variants", () => {
  const target = "lancet digital health";

  assert.ok(getJournalKeyCandidates("The Lancet Digital Health").includes(target));
  assert.ok(getJournalKeyCandidates("The Lancet. Digital health").includes(target));
  assert.ok(getJournalKeyCandidates("Lancet Digital Health").includes(target));
  assert.ok(getJournalKeyCandidates("Lancet Digit Health").includes(target));
});
