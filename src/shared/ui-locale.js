"use strict";
const UI_LOCALES = Object.freeze(["en", "zh-Hans", "zh-Hant", "ja"]);
function normalizePreference(value) {
  if (typeof value !== "string" || value.length > 128) return null;
  const parts = value.trim().replace(/_/g, "-").split("-");
  if (!/^[A-Za-z]{2,3}$/.test(parts[0])) return null;
  let end = parts.findIndex((part, index) => index > 0 && /^[ux]$/i.test(part));
  if (end !== -1) {
    if (end === parts.length - 1 || parts.slice(end + 1).some(part => !/^[A-Za-z0-9]{1,8}$/.test(part))) return null;
    parts.length = end;
  }
  let index = 1, script = "", region = "";
  if (/^[A-Za-z]{4}$/.test(parts[index] || "")) { const part = parts[index++].toLowerCase(); script = part[0].toUpperCase() + part.slice(1); }
  if (/^(?:[A-Za-z]{2}|\d{3})$/.test(parts[index] || "")) region = parts[index++].toUpperCase();
  if (parts.slice(index).some(part => !/^(?:[A-Za-z0-9]{5,8}|\d[A-Za-z0-9]{3})$/.test(part))) return null;
  return { language: parts[0].toLowerCase(), script, region };
}
function resolveUiLocale(preferences) {
  if (!Array.isArray(preferences)) return "en";
  for (const value of preferences.slice(0, 128)) {
    const entry = normalizePreference(value);
    if (!entry) continue;
    const { language, script, region } = entry;
    if (language === "zh" || language === "yue") {
      if (script === "Hans" || script === "Hant") return `zh-${script}`;
      if (script) continue;
      return language === "yue" ? (region === "CN" ? "zh-Hans" : "zh-Hant") : (["TW", "HK", "MO"].includes(region) ? "zh-Hant" : "zh-Hans");
    }
    if (language === "en" && (!script || script === "Latn")) return "en";
    if (language === "ja" && (!script || script === "Jpan")) return "ja";
  }
  return "en";
}
module.exports = { UI_LOCALES, normalizePreference, resolveUiLocale };
