"use strict";
const { UI_LOCALES } = require("../../shared-loader")("ui-locale");
const catalogs = { en: require("./messages/en"), "zh-Hans": require("./messages/zh-Hans"), "zh-Hant": require("./messages/zh-Hant"), ja: require("./messages/ja") };
const { MESSAGES, sanitizeError } = require("../../core/errors");
let locale = "en", testCatalog = null;
function setLocale(value) { locale = UI_LOCALES.includes(value) ? value : "en"; testCatalog = null; }
function getLocale() { return locale; }
function terminal() { return catalogs[locale]?.["common.unavailable"] || catalogs.en["common.unavailable"] || "Unavailable"; }
function t(id, params = {}) {
  const message = (testCatalog || catalogs[locale])?.[id] || catalogs.en[id];
  if (typeof message !== "string") return terminal();
  let invalid = false;
  const text = message.replace(/\{([a-zA-Z][\w]*)\}/g, (_, name) => {
    const value = params[name];
    if (typeof value === "number" && Number.isFinite(value)) return new Intl.NumberFormat(locale).format(value);
    if (typeof value === "string") return value;
    invalid = true; return "";
  });
  return invalid ? terminal() : text;
}
function errorId(error) {
  const source = error?.error || error;
  if (!source || !Object.hasOwn(MESSAGES, source.code)) return { id: "plugin.error.UNKNOWN", params: {} };
  const safe = sanitizeError(source), reasonId = `plugin.error.${safe.code}.${safe.reason}`;
  return { id: safe.reason && catalogs.en[reasonId] ? reasonId : `plugin.error.${safe.code}`, params: safe.params || {} };
}
function errorText(error) { const { id, params } = errorId(error); return t(id, params); }
/* @dtm-test-only:start */
function setTestCatalog(value) { testCatalog = value; }
/* @dtm-test-only:end */
module.exports = { t, setLocale, getLocale, errorText, errorId };
/* @dtm-test-only:start */
module.exports.__test = { catalogs, setTestCatalog };
/* @dtm-test-only:end */
