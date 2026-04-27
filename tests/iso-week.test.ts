import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeIsoWeekStart,
  startOfIsoWeek,
  toDateString,
} from "../src/lib/iso-week";

test("finds Monday for a mid-week UTC date", () => {
  const start = startOfIsoWeek(new Date("2026-04-22T12:00:00.000Z"));
  assert.equal(toDateString(start), "2026-04-20");
});

test("treats Sunday as part of the same ISO week", () => {
  const start = startOfIsoWeek(new Date("2026-04-26T23:59:59.000Z"));
  assert.equal(toDateString(start), "2026-04-20");
});

test("normalizes arbitrary date input to ISO week start", () => {
  assert.equal(normalizeIsoWeekStart("2026-04-26"), "2026-04-20");
});

test("rejects malformed issue week input", () => {
  assert.throws(() => normalizeIsoWeekStart("2026/04/26"), /YYYY-MM-DD/);
});
