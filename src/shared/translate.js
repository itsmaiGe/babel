"use strict";

const {
  DEFAULT_TRANSLATION_PROMPT,
  MODEL_PROVIDERS,
  TRANSLATION_STYLE_PRESETS,
  resolveProtocol,
} = require("./defaults");

// One trailing endpoint path is stripped before the selected format's own path
// is applied; any other subpath is kept. The selected format always wins over
// whatever path a saved base URL carries.
const GENERATION_PATHS = Object.freeze({
  openai: "/chat/completions",
  responses: "/responses",
  anthropic: "/messages",
});
const ENDPOINT_SUFFIXES = Object.freeze([
  "/chat/completions",
  "/responses",
  "/messages",
  "/models",
]);

function apiBase(baseUrl) {
  const trimmed = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      const stripped = trimmed.slice(0, -suffix.length).replace(/\/+$/, "");
      return stripped || trimmed;
    }
  }
  return trimmed;
}

function buildGenerationUrl(baseUrl, protocol) {
  return `${apiBase(baseUrl)}${GENERATION_PATHS[protocol] || GENERATION_PATHS.openai}`;
}

function buildChatCompletionsUrl(baseUrl) {
  return buildGenerationUrl(baseUrl, "openai");
}

function buildAnthropicMessagesUrl(baseUrl) {
  return buildGenerationUrl(baseUrl, "anthropic");
}

function buildResponsesUrl(baseUrl) {
  return buildGenerationUrl(baseUrl, "responses");
}

function buildOpenAIModelsUrl(baseUrl) {
  return `${apiBase(baseUrl)}/models`;
}

function buildGeminiModelsUrl(apiKey, pageToken) {
  const url = new URL(
    "https://generativelanguage.googleapis.com/v1beta/models",
  );
  url.searchParams.set("pageSize", "1000");
  if (apiKey) url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

function applyPromptTemplate(template, targetLanguage, styleInstruction = "") {
  return String(template || "")
    .replace(/\{\{targetLanguage\}\}/g, targetLanguage)
    .replace(/\{\{styleInstruction\}\}/g, styleInstruction);
}

function getTranslationStyle(value) {
  return (
    TRANSLATION_STYLE_PRESETS.find((style) => style.value === value) ||
    TRANSLATION_STYLE_PRESETS[0]
  );
}

function getProvider(value) {
  return (
    MODEL_PROVIDERS.find((provider) => provider.value === value) ||
    MODEL_PROVIDERS[0]
  );
}

function resolveModelConfig(model) {
  const provider = getProvider(model && model.provider);
  const isCustom = provider.value === "custom";
  return {
    provider: provider.value,
    protocol: resolveProtocol(provider, model),
    baseUrl:
      isCustom && model && model.baseUrl ? model.baseUrl : provider.baseUrl,
    modelId: model && model.modelId ? model.modelId : provider.defaultModel,
  };
}

function buildTranslationMessages({ text, direction, settings }) {
  const targetLanguage =
    direction === "send"
      ? settings.model.sendLanguage
      : settings.model.targetLanguage;
  const style = getTranslationStyle(settings.translationStyle);
  const styleInstruction =
    style.value === "custom"
      ? String(settings.customPrompt || "").trim() ||
        TRANSLATION_STYLE_PRESETS[0].instruction
      : style.instruction;

  return [
    {
      role: "system",
      content: applyPromptTemplate(
        DEFAULT_TRANSLATION_PROMPT,
        targetLanguage,
        styleInstruction,
      ),
    },
    {
      role: "user",
      content: String(text || ""),
    },
  ];
}

// Bounded machine signals from provider error bodies. They classify failures
// only; they are never rendered and never leave the process.
function boundedProviderField(value) {
  if (typeof value === "number" || typeof value === "boolean")
    value = String(value);
  return typeof value === "string" ? value.slice(0, 200) : "";
}

const TEMPORARY_RATE_CODE =
  /^(?:rate_limit_exceeded|rate_limit|too_many_requests|requests|slow_down)$/i;
const QUOTA_CODE =
  /insufficient[_ -]?quota|insufficient[_ -]?funds|billing|payment_required|credit_balance|out_of_credits|exceeded_quota/i;
const QUOTA_TEXT = /insufficient|balance|billing|credit|余额|额度/i;

function providerSignals(body) {
  const codes = [];
  const texts = [];
  const take = (value, into) => {
    const text = boundedProviderField(value);
    if (text) into.push(text);
  };
  if (!body || typeof body !== "object") return { codes, texts };
  take(body.code, codes);
  take(body.type, codes);
  take(body.message, texts);
  const error = body.error;
  if (typeof error === "string") take(error, texts);
  else if (error && typeof error === "object") {
    take(error.code, codes);
    take(error.type, codes);
    take(error.message, texts);
  }
  return { codes, texts };
}

function quotaSignal(body) {
  const { codes, texts } = providerSignals(body);
  // A known temporary rate-limit code wins over the word "quota" in its message.
  if (codes.some((code) => TEMPORARY_RATE_CODE.test(code))) return false;
  if (codes.some((code) => QUOTA_CODE.test(code))) return true;
  return texts.some((text) => QUOTA_TEXT.test(text));
}

// Response outcomes: the code carries the class, the reason the specific
// outcome. No provider text or partial output is ever kept or cached.
function outcomeFailure(code, reason) {
  return Object.assign(new Error(`translation outcome: ${reason}`), {
    code,
    reason,
  });
}

function unexpectedResponse() {
  return outcomeFailure("CONFIG", "UNEXPECTED_RESPONSE");
}
function incompleteResponse() {
  return outcomeFailure("NETWORK", "INCOMPLETE");
}
function refusedResponse() {
  return outcomeFailure("NETWORK", "REFUSED");
}
function emptyResponse() {
  return outcomeFailure("NETWORK", "EMPTY_RESPONSE");
}
function failedResponse() {
  return outcomeFailure("NETWORK", "RESPONSE_FAILED");
}

function hasSignal(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value) && typeof value === "object";
}

// Chat Completions: the reply must carry a choices[0].message object. Text is
// returned literally (trimmed only); structured reasoning is never requested
// and never rendered.
function parseOpenAICompatibleResponse(body) {
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  const message = choice && typeof choice === "object" ? choice.message : null;
  if (!message || typeof message !== "object" || Array.isArray(message))
    throw unexpectedResponse();
  if (hasSignal(message.refusal)) throw refusedResponse();
  const finish = choice.finish_reason;
  if (hasSignal(message.tool_calls)) throw incompleteResponse();
  if (finish === "content_filter") throw refusedResponse();
  if (finish !== "stop" && finish !== null && finish !== undefined)
    throw incompleteResponse();
  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (!content) throw emptyResponse();
  return content;
}

// Responses: the reply must carry an output array and a string status. Text is
// collected from every output_text part of every message item; the parser
// never assumes output[0] is text. Reasoning items are ignored.
function parseResponsesResponse(body) {
  if (!body || !Array.isArray(body.output) || typeof body.status !== "string")
    throw unexpectedResponse();
  const status = body.status;
  if (status === "completed") {
    const parts = [];
    for (const item of body.output) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw incompleteResponse();
      const type = typeof item.type === "string" ? item.type : "";
      if (type === "reasoning") continue;
      if (type !== "message") throw incompleteResponse();
      if (!Array.isArray(item.content)) throw incompleteResponse();
      for (const part of item.content) {
        if (!part || typeof part !== "object" || Array.isArray(part))
          throw incompleteResponse();
        if (hasSignal(part.refusal)) throw refusedResponse();
        const partType = typeof part.type === "string" ? part.type : "";
        if (partType === "refusal") throw refusedResponse();
        if (partType !== "output_text") throw incompleteResponse();
        if (typeof part.text !== "string") throw incompleteResponse();
        parts.push(part.text);
      }
    }
    const content = parts.join("").trim();
    if (!content) throw emptyResponse();
    return content;
  }
  if (status === "incomplete") {
    const details = body.incomplete_details;
    const reason =
      details && typeof details === "object" && !Array.isArray(details)
        ? details.reason
        : null;
    if (reason === "content_filter") throw refusedResponse();
    throw incompleteResponse();
  }
  if (status === "failed") {
    const error = body.error;
    const code =
      error && typeof error === "object" && !Array.isArray(error)
        ? boundedProviderField(error.code)
        : "";
    // Only certain machine codes are classified here; anything else is neutral.
    if (/^rate_limit_exceeded$/i.test(code))
      throw Object.assign(
        new Error("translation outcome: RATE_LIMIT"),
        quotaSignal(body)
          ? { code: "RATE_LIMIT", reason: "QUOTA" }
          : { code: "RATE_LIMIT" },
      );
    if (/^server_error$/i.test(code))
      throw outcomeFailure("NETWORK", "PROVIDER_TEMPORARY");
    throw failedResponse();
  }
  throw incompleteResponse();
}

// Messages: the reply must carry a content array. Thinking blocks are ignored;
// text blocks are joined literally (trimmed only).
function parseAnthropicResponse(body) {
  if (!body || !Array.isArray(body.content)) throw unexpectedResponse();
  const stop = body.stop_reason;
  if (stop === "max_tokens" || stop === "model_context_window_exceeded")
    throw incompleteResponse();
  if (stop === "refusal") throw refusedResponse();
  if (stop !== "end_turn" && stop !== "stop_sequence" && stop !== null && stop !== undefined)
    throw incompleteResponse();
  const parts = [];
  for (const block of body.content) {
    if (!block || typeof block !== "object" || Array.isArray(block))
      throw incompleteResponse();
    const type = typeof block.type === "string" ? block.type : "";
    if (type === "thinking" || type === "redacted_thinking") continue;
    if (type !== "text") throw incompleteResponse();
    if (typeof block.text !== "string") throw incompleteResponse();
    parts.push(block.text);
  }
  const content = parts.join("").trim();
  if (!content) throw emptyResponse();
  return content;
}

function parseModelListResponse(body, provider) {
  const providerId = String(provider || "");
  const rawModels =
    providerId === "google"
      ? body && Array.isArray(body.models)
        ? body.models
        : []
      : body && Array.isArray(body.data)
        ? body.data
        : [];
  const seen = new Set();
  const models = [];

  for (const item of rawModels) {
    if (!item || typeof item !== "object") continue;
    if (providerId === "google" && !supportsGeminiGeneration(item)) continue;

    const value = modelValue(item, providerId);
    if (!value || seen.has(value)) continue;
    seen.add(value);

    models.push({
      value,
      label: modelLabel(item, value),
    });
  }

  return models;
}

function supportsGeminiGeneration(item) {
  const methods = Array.isArray(item.supportedGenerationMethods)
    ? item.supportedGenerationMethods
    : Array.isArray(item.supportedActions)
      ? item.supportedActions
      : null;
  if (!methods) return true;
  return methods.includes("generateContent");
}

function modelValue(item, provider) {
  if (provider === "google") {
    return String(item.baseModelId || item.name || item.id || "")
      .replace(/^models\//, "")
      .trim();
  }

  return String(item.id || item.name || "")
    .replace(/^models\//, "")
    .trim();
}

function modelLabel(item, fallback) {
  return String(
    item.display_name || item.displayName || item.name || item.id || fallback,
  )
    .replace(/^models\//, "")
    .trim();
}

module.exports = {
  apiBase,
  applyPromptTemplate,
  buildAnthropicMessagesUrl,
  buildChatCompletionsUrl,
  buildGenerationUrl,
  buildGeminiModelsUrl,
  buildOpenAIModelsUrl,
  buildResponsesUrl,
  buildTranslationMessages,
  parseAnthropicResponse,
  parseModelListResponse,
  parseOpenAICompatibleResponse,
  parseResponsesResponse,
  providerSignals,
  quotaSignal,
  resolveModelConfig,
};
