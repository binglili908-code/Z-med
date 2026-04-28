import assert from "node:assert/strict";
import test from "node:test";

import { parseTranslationResult } from "../src/lib/paper-translation-result";

test("parses translation JSON from noisy model output", () => {
  const parsed = parseTranslationResult(`
    <think>internal reasoning should not be shown</think>
    {"title_zh":"中文标题","abstract_zh":"中文摘要"}
  `);

  assert.deepEqual(parsed, {
    titleZh: "中文标题",
    abstractZh: "中文摘要",
  });
});

test("strips think blocks inside translation fields", () => {
  const parsed = parseTranslationResult(
    JSON.stringify({
      title_zh: "中文标题",
      abstract_zh: "<think>hidden reasoning</think>真正的中文摘要",
    }),
  );

  assert.equal(parsed.abstractZh, "真正的中文摘要");
});

test("rejects non-JSON translation output instead of exposing raw model text", () => {
  assert.throws(
    () => parseTranslationResult("<think>analysis</think>中文摘要"),
    /MiniMax translation response was not valid JSON/,
  );
});
