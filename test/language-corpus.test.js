"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { hasLetters, textMatchesLanguage } = require("../src/shared/language");
for (const [text, target, match] of [
  ["好", "简体中文", false],
  ["你好", "简体中文", false],
  ["你好世界", "简体中文", true],
  ["你好世界 hello", "简体中文", false],
  ["你好世界 مرحبا بالعالم", "简体中文", false],
  ["https://example.com/你好世界 `你好世界` 😀", "简体中文", false],
  ["こんにちは世界", "日语", true],
  ["日本語", "日语", false],
  ["Привет мир", "俄语", true],
  ["안녕하세요 여러분", "韩语", true],
  ["bonjour le monde", "法语", false],
  ["Hello world", "英语", false],
])
  test(`language corpus: ${text}`, () =>
    assert.equal(textMatchesLanguage(text, target), match));
for (const text of [
  "123 😀 ✅",
  "https://example.com/hello",
  "```js\nhello\n```",
  "`hello`",
])
  test(`auto skips non-prose: ${text}`, () =>
    assert.equal(hasLetters(text), false));
