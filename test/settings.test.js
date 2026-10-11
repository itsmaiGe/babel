"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_SETTINGS, MODEL_PROVIDERS, TRANSLATION_STYLE_PRESETS } = require("../src/shared/defaults");
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
  assert.equal(settings.customPrompt, "");
  assert.equal(settings.sendTranslation.enterToSend, true);
  assert.equal(settings.sendBox.opacity, 1);
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

test("normalizeSettings drops a legacy interface language field", () => {
  const settings = normalizeSettings({ uiLanguage: "ja", enabled: false });
  assert.equal(Object.hasOwn(settings, "uiLanguage"), false);
  assert.equal(Object.hasOwn(DEFAULT_SETTINGS, "uiLanguage"), false);
  assert.equal(settings.enabled, false);
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

test("normalizeSettings drops a legacy cache switch and keeps stored color text", () => {
  const settings = normalizeSettings({
    persistCache: false,
    customPrompt: "unrelated",
    style: { backgroundColor: "#E8EDF8", textColor: " Auto " },
  });
  assert.equal(Object.hasOwn(settings, "persistCache"), false);
  assert.equal(settings.style.backgroundColor, "#E8EDF8");
  assert.equal(settings.style.textColor, "Auto");
  const again = normalizeSettings({ ...settings, customPrompt: "changed", persistCache: false });
  assert.equal(again.customPrompt, "changed");
  assert.equal(again.style.backgroundColor, "#E8EDF8");
  assert.equal(again.style.textColor, "Auto");
  assert.equal(Object.hasOwn(again, "persistCache"), false);
});

test("normalizeSettings keeps AI cache permanently enabled", () => {
  const settings = normalizeSettings({
    readTranslation: {
      cache: false
    }
  });

  assert.equal(settings.readTranslation.cache, true);
});

test("normalizeSettings remembers send box layout and opacity and ignores junk", () => {
  assert.deepEqual(normalizeSettings({}).sendBox, { x: null, y: null, width: null, opacity: 1 });
  assert.deepEqual(
    normalizeSettings({ sendBox: { x: 320, y: 540, width: 480, opacity: 0.7 } }).sendBox,
    { x: 320, y: 540, width: 480, opacity: 0.7 }
  );
  assert.deepEqual(
    normalizeSettings({ sendBox: { x: "left", y: NaN, width: -10, opacity: 8 } }).sendBox,
    { x: null, y: null, width: null, opacity: 1 }
  );
});

test("normalizeSettings keeps a bounded custom translation prompt", () => {
  assert.equal(TRANSLATION_STYLE_PRESETS.at(-1).value, "custom");
  assert.equal(normalizeSettings({ translationStyle: "custom", customPrompt: "  像游戏队友一样翻译  " }).customPrompt, "像游戏队友一样翻译");
  assert.equal(normalizeSettings({ customPrompt: 123 }).customPrompt, "");
  assert.equal(normalizeSettings({ customPrompt: "x".repeat(5000) }).customPrompt.length, 4000);
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

test("normalizeSettings accepts only supported translation positions", () => {
  assert.equal(normalizeSettings({ style: { position: "above" } }).style.position, "above");
  assert.equal(normalizeSettings({ style: { position: "below" } }).style.position, "below");
  assert.equal(
    normalizeSettings({ style: { position: "beside" } }).style.position,
    DEFAULT_SETTINGS.style.position
  );
});

test("normalizeSettings validates the API format against the provider's allowed formats", () => {
  assert.equal(normalizeSettings({ model: { provider: "openai" } }).model.protocol, "openai");
  assert.equal(normalizeSettings({ model: { provider: "openai", protocol: "responses" } }).model.protocol, "responses");
  assert.equal(normalizeSettings({ model: { provider: "openai", protocol: "anthropic" } }).model.protocol, "openai");
  assert.equal(normalizeSettings({ model: { provider: "anthropic" } }).model.protocol, "anthropic");
  assert.equal(normalizeSettings({ model: { provider: "anthropic", protocol: "openai" } }).model.protocol, "anthropic");
  for (const provider of ["google", "deepseek", "zhipu", "kimi", "openrouter", "ollama", "lmstudio"])
    assert.equal(normalizeSettings({ model: { provider, protocol: "responses" } }).model.protocol, "openai");
  assert.deepEqual(normalizeSettings({ model: { provider: "custom" } }).model.protocol, "openai");
});

test("a saved format wins; a Custom setting without one infers from the exact base path", () => {
  const infer = (baseUrl) => normalizeSettings({ model: { provider: "custom", baseUrl } }).model.protocol;
  assert.equal(infer("https://x.example/v1/messages"), "anthropic");
  assert.equal(infer("https://x.example/v1/responses"), "responses");
  assert.equal(infer("https://x.example/v1/chat/completions"), "openai");
  assert.equal(infer("https://x.example/v1/models"), "openai");
  assert.equal(infer("https://x.example/openai/deep/v3"), "openai");
  assert.equal(infer("https://x.example/v1/messages/v2"), "openai");
  assert.equal(infer("https://x.example/v1/Messages"), "openai");
  assert.equal(
    normalizeSettings({ model: { provider: "custom", baseUrl: "https://x.example/v1/messages", protocol: "openai" } }).model.protocol,
    "openai"
  );
  assert.equal(
    normalizeSettings({ model: { provider: "custom", baseUrl: "https://x.example/v1/responses", protocol: "anthropic" } }).model.protocol,
    "anthropic"
  );
  // Inference needs an absent format; a saved junk value falls back to the provider default.
  assert.equal(
    normalizeSettings({ model: { provider: "custom", baseUrl: "https://x.example/v1/messages", protocol: "banana" } }).model.protocol,
    "openai"
  );
  // An empty value is no saved format, so the trailing path decides.
  assert.equal(
    normalizeSettings({ model: { provider: "custom", baseUrl: "https://x.example/v1/messages", protocol: "" } }).model.protocol,
    "anthropic"
  );
});

test("normalizing never rewrites the stored base URL and stays idempotent", () => {
  const settings = normalizeSettings({ model: { provider: "custom", baseUrl: "https://x.example/v1/messages/" } });
  assert.equal(settings.model.baseUrl, "https://x.example/v1/messages/");
  assert.equal(settings.model.protocol, "anthropic");
  assert.deepEqual(normalizeSettings(settings), settings);
  assert.equal(DEFAULT_SETTINGS.model.protocol, "openai");
});
