"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_SETTINGS, MODEL_PROVIDERS } = require("../src/shared/defaults");
const { normalizeSettings } = require("../src/shared/settings");

test("normalizeSettings fills missing values with safe defaults", () => {
  const settings = normalizeSettings({});

  assert.equal(settings.enabled, true);
  assert.equal(settings.model.provider, "openai");
  assert.equal(settings.model.baseUrl, DEFAULT_SETTINGS.model.baseUrl);
  assert.equal(settings.readTranslation.enabled, true);
  assert.equal(settings.sendTranslation.enabled, false);
  assert.equal(settings.autoTranslate.enabled, false);
  assert.equal(settings.autoTranslate.skipSameLanguage, true);
  assert.equal(settings.translationStyle, DEFAULT_SETTINGS.translationStyle);
});

test("normalizeSettings honors the auto-translate switch and forces skip-same-language on", () => {
  const on = normalizeSettings({ autoTranslate: { enabled: true } });
  assert.equal(on.autoTranslate.enabled, true);
  // Skip-same-language is always on — not user-configurable — even if stored false.
  assert.equal(on.autoTranslate.skipSameLanguage, true);
  assert.equal(normalizeSettings({ autoTranslate: { enabled: true, skipSameLanguage: false } }).autoTranslate.skipSameLanguage, true);
  assert.equal(normalizeSettings({ autoTranslate: { enabled: "yes" } }).autoTranslate.enabled, false);
  assert.equal(normalizeSettings({}).autoTranslate.skipSameLanguage, true);
});

test("normalizeSettings keeps double click translation enabled with the plugin", () => {
  const settings = normalizeSettings({
    readTranslation: {
      enabled: false,
      cache: false
    }
  });

  assert.equal(settings.readTranslation.enabled, true);
  assert.equal(settings.readTranslation.cache, true);
});

test("normalizeSettings keeps AI cache permanently enabled", () => {
  const settings = normalizeSettings({
    readTranslation: {
      cache: false
    }
  });

  assert.equal(settings.readTranslation.cache, true);
});

test("normalizeSettings remembers a custom send box position and width and ignores junk", () => {
  assert.deepEqual(normalizeSettings({}).sendBox, { x: null, y: null, width: null });
  assert.deepEqual(
    normalizeSettings({ sendBox: { x: 320, y: 540, width: 480 } }).sendBox,
    { x: 320, y: 540, width: 480 }
  );
  assert.deepEqual(
    normalizeSettings({ sendBox: { x: "left", y: NaN, width: -10 } }).sendBox,
    { x: null, y: null, width: null }
  );
});

test("normalizeSettings keeps style background toggle and emphasis within allowed values", () => {
  const defaults = normalizeSettings({});
  assert.equal(defaults.style.background, true);
  assert.equal(defaults.style.emphasis, "none");

  const custom = normalizeSettings({ style: { background: false, emphasis: "marker" } });
  assert.equal(custom.style.background, false);
  assert.equal(custom.style.emphasis, "marker");

  const junk = normalizeSettings({ style: { background: "yes", emphasis: "rainbow" } });
  assert.equal(junk.style.background, true);
  assert.equal(junk.style.emphasis, "none");
});

test("normalizeSettings applies known provider presets", () => {
  const settings = normalizeSettings({
    model: {
      provider: "deepseek",
      baseUrl: "https://wrong.example/v1",
      modelId: "deepseek-v4-pro"
    }
  });
  const provider = MODEL_PROVIDERS.find(item => item.value === "deepseek");

  assert.equal(settings.model.provider, "deepseek");
  assert.equal(settings.model.baseUrl, provider.baseUrl);
  assert.equal(settings.model.modelId, "deepseek-v4-pro");
});

test("normalizeSettings keeps live-fetched model ids for known providers", () => {
  const settings = normalizeSettings({
    model: {
      provider: "openai",
      modelId: "gpt-new-live-model"
    }
  });

  assert.equal(settings.model.provider, "openai");
  assert.equal(settings.model.modelId, "gpt-new-live-model");
});

test("normalizeSettings keeps custom provider base url and model id", () => {
  const settings = normalizeSettings({
    model: {
      provider: "custom",
      baseUrl: "https://llm.example/v1",
      modelId: "demo-model"
    }
  });

  assert.equal(settings.model.provider, "custom");
  assert.equal(settings.model.baseUrl, "https://llm.example/v1");
  assert.equal(settings.model.modelId, "demo-model");
});

test("normalizeSettings rejects unsupported translation style values", () => {
  const settings = normalizeSettings({
    translationStyle: "pirate"
  });

  assert.equal(settings.translationStyle, DEFAULT_SETTINGS.translationStyle);
});

test("normalizeSettings clamps numeric style values", () => {
  const settings = normalizeSettings({
    style: {
      borderRadius: 500,
      fontSize: 3
    }
  });

  assert.equal(settings.style.borderRadius, 24);
  assert.equal(settings.style.fontSize, 10);
});

test("normalizeSettings rejects unsupported text decoration values", () => {
  const settings = normalizeSettings({
    style: {
      textDecoration: "blink"
    }
  });

  assert.equal(settings.style.textDecoration, DEFAULT_SETTINGS.style.textDecoration);
});

test("normalizeSettings accepts extended text decoration values", () => {
  const settings = normalizeSettings({
    style: {
      textDecoration: "line-through"
    }
  });

  assert.equal(settings.style.textDecoration, "line-through");
});
