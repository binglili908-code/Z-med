import assert from "node:assert/strict";
import test from "node:test";

import { selectKeywordSyncPmids } from "../src/lib/pubmed-sync";

test("keyword sync processes new PMIDs first when refreshing existing papers", () => {
  const selected = selectKeywordSyncPmids({
    dedupedPmids: ["1", "2", "3", "4", "5"],
    existingPmids: new Set(["1", "2"]),
    includeExisting: true,
    maxPmids: 3,
  });

  assert.deepEqual(selected.newPmids, ["3", "4", "5"]);
  assert.deepEqual(selected.selectedPmids, ["3", "4", "5", "1", "2"]);
  assert.deepEqual(selected.pmidsToProcess, ["3", "4", "5"]);
  assert.equal(selected.truncated, true);
});

test("keyword sync skips existing PMIDs when refresh is not requested", () => {
  const selected = selectKeywordSyncPmids({
    dedupedPmids: ["1", "2", "3"],
    existingPmids: new Set(["1", "2"]),
    includeExisting: false,
    maxPmids: 10,
  });

  assert.deepEqual(selected.newPmids, ["3"]);
  assert.deepEqual(selected.selectedPmids, ["3"]);
  assert.deepEqual(selected.pmidsToProcess, ["3"]);
  assert.equal(selected.truncated, false);
});
