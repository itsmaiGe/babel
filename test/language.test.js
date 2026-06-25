"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { dominantScript, textMatchesLanguage } = require("../src/shared/language");

test("dominantScript identifies the major script of a string", () => {
  assert.equal(dominantScript("你好世界"), "han");
  assert.equal(dominantScript("こんにちは"), "kana");
  assert.equal(dominantScript("안녕하세요"), "hangul");
  assert.equal(dominantScript("Привет мир"), "cyrillic");
  assert.equal(dominantScript("Hello world"), "latin");
  assert.equal(dominantScript("123 !!! ???"), "");
});

test("skip-same-language matches Chinese text against a Chinese target", () => {
  assert.equal(textMatchesLanguage("你好，今天过得怎么样？", "简体中文"), true);
  assert.equal(textMatchesLanguage("这是一条中文消息", "繁体中文"), true);
});

test("Japanese kana is not mistaken for Chinese, and matches a Japanese target", () => {
  // Mixed Han+Kana is Japanese, not Chinese — must NOT be skipped for a Chinese target.
  assert.equal(textMatchesLanguage("今日はいい天気ですね", "简体中文"), false);
  assert.equal(textMatchesLanguage("今日はいい天気ですね", "日语"), true);
});

test("Korean and Russian match their targets", () => {
  assert.equal(textMatchesLanguage("오늘 기분이 어때요", "韩语"), true);
  assert.equal(textMatchesLanguage("Как дела сегодня", "俄语"), true);
});

test("Latin-script targets never claim a match (cannot tell English from French)", () => {
  assert.equal(textMatchesLanguage("Hello there", "英语"), false);
  assert.equal(textMatchesLanguage("Bonjour le monde", "法语"), false);
});

test("empty or symbol-only text is never treated as same-language", () => {
  assert.equal(textMatchesLanguage("", "简体中文"), false);
  assert.equal(textMatchesLanguage("🙂🔥👍", "简体中文"), false);
  assert.equal(textMatchesLanguage("你好", "unknown-language"), false);
});
