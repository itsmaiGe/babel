"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_SETTINGS } = require("../src/shared/defaults");
const { normalizeSettings } = require("../src/shared/settings");
const {
  apiBase,
  applyPromptTemplate,
  buildAnthropicMessagesUrl,
  buildChatCompletionsUrl,
  buildGeminiModelsUrl,
  buildGenerationUrl,
  buildOpenAIModelsUrl,
  buildResponsesUrl,
  buildTranslationMessages,
  parseModelListResponse,
  parseAnthropicResponse,
  parseOpenAICompatibleResponse,
  parseResponsesResponse
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

test("buildTranslationMessages uses the custom prompt only for the custom style", () => {
  const custom = normalizeSettings({
    translationStyle: "custom",
    customPrompt: "使用海盗口吻，但不要改动代码块"
  });
  const customMessages = buildTranslationMessages({ text: "hello", direction: "read", settings: custom });
  assert.match(customMessages[0].content, /使用海盗口吻，但不要改动代码块/);
  assert.match(customMessages[0].content, /简体中文/);
  assert.match(customMessages[0].content, /只返回翻译后的文本/);

  const preset = normalizeSettings({ translationStyle: "natural", customPrompt: "不应出现" });
  const presetMessages = buildTranslationMessages({ text: "hello", direction: "read", settings: preset });
  assert.doesNotMatch(presetMessages[0].content, /不应出现/);
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

test("apiBase strips one known endpoint path and keeps every other subpath", () => {
  assert.equal(apiBase("https://example.com/v1/"), "https://example.com/v1");
  assert.equal(apiBase("https://example.com/v1/chat/completions"), "https://example.com/v1");
  assert.equal(apiBase("https://example.com/v1/responses"), "https://example.com/v1");
  assert.equal(apiBase("https://example.com/v1/messages"), "https://example.com/v1");
  assert.equal(apiBase("https://example.com/v1/models"), "https://example.com/v1");
  assert.equal(apiBase("https://example.com/openai/deep/v3"), "https://example.com/openai/deep/v3");
  assert.equal(apiBase("https://example.com/v1/messages/chat/completions"), "https://example.com/v1/messages");
});

test("the selected format always wins over any path in the base URL", () => {
  assert.equal(buildChatCompletionsUrl("https://example.com/v1/messages"), "https://example.com/v1/chat/completions");
  assert.equal(buildResponsesUrl("https://example.com/v1/chat/completions"), "https://example.com/v1/responses");
  assert.equal(buildAnthropicMessagesUrl("https://example.com/v1/responses"), "https://example.com/v1/messages");
  assert.equal(buildGenerationUrl("https://example.com/v1/models", "anthropic"), "https://example.com/v1/messages");
  assert.equal(buildGenerationUrl("https://example.com/openai/deep/v3", "responses"), "https://example.com/openai/deep/v3/responses");
});

test("model lists are requested at {apiBase}/models outside Gemini", () => {
  assert.equal(buildOpenAIModelsUrl("https://example.com/v1/chat/completions"), "https://example.com/v1/models");
  assert.equal(buildOpenAIModelsUrl("https://example.com/v1/responses"), "https://example.com/v1/models");
  assert.equal(buildOpenAIModelsUrl("https://example.com/v1/messages"), "https://example.com/v1/models");
  assert.equal(buildOpenAIModelsUrl("https://example.com/v1/models"), "https://example.com/v1/models");
  assert.equal(buildOpenAIModelsUrl("https://example.com/openai/deep/v3"), "https://example.com/openai/deep/v3/models");
});

test("Chat Completions outcomes follow the compatibility contract", () => {
  const chat = parseOpenAICompatibleResponse;
  assert.equal(chat({ choices: [{ message: { content: "translated" }, finish_reason: "stop" }] }), "translated");
  assert.equal(chat({ choices: [{ message: { content: "translated" }, finish_reason: null }] }), "translated");
  assert.equal(chat({ choices: [{ message: { content: "translated" } }] }), "translated");
  assert.throws(() => chat({}), { code: "CONFIG", reason: "UNEXPECTED_RESPONSE" });
  assert.throws(() => chat({ choices: [] }), { code: "CONFIG", reason: "UNEXPECTED_RESPONSE" });
  assert.throws(() => chat({ choices: [{ message: "not-an-object" }] }), { code: "CONFIG", reason: "UNEXPECTED_RESPONSE" });
  assert.throws(() => chat({ choices: [{ content: "no message wrapper" }] }), { code: "CONFIG", reason: "UNEXPECTED_RESPONSE" });
  assert.throws(() => chat({ choices: [{ message: { content: "done", refusal: "I cannot help." } }] }), { code: "NETWORK", reason: "REFUSED" });
  assert.throws(() => chat({ choices: [{ message: { content: "partial", tool_calls: [{ id: "x" }] }, finish_reason: "stop" }] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => chat({ choices: [{ message: { content: "partial" }, finish_reason: "tool_calls" }] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => chat({ choices: [{ message: { content: "partial" }, finish_reason: "function_call" }] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => chat({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => chat({ choices: [{ message: { content: "blocked" }, finish_reason: "content_filter" }] }), { code: "NETWORK", reason: "REFUSED" });
  assert.throws(() => chat({ choices: [{ message: { content: "partial" }, finish_reason: "unexpected_final" }] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => chat({ choices: [{ message: { content: "   " }, finish_reason: "stop" }] }), { code: "NETWORK", reason: "EMPTY_RESPONSE" });
  assert.throws(() => chat({ choices: [{ message: { content: ["array parts"] }, finish_reason: "stop" }] }), { code: "NETWORK", reason: "EMPTY_RESPONSE" });
});

test("Chat Completions keeps content literal and ignores separate reasoning fields", () => {
  const literal = "  <think>hidden scratch</think>\n```js\nkeep();\n```\n译文  ";
  assert.equal(
    parseOpenAICompatibleResponse({
      choices: [{
        message: {
          content: literal,
          reasoning_content: "chain of thought",
          reasoning: "more thought"
        },
        finish_reason: "stop"
      }]
    }),
    literal.trim()
  );
});

test("Responses outcomes follow the compatibility contract", () => {
  const responses = parseResponsesResponse;
  assert.equal(responses({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: " done " }] }] }), "done");
  assert.throws(() => responses({ output: [] }), { code: "CONFIG", reason: "UNEXPECTED_RESPONSE" });
  assert.throws(() => responses({ status: "completed" }), { code: "CONFIG", reason: "UNEXPECTED_RESPONSE" });
  assert.throws(() => responses({ status: 3, output: [] }), { code: "CONFIG", reason: "UNEXPECTED_RESPONSE" });
  assert.throws(() => responses({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }, { type: "message", content: [{ type: "refusal", refusal: "no" }] }] }), { code: "NETWORK", reason: "REFUSED" });
  assert.throws(() => responses({ status: "completed", output: [{ type: "function_call", name: "x" }] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => responses({ status: "completed", output: [{ type: "message", content: [] }] }), { code: "NETWORK", reason: "EMPTY_RESPONSE" });
  assert.throws(() => responses({ status: "incomplete", output: [] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => responses({ status: "incomplete", output: [], incomplete_details: { reason: "max_output_tokens" } }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => responses({ status: "incomplete", output: [], incomplete_details: { reason: "content_filter" } }), { code: "NETWORK", reason: "REFUSED" });
  assert.throws(() => responses({ status: "failed", output: [], error: { code: "rate_limit_exceeded" } }), { code: "RATE_LIMIT" });
  assert.throws(() => responses({ status: "failed", output: [], error: { code: "server_error" } }), { code: "NETWORK", reason: "PROVIDER_TEMPORARY" });
  assert.throws(() => responses({ status: "failed", output: [], error: { code: "unknown_failure" } }), { code: "NETWORK", reason: "RESPONSE_FAILED" });
  assert.throws(() => responses({ status: "failed", output: [] }), { code: "NETWORK", reason: "RESPONSE_FAILED" });
  for (const status of ["queued", "in_progress", "cancelled", "unexpected"])
    assert.throws(() => responses({ status, output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }] }), { code: "NETWORK", reason: "INCOMPLETE" });
});

test("Responses failed rate limits keep the existing quota signal semantics", () => {
  try {
    parseResponsesResponse({ status: "failed", output: [], error: { code: "rate_limit_exceeded" } });
    assert.fail("expected a rate limit failure");
  } catch (error) {
    assert.deepEqual([error.code, error.reason], ["RATE_LIMIT", undefined]);
  }
  // The QUOTA upgrade is wired to the existing quotaSignal, whose documented
  // precedence keeps a known temporary rate code ahead of quota wording, so an
  // exact rate_limit_exceeded code stays a plain RATE_LIMIT.
  try {
    parseResponsesResponse({ status: "failed", output: [], error: { code: "rate_limit_exceeded", message: "insufficient_quota" } });
    assert.fail("expected a rate limit failure");
  } catch (error) {
    assert.deepEqual([error.code, error.reason], ["RATE_LIMIT", undefined]);
    assert.equal(String(error.message).includes("insufficient_quota"), false);
  }
});

test("Responses joins every message item and never assumes output[0] is text", () => {
  const text = parseResponsesResponse({
    status: "completed",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
      { type: "message", content: [{ type: "output_text", text: "第一段 " }] },
      { type: "reasoning", content: [{ type: "output_text", text: "ignored" }] },
      { type: "message", content: [{ type: "output_text", text: "第二段" }] }
    ]
  });
  assert.equal(text, "第一段 第二段");
  assert.throws(() => parseResponsesResponse({ status: "completed", output: ["not-an-item"] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => parseResponsesResponse({ status: "completed", output: [{ type: "message", content: "not-an-array" }] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => parseResponsesResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: 5 }] }] }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => parseResponsesResponse({ status: "completed", output: [{ type: "message", content: [{ type: "unknown_part" }] }] }), { code: "NETWORK", reason: "INCOMPLETE" });
});

test("Messages outcomes follow the compatibility contract", () => {
  const messages = parseAnthropicResponse;
  assert.equal(messages({ content: [{ type: "text", text: " done " }], stop_reason: "end_turn" }), "done");
  assert.equal(messages({ content: [{ type: "text", text: "done" }], stop_reason: "stop_sequence" }), "done");
  assert.equal(messages({ content: [{ type: "text", text: "done" }], stop_reason: null }), "done");
  assert.equal(messages({ content: [{ type: "text", text: "done" }] }), "done");
  assert.throws(() => messages({ stop_reason: "end_turn" }), { code: "CONFIG", reason: "UNEXPECTED_RESPONSE" });
  assert.throws(() => messages({ content: [], stop_reason: "end_turn" }), { code: "NETWORK", reason: "EMPTY_RESPONSE" });
  assert.throws(() => messages({ content: [{ type: "text", text: "partial" }], stop_reason: "max_tokens" }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => messages({ content: [{ type: "text", text: "partial" }], stop_reason: "model_context_window_exceeded" }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => messages({ content: [{ type: "text", text: "no" }], stop_reason: "refusal" }), { code: "NETWORK", reason: "REFUSED" });
  for (const stop of ["tool_use", "pause_turn", "unexpected_final"])
    assert.throws(() => messages({ content: [{ type: "text", text: "partial" }], stop_reason: stop }), { code: "NETWORK", reason: "INCOMPLETE" });
});

test("Messages keeps text literal and ignores thinking blocks", () => {
  const literal = "  <think>scratch</think>\n保持原样  ";
  assert.equal(
    parseAnthropicResponse({
      content: [
        { type: "thinking", thinking: "deliberation", signature: "sig" },
        { type: "redacted_thinking", data: "opaque" },
        { type: "text", text: literal }
      ],
      stop_reason: "end_turn"
    }),
    literal.trim()
  );
  assert.throws(() => parseAnthropicResponse({ content: ["not-a-block"], stop_reason: "end_turn" }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => parseAnthropicResponse({ content: [{ type: "text", text: 5 }], stop_reason: "end_turn" }), { code: "NETWORK", reason: "INCOMPLETE" });
  assert.throws(() => parseAnthropicResponse({ content: [{ type: "tool_use", name: "x" }], stop_reason: "end_turn" }), { code: "NETWORK", reason: "INCOMPLETE" });
});
