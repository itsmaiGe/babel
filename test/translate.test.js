"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_SETTINGS } = require("../src/shared/defaults");
const { normalizeSettings } = require("../src/shared/settings");
const {
  applyPromptTemplate,
  buildAnthropicMessagesUrl,
  buildChatCompletionsUrl,
  buildGeminiModelsUrl,
  buildOpenAIModelsUrl,
  buildTranslationMessages,
  parseModelListResponse,
  parseAnthropicResponse,
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

test("buildOpenAIModelsUrl appends models path", () => {
  assert.equal(
    buildOpenAIModelsUrl("https://example.com/v1/"),
    "https://example.com/v1/models"
  );
});

test("buildOpenAIModelsUrl does not duplicate models path", () => {
  assert.equal(
    buildOpenAIModelsUrl("https://example.com/v1/models"),
    "https://example.com/v1/models"
  );
});

test("buildGeminiModelsUrl uses Gemini native models endpoint", () => {
  const url = new URL(buildGeminiModelsUrl("gemini-key"));

  assert.equal(url.origin + url.pathname, "https://generativelanguage.googleapis.com/v1beta/models");
  assert.equal(url.searchParams.get("key"), "gemini-key");
  assert.equal(url.searchParams.get("pageSize"), "1000");
});

test("applyPromptTemplate replaces target language token", () => {
  assert.equal(
    applyPromptTemplate("Translate to {{targetLanguage}}.", "Japanese"),
    "Translate to Japanese."
  );
});

test("applyPromptTemplate replaces style instruction token", () => {
  assert.equal(
    applyPromptTemplate("{{targetLanguage}} / {{styleInstruction}}", "英语", "自然口语"),
    "英语 / 自然口语"
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

  assert.match(readMessages[0].content, /简体中文/);
  assert.match(sendMessages[0].content, /英语/);
  assert.equal(readMessages[1].content, "hello");
  assert.equal(sendMessages[1].content, "你好");
});

test("buildTranslationMessages uses one shared translation style", () => {
  const settings = normalizeSettings({
    translationStyle: "casual",
    model: {
      targetLanguage: "简体中文",
      sendLanguage: "英语",
      customReadPrompt: "old read prompt",
      customSendPrompt: "old send prompt"
    }
  });
  const readMessages = buildTranslationMessages({
    text: "hello",
    direction: "read",
    settings
  });
  const sendMessages = buildTranslationMessages({
    text: "你好",
    direction: "send",
    settings
  });

  assert.match(readMessages[0].content, /口语/);
  assert.match(sendMessages[0].content, /口语/);
  assert.doesNotMatch(readMessages[0].content, /old read prompt/);
  assert.doesNotMatch(sendMessages[0].content, /old send prompt/);
});

test("buildAnthropicMessagesUrl appends messages path", () => {
  assert.equal(
    buildAnthropicMessagesUrl("https://api.anthropic.com/v1"),
    "https://api.anthropic.com/v1/messages"
  );
});

test("parseOpenAICompatibleResponse returns translated text", () => {
  const text = parseOpenAICompatibleResponse({
    choices: [{ message: { content: "  translated text  " } }]
  });

  assert.equal(text, "translated text");
});

test("parseAnthropicResponse returns translated text", () => {
  const text = parseAnthropicResponse({
    content: [
      { type: "text", text: "  你好  " }
    ]
  });

  assert.equal(text, "你好");
});

test("parseModelListResponse parses OpenAI-compatible model lists", () => {
  const models = parseModelListResponse({
    data: [
      { id: "model-a" },
      { id: "model-b", name: "Model B" }
    ]
  }, "openai");

  assert.deepEqual(models, [
    { value: "model-a", label: "model-a" },
    { value: "model-b", label: "Model B" }
  ]);
});

test("parseModelListResponse parses Gemini models and keeps generateContent models", () => {
  const models = parseModelListResponse({
    models: [
      {
        name: "models/gemini-3.5-flash",
        baseModelId: "gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        supportedGenerationMethods: ["generateContent"]
      },
      {
        name: "models/text-embedding-004",
        baseModelId: "text-embedding-004",
        supportedGenerationMethods: ["embedContent"]
      }
    ]
  }, "google");

  assert.deepEqual(models, [
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" }
  ]);
});
