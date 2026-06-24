"use strict";

const {
  DEFAULT_TRANSLATION_PROMPT,
  MODEL_PROVIDERS,
  TRANSLATION_STYLE_PRESETS
} = require("./defaults");

function buildChatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function buildAnthropicMessagesUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  return `${trimmed}/messages`;
}

function buildOpenAIModelsUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/models")) return trimmed;
  return `${trimmed}/models`;
}

function buildGeminiModelsUrl(apiKey, pageToken) {
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
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
  return TRANSLATION_STYLE_PRESETS.find(style => style.value === value) || TRANSLATION_STYLE_PRESETS[0];
}

function getProvider(value) {
  return MODEL_PROVIDERS.find(provider => provider.value === value) || MODEL_PROVIDERS[0];
}

function resolveModelConfig(model) {
  const provider = getProvider(model && model.provider);
  const isCustom = provider.value === "custom";
  return {
    provider: provider.value,
    protocol: provider.protocol || "openai",
    baseUrl: isCustom && model && model.baseUrl ? model.baseUrl : provider.baseUrl,
    modelId: model && model.modelId ? model.modelId : provider.defaultModel
  };
}

function buildTranslationMessages({ text, direction, settings }) {
  const targetLanguage = direction === "send"
    ? settings.model.sendLanguage
    : settings.model.targetLanguage;
  const style = getTranslationStyle(settings.translationStyle);

  return [
    {
      role: "system",
      content: applyPromptTemplate(DEFAULT_TRANSLATION_PROMPT, targetLanguage, style.instruction)
    },
    {
      role: "user",
      content: String(text || "")
    }
  ];
}

function parseOpenAICompatibleResponse(body) {
  const content = body &&
    Array.isArray(body.choices) &&
    body.choices[0] &&
    body.choices[0].message &&
    typeof body.choices[0].message.content === "string"
    ? body.choices[0].message.content
    : "";

  if (!content.trim()) {
    throw new Error("Model response did not include translated text.");
  }

  return content.trim();
}

function parseAnthropicResponse(body) {
  const content = body && Array.isArray(body.content)
    ? body.content
      .filter(part => part && part.type === "text" && typeof part.text === "string")
      .map(part => part.text)
      .join("")
    : "";

  if (!content.trim()) {
    throw new Error("Model response did not include translated text.");
  }

  return content.trim();
}

function parseModelListResponse(body, provider) {
  const providerId = String(provider || "");
  const rawModels = providerId === "google"
    ? body && Array.isArray(body.models) ? body.models : []
    : body && Array.isArray(body.data) ? body.data : [];
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
      label: modelLabel(item, value)
    });
  }

  return models;
}

function supportsGeminiGeneration(item) {
  const methods = Array.isArray(item.supportedGenerationMethods)
    ? item.supportedGenerationMethods
    : Array.isArray(item.supportedActions) ? item.supportedActions : null;
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
  return String(item.display_name || item.displayName || item.name || item.id || fallback)
    .replace(/^models\//, "")
    .trim();
}

module.exports = {
  applyPromptTemplate,
  buildAnthropicMessagesUrl,
  buildChatCompletionsUrl,
  buildGeminiModelsUrl,
  buildOpenAIModelsUrl,
  buildTranslationMessages,
  parseAnthropicResponse,
  parseModelListResponse,
  parseOpenAICompatibleResponse,
  resolveModelConfig
};
