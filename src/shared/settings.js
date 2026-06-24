"use strict";

const { DEFAULT_SETTINGS, MODEL_PROVIDERS, TRANSLATION_STYLE_PRESETS } = require("./defaults");

const TEXT_DECORATIONS = new Set(["none", "underline", "wavy", "dotted", "dashed", "double", "line-through"]);
const STYLE_EMPHASES = new Set(["none", "bold", "light", "marker", "underline", "wavy", "strike"]);
const PROVIDER_IDS = new Set(MODEL_PROVIDERS.map(provider => provider.value));
const TRANSLATION_STYLE_IDS = new Set(TRANSLATION_STYLE_PRESETS.map(style => style.value));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value, fallback, maxLength = 4000) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, maxLength);
}

function asNumber(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function providerById(value) {
  return MODEL_PROVIDERS.find(provider => provider.value === value) || MODEL_PROVIDERS[0];
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function inferProviderId(modelSource) {
  if (!isObject(modelSource)) return DEFAULT_SETTINGS.model.provider;
  if (PROVIDER_IDS.has(modelSource.provider)) return modelSource.provider;

  const sourceBaseUrl = normalizeUrl(modelSource.baseUrl);
  if (!sourceBaseUrl) return DEFAULT_SETTINGS.model.provider;

  const matched = MODEL_PROVIDERS.find(provider => provider.value !== "custom" && normalizeUrl(provider.baseUrl) === sourceBaseUrl);
  return matched ? matched.value : "custom";
}

function normalizeSettings(input) {
  const source = isObject(input) ? input : {};
  const next = clone(DEFAULT_SETTINGS);

  next.enabled = asBoolean(source.enabled, next.enabled);
  next.translationStyle = TRANSLATION_STYLE_IDS.has(source.translationStyle)
    ? source.translationStyle
    : next.translationStyle;

  if (isObject(source.model)) {
    const provider = providerById(inferProviderId(source.model));
    next.model.provider = provider.value;
    if (provider.value === "custom") {
      next.model.baseUrl = asString(source.model.baseUrl, provider.baseUrl, 500);
      next.model.modelId = asString(source.model.modelId, provider.defaultModel, 200);
    } else {
      next.model.baseUrl = provider.baseUrl;
      next.model.modelId = asString(source.model.modelId, provider.defaultModel, 200);
    }
    next.model.targetLanguage = asString(source.model.targetLanguage, next.model.targetLanguage, 80);
    next.model.sendLanguage = asString(source.model.sendLanguage, next.model.sendLanguage, 80);
  }

  if (isObject(source.readTranslation)) {
    next.readTranslation.enabled = true;
    next.readTranslation.cache = true;
    next.readTranslation.trigger = source.readTranslation.trigger === "doubleClick" ? "doubleClick" : next.readTranslation.trigger;
  }

  if (isObject(source.sendTranslation)) {
    next.sendTranslation.enabled = asBoolean(source.sendTranslation.enabled, next.sendTranslation.enabled);
    next.sendTranslation.enterToSend = asBoolean(source.sendTranslation.enterToSend, next.sendTranslation.enterToSend);
  }

  if (isObject(source.sendBox)) {
    next.sendBox.x = Number.isFinite(source.sendBox.x) ? source.sendBox.x : next.sendBox.x;
    next.sendBox.y = Number.isFinite(source.sendBox.y) ? source.sendBox.y : next.sendBox.y;
    next.sendBox.width = Number.isFinite(source.sendBox.width) && source.sendBox.width > 0
      ? source.sendBox.width
      : next.sendBox.width;
  }

  if (isObject(source.style)) {
    next.style.textDecoration = TEXT_DECORATIONS.has(source.style.textDecoration)
      ? source.style.textDecoration
      : next.style.textDecoration;
    next.style.background = asBoolean(source.style.background, next.style.background);
    next.style.emphasis = STYLE_EMPHASES.has(source.style.emphasis) ? source.style.emphasis : next.style.emphasis;
    next.style.backgroundColor = asString(source.style.backgroundColor, next.style.backgroundColor, 40);
    next.style.textColor = asString(source.style.textColor, next.style.textColor, 40);
    next.style.borderRadius = asNumber(source.style.borderRadius, next.style.borderRadius, 0, 24);
    next.style.fontFamily = asString(source.style.fontFamily, next.style.fontFamily, 120);
    next.style.fontSize = asNumber(source.style.fontSize, next.style.fontSize, 10, 24);
  }

  return next;
}

module.exports = {
  normalizeSettings
};
