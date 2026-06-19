"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_SETTINGS } = require("../src/shared/defaults");
const {
  applyPromptTemplate,
  buildChatCompletionsUrl,
  buildTranslationMessages,
  parseOpenAICompatibleResponse
} = require("../src/shared/translate");

test("buildChatCompletionsUrl appends chat completions path", () => {
  assert.equal(
    buildChatCompletionsUrl("https://example.com/v1/"),
    "https://example.com/v1/chat/completions"
  );
});

test("buildChatCompletionsUrl does not duplicate chat completions path", () => {
  assert.equal(
    buildChatCompletionsUrl("https://example.com/v1/chat/completions"),
    "https://example.com/v1/chat/completions"
  );
});

test("applyPromptTemplate replaces target language token", () => {
  assert.equal(
    applyPromptTemplate("Translate to {{targetLanguage}}.", "Japanese"),
    "Translate to Japanese."
  );
});

test("buildTranslationMessages uses read and send target languages", () => {
  const readMessages = buildTranslationMessages({
    text: "hello",
    direction: "read",
    settings: DEFAULT_SETTINGS
  });
  const sendMessages = buildTranslationMessages({
    text: "你好",
    direction: "send",
    settings: DEFAULT_SETTINGS
  });

  assert.match(readMessages[0].content, /Chinese/);
  assert.match(sendMessages[0].content, /English/);
  assert.equal(readMessages[1].content, "hello");
  assert.equal(sendMessages[1].content, "你好");
});

test("parseOpenAICompatibleResponse returns translated text", () => {
  const text = parseOpenAICompatibleResponse({
    choices: [{ message: { content: "  translated text  " } }]
  });

  assert.equal(text, "translated text");
});
