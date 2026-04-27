import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonObjectFromModelOutput } from "../src/lib/model-json";

test("parses plain JSON object", () => {
  const parsed = parseJsonObjectFromModelOutput<{ ok: boolean }>('{"ok":true}');
  assert.equal(parsed.ok, true);
});

test("parses fenced JSON object", () => {
  const parsed = parseJsonObjectFromModelOutput<{ keywords: string[] }>(
    '```json\n{"keywords":["sepsis","icu"]}\n```',
  );
  assert.deepEqual(parsed.keywords, ["sepsis", "icu"]);
});

test("extracts first balanced object from noisy model output", () => {
  const parsed = parseJsonObjectFromModelOutput<{ journal: string }>(
    'Here is the JSON:\n{"journal":"European Journal of Vascular and Endovascular Surgery"}\nDone.',
  );
  assert.equal(parsed.journal, "European Journal of Vascular and Endovascular Surgery");
});

test("keeps braces inside JSON strings intact", () => {
  const parsed = parseJsonObjectFromModelOutput<{ note: string }>(
    'prefix {"note":"keep {braces} inside strings"} suffix',
  );
  assert.equal(parsed.note, "keep {braces} inside strings");
});

test("throws a labeled error for invalid JSON", () => {
  assert.throws(
    () => parseJsonObjectFromModelOutput("not json", "MiniMax preference response"),
    /MiniMax preference response was not valid JSON/,
  );
});
