"use strict";

const { DEFAULT_SETTINGS } = require("./defaults");

const TEXT_DECORATIONS = new Set(["none", "underline", "wavy"]);

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

function normalizeSettings(input) {
  const source = isObject(input) ? input : {};
  const next = clone(DEFAULT_SETTINGS);

  next.enabled = asBoolean(source.enabled, next.enabled);

  if (isObject(source.model)) {
    next.model.baseUrl = asString(source.model.baseUrl, next.model.baseUrl, 500);
    next.model.modelId = asString(source.model.modelId, next.model.modelId, 200);
    next.model.targetLanguage = asString(source.model.targetLanguage, next.model.targetLanguage, 80);
    next.model.sendLanguage = asString(source.model.sendLanguage, next.model.sendLanguage, 80);
    next.model.customReadPrompt = asString(source.model.customReadPrompt, next.model.customReadPrompt, 8000);
    next.model.customSendPrompt = asString(source.model.customSendPrompt, next.model.customSendPrompt, 8000);
  }

  if (isObject(source.readTranslation)) {
    next.readTranslation.enabled = asBoolean(source.readTranslation.enabled, next.readTranslation.enabled);
    next.readTranslation.cache = asBoolean(source.readTranslation.cache, next.readTranslation.cache);
    next.readTranslation.trigger = source.readTranslation.trigger === "doubleClick" ? "doubleClick" : next.readTranslation.trigger;
  }

  if (isObject(source.sendTranslation)) {
    next.sendTranslation.enabled = asBoolean(source.sendTranslation.enabled, next.sendTranslation.enabled);
    next.sendTranslation.enterToSend = asBoolean(source.sendTranslation.enterToSend, next.sendTranslation.enterToSend);
  }

  if (isObject(source.style)) {
    next.style.textDecoration = TEXT_DECORATIONS.has(source.style.textDecoration)
      ? source.style.textDecoration
      : next.style.textDecoration;
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
