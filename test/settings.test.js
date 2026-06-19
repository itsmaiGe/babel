"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_SETTINGS } = require("../src/shared/defaults");
const { normalizeSettings } = require("../src/shared/settings");

test("normalizeSettings fills missing values with safe defaults", () => {
  const settings = normalizeSettings({});

  assert.equal(settings.enabled, true);
  assert.equal(settings.model.baseUrl, DEFAULT_SETTINGS.model.baseUrl);
  assert.equal(settings.readTranslation.enabled, true);
  assert.equal(settings.sendTranslation.enabled, false);
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
