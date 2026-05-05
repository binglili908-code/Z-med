import assert from "node:assert/strict";
import test from "node:test";

import { cleanTranslatedText, parseTranslationResult } from "../src/lib/paper-translation-result";

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

test("cleans plain translated text before it is saved", () => {
  assert.equal(
    cleanTranslatedText("[thinking]hidden reasoning[/thinking]\nfinal translated abstract"),
    "final translated abstract",
  );
});

test("cleans leading reasoning prose when a translation marker is present", () => {
  assert.equal(
    cleanTranslatedText("思考过程：先判断术语。\n最终译文：这是中文摘要。"),
    "这是中文摘要。",
  );
});
