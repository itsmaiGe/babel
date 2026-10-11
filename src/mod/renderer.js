"use strict";

const { RequestClient } = require("./ui/request-client");
const { DisplayState } = require("./ui/display-state");
const { DomWatch } = require("./ui/dom-watch");
const { MODEL_PROVIDERS, MODEL_PROTOCOLS, TRANSLATION_STYLE_PRESETS, TRANSLATION_LANGUAGES, BABEL_VERSION } =
  requireShared("defaults");
const { normalizeSettings, normalizeEndpoint } = requireShared("settings");
const { textMatchesLanguage, hasLetters } = requireShared("language");

const i18n = require("./ui/i18n/index");
const { UI_LOCALES } = requireShared("ui-locale");
const { failure } = require("./core/errors");
let systemLocale = "en";
const controlHosts = new Map();
const CHROME_ATTR = "data-dtm-chrome";
const TEXT_PROPS = ["name", "label", "helperText", "placeholder", "previewText", "savedKeyLabel"];
function msg(id, params = {}) { return { __dtmText: true, id, params }; }
function errorMessage(error) { const descriptor = i18n.errorId(error); return msg(descriptor.id, descriptor.params); }
function text(value) { return value?.__dtmText ? i18n.t(value.id, Object.fromEntries(Object.entries(value.params).map(([key, item]) => [key, item?.__dtmText ? text(item) : item]))) : String(value || ""); }
function localizedSpec(spec) {
  const result = { ...spec };
  for (const key of TEXT_PROPS) if (key in spec) result[key] = text(spec[key]);
  if (spec.options) result.options = spec.options.map(option => ({ ...option, label: text(option.label), ...(option.savedKeyLabel ? { savedKeyLabel: text(option.savedKeyLabel) } : {}) }));
  return result;
}
function applyChromeEntry(node, key, value) {
  if (key === "textContent") { node.textContent = text(value); node.lang = i18n.getLocale(); }
  else node.setAttribute(key, text(value));
}
function chromeText(node, value, attribute) {
  const key = attribute || "textContent";
  if (!node.__dtmChromeDescriptors) node.__dtmChromeDescriptors = new Map();
  node.__dtmChromeDescriptors.set(key, value);
  if (typeof node.setAttribute === "function") node.setAttribute(CHROME_ATTR, "");
  applyChromeEntry(node, key, value);
}
function clearChrome(node) {
  if (!node) return;
  delete node.__dtmChromeDescriptors;
  if (typeof node.removeAttribute === "function") node.removeAttribute(CHROME_ATTR);
}
function sendSettingsConfig() {
  sendMainWorldMessage("dtm:settings-config", { title: SETTINGS_LABEL, locale: i18n.getLocale(), sections: SETTINGS_SECTION_NAV.map(section => ({ key: section.key, label: text(section.label) })), icon: BABEL_ICON_PATHS, unavailable: i18n.t("plugin.error.CONFIG.NATIVE_UI_UNAVAILABLE"), savedKeyLabel: i18n.t("plugin.key.savedAria") });
}
function refreshUiChrome() {
  sendSettingsConfig();
  for (const [id, host] of controlHosts) {
    if (host.dataset.dtmNativeReactMounted === "disposed") { controlHosts.delete(id); continue; }
    host.lang = i18n.getLocale();
    const spec = localizedSpec(host.__dtmControlSource);
    const detail = { id, textOnly: true };
    for (const key of TEXT_PROPS) if (key in spec) detail[key] = spec[key];
    // Send labels only: values, callbacks, disabled state and composition are retained.
    if (spec.options) detail.optionLabels = spec.options.map(option => ({ value: option.value, label: option.label, ...(option.savedKeyLabel ? { savedKeyLabel: option.savedKeyLabel } : {}) }));
    host.__dtmControlSpec = { ...host.__dtmControlSpec, ...Object.fromEntries(TEXT_PROPS.filter(key => key in spec).map(key => [key, spec[key]])), ...(spec.options ? { options: spec.options } : {}) };
    sendMainWorldMessage("dtm:mount-control", detail);
  }
  if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
    for (const node of document.querySelectorAll(`[${CHROME_ATTR}]`)) {
      const entries = node.__dtmChromeDescriptors;
      if (!entries) continue;
      for (const [key, value] of entries) applyChromeEntry(node, key, value);
    }
  }
  for (const block of document.querySelectorAll(".dtm-translation-block")) block.lang = block.__dtmChrome ? i18n.getLocale() : translationTag(settings.model.targetLanguage);
  for (const slot of document.querySelectorAll("[data-dtm-section-key]")) slot.lang = i18n.getLocale();
}
function translationTag(value) { return TRANSLATION_LANGUAGES.find(item => item.value === value)?.tag || ""; }

const RUNTIME_FLAG = "__discordTranslatorModStarted";
const SEND_BOX_ID = "dtm-send-box";
const SETTINGS_LABEL = "Babel";
const SETTINGS_SECTION_ID_PREFIX = "dtm-settings-section-";
const API_KEY_MASK = "************";
const SETTINGS_PAGE_KEYS = new Set(["general", "model", "read", "style"]);
const SETTINGS_SECTION_NAV = Object.freeze([
  { key: "general", label: msg("plugin.section.general") },
  { key: "model", label: msg("plugin.section.model") },
  { key: "read", label: msg("plugin.section.read") },
  { key: "style", label: msg("plugin.section.style") },
]);
const LANGUAGE_OPTIONS = TRANSLATION_LANGUAGES.map(({ id, value }) => ({ value, label: msg(`plugin.lang.${id}`) }));
const MODEL_PROTOCOL_OPTIONS = MODEL_PROTOCOLS.map((value) => ({
  value,
  label: msg(`plugin.protocol.${value}`),
}));
const providerProtocolValues = (provider) => provider.protocols || [MODEL_PROTOCOLS[0]];
const TRANSLATION_STYLE_OPTIONS = TRANSLATION_STYLE_PRESETS.map((style) => ({
  value: style.value,
  label: msg(`plugin.style.${style.value}`),
}));
const SEND_BOX_OPACITY_OPTIONS = [
  { value: "1", label: msg("plugin.percent", { value: 100 }) },
  { value: "0.9", label: msg("plugin.percent", { value: 90 }) },
  { value: "0.8", label: msg("plugin.percent", { value: 80 }) },
  { value: "0.7", label: msg("plugin.percent", { value: 70 }) },
  { value: "0.6", label: msg("plugin.percent", { value: 60 }) },
  { value: "0.5", label: msg("plugin.percent", { value: 50 }) },
  { value: "0.4", label: msg("plugin.percent", { value: 40 }) },
];
const TRANSLATION_POSITION_OPTIONS = [
  { value: "below", label: msg("plugin.position.below") },
  { value: "above", label: msg("plugin.position.above") },
];
const FONT_OPTIONS = [
  { value: "var(--font-primary)", label: msg("plugin.font.discord") },
  { value: "inherit", label: msg("plugin.font.inherit") },
  {
    value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    label: msg("plugin.font.system"),
  },
  {
    value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    label: msg("plugin.font.mono"),
  },
  { value: 'Georgia, "Times New Roman", serif', label: msg("plugin.font.serif") },
];
const STYLE_EMPHASIS_OPTIONS = [
  { value: "none", label: msg("plugin.emphasis.none") },
  { value: "bold", label: msg("plugin.emphasis.bold") },
  { value: "light", label: msg("plugin.emphasis.light") },
  { value: "marker", label: msg("plugin.emphasis.marker") },
  { value: "underline", label: msg("plugin.emphasis.underline") },
  { value: "wavy", label: msg("plugin.emphasis.wavy") },
  { value: "strike", label: msg("plugin.emphasis.strike") },
];
const COLOR_NAMES = Object.freeze({
  "#2b2d31": "graphite",
  "#303446": "slate",
  "#35384a": "blueGray",
  "#26364a": "midnight",
  "#233a3f": "darkTeal",
  "#263a2f": "darkGreen",
  "#3f3827": "olive",
  "#463238": "wine",
  "#3f344f": "indigo",
  "#41364a": "plum",
  "#e8edf8": "iceBlue",
  "#e6f4f1": "mint",
  "#f3efe5": "cream",
  "#f4e8ee": "blush",
  "#ece7f7": "lavender",
  "#f2f3f5": "offWhite",
  "#dbdee1": "lightGray",
  "#cbd5e1": "silver",
  "#dbeafe": "lightBlue",
  "#ccfbf1": "aqua",
  "#dcfce7": "lightGreen",
  "#fef3c7": "lightYellow",
  "#ffe4e6": "lightPink",
  "#ede9fe": "lilac",
  "#111827": "ink",
  "#1f2937": "charcoal",
  "#1e3a5f": "navy",
  "#164e63": "teal",
  "#14532d": "forest",
  "#7c2d12": "rust",
  "#7f1d1d": "maroon",
});
function colorOption(value) {
  const id = value === "auto" ? "auto" : COLOR_NAMES[value];
  return { value, label: msg(`plugin.color.${id}`) };
}
const BACKGROUND_COLOR_OPTIONS = [
  "auto",
  "#303446",
  "#2b2d31",
  "#35384a",
  "#26364a",
  "#233a3f",
  "#263a2f",
  "#3f3827",
  "#463238",
  "#3f344f",
  "#41364a",
  "#e8edf8",
  "#e6f4f1",
  "#f3efe5",
  "#f4e8ee",
  "#ece7f7",
  "#f2f3f5",
].map(colorOption);
const TEXT_COLOR_OPTIONS = [
  "auto",
  "#f2f3f5",
  "#dbdee1",
  "#cbd5e1",
  "#dbeafe",
  "#ccfbf1",
  "#dcfce7",
  "#fef3c7",
  "#ffe4e6",
  "#ede9fe",
  "#111827",
  "#1f2937",
  "#1e3a5f",
  "#164e63",
  "#14532d",
  "#7c2d12",
  "#7f1d1d",
].map(colorOption);
const DISCORD_UI = Object.freeze({
  accountCategories: "",
  settingCard: "",
  stack: "",
  settingStack: "",
});

const DISCORD_STACK_LAYOUTS = Object.freeze({
  rows: {
    align: "stretch",
    justify: "start",
    direction: "vertical",
    wrap: "false",
    fullWidth: "true",
    style: "display:flex;flex-direction:column;gap:16px;",
  },
  settingRow: {
    align: "stretch",
    justify: "start",
    direction: "vertical",
    wrap: "false",
    fullWidth: "true",
    style: "display:flex;flex-direction:column;gap:0;",
  },
  actionsRow: {
    align: "center",
    justify: "end",
    direction: "horizontal",
    wrap: "true",
    fullWidth: "true",
    style: "display:flex;flex-wrap:wrap;gap:8px;",
  },
});

let nativeApi = null;
let settings = normalizeSettings({});
let providerApiKeyStatus = {};
let nativeError = "";
let nativeStatus = null;
let displayState = new DisplayState();
let requests = null;
let settingsRevision = 1,
  executionRevision = 1;
let credentialContext = "",
  readDisplayContext = "",
  pauseNoticeRevision = 0;
let domWatch = null;
let settingsForm = null,
  retainedDraft = null,
  activeSettingsKey = "general",
  sharedFormFooter = null;
let dismissedTranslations = new Set();
let currentChannelId = "";
let autoTranslateBaseline = new Map();
let autoHandledMessages = new Set();
let autoEvictionFloor = 0n;
let settingsPageGeneration = 0;
let settingsPageOpen = false;
let settingsSections = new Map();
let nativeControlId = 0;
let mainWorldMessageId = 0;
const diagnosticLoggedMessages = new Set();
const mainWorldControlCallbacks = new Map();
const handledMainWorldMessages = { ids: new Set(), highest: 0, floor: 0 };
let mainWorldControlEventsInstalled = false;
const MAIN_WORLD_BRIDGE_ERROR = "Discord main-world bridge was not captured.";
const MAIN_WORLD_CONTROL_RETRY_MS = 100;
const MAIN_WORLD_CONTROL_MAX_ATTEMPTS = 20;

function requireShared(name) {
  try {
    return require(`./shared/${name}`);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      return require(`../shared/${name}`);
    }
    throw error;
  }
}

function start(api) {
  if (window[RUNTIME_FLAG]) return;
  window[RUNTIME_FLAG] = true;
  nativeApi = api;

  injectBaseStyles();
  installMainWorldControlEvents();
  systemLocale = UI_LOCALES.includes(api.uiSystemLocale) ? api.uiSystemLocale : "en";
  i18n.setLocale(systemLocale);
  installDomHooks();
  requests = new RequestClient(nativeApi, () => executionRevision);
  nativeApi.onConfigChanged?.(() =>
    loadSettingsSafe().then(() => {
      settingsForm?.externalChange();
      applyAutoTranslateSettings();
      ensureSendBox();
      refreshTranslationStyles();
    }),
  );
  loadSettingsSafe().then(() => {
    sendSettingsConfig();
    applyAutoTranslateSettings();
  });
}

function installDomHooks() {
  if (domWatch) return;
  domWatch = new DomWatch({
    document,
    window,
    findMessage,
    onDoubleClick: onMessageDoubleClick,
    sendEnabled: () => settings.sendTranslation.enabled,
    onMessages: (messages) => {
      restoreVisibleTranslations(messages);
      runAutoTranslate(messages);
    },
    onRoute: syncCurrentChannel,
    onPosition: () => ensureSendBox(),
  });
}

function unwrap(result) {
  if (result?.ok === false)
    throw Object.assign(new Error("Operation failed."), result.error);
  return result;
}
function applySnapshot(snapshot) {
  const previous = executionRevision, previousLocale = i18n.getLocale();
  settings = normalizeSettings(snapshot.settings || snapshot);
  settingsRevision = snapshot.settingsRevision || settingsRevision;
  executionRevision = snapshot.executionRevision || executionRevision;
  credentialContext = snapshot.credentialContext || credentialContext;
  const { sendLanguage: _sendLanguage, ...readModel } = settings.model || {};
  readDisplayContext = JSON.stringify([
    readModel,
    settings.translationStyle,
    settings.customPrompt,
    credentialContext,
  ]);
  providerApiKeyStatus = snapshot.keyStatus || providerApiKeyStatus;
  recordNativeStatus(snapshot.status);
  if (UI_LOCALES.includes(snapshot.ui?.systemLocale)) systemLocale = snapshot.ui.systemLocale;
  // The operating system is the only interface-language source; stored settings
  // never override it.
  i18n.setLocale(systemLocale);
  if (previousLocale !== i18n.getLocale()) refreshUiChrome();
  if (previous !== executionRevision) {
    requests?.cancel();
    pauseNoticeRevision = 0;
    const keepRead = settings.enabled;
    for (const record of displayState.records.values()) {
      record.token = Symbol();
      record.active.clear();
      for (const [kind, state] of record.units)
        if (state.status !== "success") record.units.delete(kind);
      if (keepRead && record.context === readDisplayContext) {
        record.revision = executionRevision;
        for (const state of record.units.values())
          state.revision = executionRevision;
      }
    }
    for (const block of document.querySelectorAll(".dtm-translation-block")) {
      const message = findMessage(block);
      const id = message && getMessageId(message);
      const record = id && displayState.get(id);
      const state = record?.units.get(block.dataset?.dtmUnit);
      if (
        keepRead &&
        record?.context === readDisplayContext &&
        record.revision === executionRevision &&
        state?.status === "success"
      )
        continue;
      block.remove();
    }
  }
}
async function loadSettingsSafe() {
  let timeout;
  try {
    const result = await Promise.race([
      nativeApi.getSettings(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(failure("STORAGE", null, { reason: "READ_FAILED" })), 8000); timeout.unref?.(); }),
    ]);
    applySnapshot(unwrap(result));
    if (!providerApiKeyStatus.previews && nativeApi.getApiKeyStatus)
      providerApiKeyStatus = unwrap(await nativeApi.getApiKeyStatus());
  } catch (error) {
    nativeStatus = error?.code ? { code: error.code, reason: error.reason } : null;
    nativeError = errorMessage(error);
  } finally {
    clearTimeout(timeout);
  }
}

function injectBaseStyles() {
  const existing = document.getElementById("dtm-style");
  if (existing) existing.remove();
  const style = document.createElement("style");
  style.id = "dtm-style";
  style.textContent = `
    /* Ancestor conflict: Discord's inline floating menus position against the nearest
       query container while Chromium draws them against the window, so a container-type
       above a native control displaces its menu. Rows wrap intrinsically instead. */
    [data-dtm-pair] {display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,max(252px,calc((100% - 16px) / 2 - 1px))),1fr));gap:16px;align-items:end;}
    [data-dtm-native-setting-row][hidden] {display:none;}
    [data-dtm-actions] {display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;}
    [data-dtm-actions] > [data-dtm-action-buttons] {margin-left:auto;}
    [data-dtm-action-status] {flex:1 1 240px;min-width:0;}
    .dtm-translation-block, [data-dtm-style-preview-block] {
      box-sizing: border-box;
      width: fit-content;
      max-width: min(720px, 100%);
      margin-top: 6px;
      padding: 9px 13px;
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      line-height: 1.45;
      white-space: pre-wrap;
      user-select: text;
      box-shadow: 0 1px 2px rgba(0, 0, 0, .12);
    }
    #${SEND_BOX_ID} {
      position: fixed;
      z-index: 1000;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border: 1px solid var(--border-subtle, rgba(128, 132, 142, .32));
      border-radius: 8px;
      background: var(--channeltextarea-background, var(--background-secondary, #383a40));
      box-shadow: var(--elevation-high, 0 8px 24px rgba(0, 0, 0, .3));
    }
    .dtm-send-grip {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 4px;
      color: var(--text-muted, #949ba4);
      background: transparent;
      cursor: grab;
      font-size: 14px;
      line-height: 1;
      touch-action: none;
      user-select: none;
    }
    .dtm-send-grip:hover { color: var(--text-default, var(--text-normal, #dbdee1)); }
    .dtm-send-grip:active { cursor: grabbing; }
    .dtm-send-resize {
      position: absolute;
      top: 4px;
      right: 0;
      bottom: 4px;
      width: 8px;
      cursor: ew-resize;
      touch-action: none;
      border-top-right-radius: 8px;
      border-bottom-right-radius: 8px;
    }
    .dtm-send-resize::after {
      content: "";
      position: absolute;
      top: 50%;
      right: 3px;
      width: 2px;
      height: 16px;
      transform: translateY(-50%);
      border-radius: 1px;
      background: color-mix(in srgb, var(--text-muted, #949ba4) 0%, transparent);
    }
    .dtm-send-resize:hover::after {
      background: color-mix(in srgb, var(--text-muted, #949ba4) 70%, transparent);
    }
    #${SEND_BOX_ID} input {
      min-width: 0;
      border: 0;
      outline: 0;
      color: var(--text-default, var(--text-normal, var(--header-primary, #dbdee1)));
      caret-color: var(--text-default, var(--text-normal, var(--header-primary, #dbdee1)));
      background: transparent;
      font: inherit;
    }
    #${SEND_BOX_ID} input::placeholder {
      color: var(--text-muted, #949ba4);
      opacity: 1;
    }
    #${SEND_BOX_ID} span {
      color: var(--text-muted, #949ba4);
      font-size: 12px;
      white-space: nowrap;
    }
    #${SEND_BOX_ID} span[data-error="true"] {
      grid-column: 1 / -1;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .dtm-about {
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle, rgba(128, 132, 142, .2));
      color: var(--text-muted, #949ba4);
      font-size: 12px;
      line-height: 1.6;
    }
    .dtm-about-title {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 2px 6px;
      font-size: 14px;
      font-weight: 700;
      color: var(--text-default, var(--header-primary, #dbdee1));
    }
    .dtm-about-version {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted, #949ba4);
    }
    .dtm-about-desc { margin-top: 6px; }
    .dtm-about-why { margin-top: 4px; }
    .dtm-about-update {
      margin-top: 10px;
      font-size: 13px;
      font-weight: 600;
    }
    .dtm-about-thanks { margin-top: 10px; }
  `;
  document.documentElement.appendChild(style);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function settingsSectionId(sectionKey) {
  return `${SETTINGS_SECTION_ID_PREFIX}${sectionKey}`;
}

function recordNativeStatus(status) {
  nativeStatus = status?.code ? { code: status.code, reason: status.reason } : null;
  nativeError = nativeStatus ? errorMessage(status) : "";
}

// Revision conflict and recoverable corrupt JSON can be overwritten. Unreadable
// or failed storage cannot; reload is only offered when recovery asks for it.
function storageNotice(status) {
  if (!status?.code) return { conflict: false, overwrite: false, reload: false };
  if (status.code === "CONFLICT") return { conflict: true, overwrite: true, reload: true };
  if (status.code === "MALFORMED" && status.reason === "INVALID_JSON")
    return { conflict: false, overwrite: true, reload: true };
  const reload =
    (status.code === "MALFORMED" && status.reason === "UNREADABLE") ||
    (status.code === "PARTIAL_SAVE" && status.reason === "KEY_ROLLBACK_FAILED");
  return { conflict: false, overwrite: false, reload };
}

// A coded status other than a real conflict or repairable JSON means the store
// cannot accept a write. A retained draft's older revision must not hide that.
function storageUnavailable(status) {
  if (!status?.code) return false;
  if (status.code === "CONFLICT") return false;
  if (status.code === "MALFORMED" && status.reason === "INVALID_JSON") return false;
  return true;
}

function reconcileRetainedDraft(formId, savedSettings, savedRevision) {
  if (!retainedDraft || retainedDraft.formId !== formId) return;
  const saved = normalizeSettings(savedSettings);
  const aligned = normalizeSettings({
    ...retainedDraft.settings,
    sendBox: {
      ...retainedDraft.settings.sendBox,
      x: saved.sendBox.x,
      y: saved.sendBox.y,
      width: saved.sendBox.width,
    },
  });
  if (JSON.stringify(aligned) === JSON.stringify(saved)) {
    retainedDraft = null;
    return;
  }
  retainedDraft = { settings: aligned, base: saved, revision: savedRevision, formId };
}

async function openSettingsPanel(activeKey) {
  const explicitPage = arguments.length > 0 && activeKey != null;
  if (explicitPage) activeSettingsKey = activeKey === "send" ? "read" : (SETTINGS_PAGE_KEYS.has(activeKey) ? activeKey : "general");
  else if (!SETTINGS_PAGE_KEYS.has(activeSettingsKey)) activeSettingsKey = "general";
  if (settingsPageOpen) {
    mountSettingsSections();
    if (explicitPage && activeSettingsKey === "read") settingsForm?.refreshCacheStatus?.();
    return;
  }
  settingsPageOpen = true;
  const generation = ++settingsPageGeneration;
  await loadSettingsSafe();
  if (generation !== settingsPageGeneration) return;
  const formState = JSON.parse(
    JSON.stringify(retainedDraft?.settings || settings),
  );
  let base = JSON.parse(JSON.stringify(retainedDraft?.base || settings)),
    baseRevision = retainedDraft?.revision || settingsRevision;
  let observedRevision = settingsRevision,
    conflict = Boolean(
      (retainedDraft && baseRevision !== settingsRevision) ||
        storageNotice(nativeStatus).conflict,
    ),
    saving = false,
    keyAction = "keep",
    credentialToken = 0;
  let refreshModelsInFlight = false,
    testConnectionInFlight = false,
    lastSaveError = "",
    lastSaveSuccess = false,
    cacheReadGeneration = 0;
  const fetchedModelOptions = new Map(),
    body = div(),
    preview = translationStylePreview(formState.style);
  const providerSelectHost = div(),
    baseUrlFieldHost = div(),
    modelFieldHost = div(),
    protocolFieldHost = div(),
    apiKeyFieldHost = div(),
    keyActionsHost = div(),
    httpHost = div(),
    customPromptHost = div();
  const save = button(msg("plugin.save"), "primary"),
    discard = button(msg("plugin.discard"), "secondary"),
    openConfig = button(msg("plugin.openConfig"), "secondary"),
    clearCache = button(msg("plugin.clearCache"), "secondary"),
    refreshModels = button(msg("plugin.refreshModels"), "secondary"),
    testConnection = button(msg("plugin.testConnection"), "secondary");
  const saveStatus = statusField(""),
    connectionStatus = statusField(""),
    keyStatus = statusField(""),
    openConfigStatus = statusField(""),
    cacheStatus = statusField(""),
    pauseStatus = statusField("");
  keyStatus.dataset.dtmKeyStatus = "true";
  // Footer action statuses stay distinct: each reports only its own action.
  saveStatus.dataset.dtmActionStatus = "save";
  openConfigStatus.dataset.dtmActionStatus = "openConfig";
  cacheStatus.dataset.dtmActionStatus = "cache";
  keyActionsHost.dataset.dtmSelfHide = "true";
  let modelComboBoxHost = null;
  function preferences() {
    const { __apiKey, ...value } = formState;
    return normalizeSettings(value);
  }
  function dirty() {
    return (
      JSON.stringify(preferences()) !== JSON.stringify(base) ||
      Boolean(formState.__apiKey) ||
      keyAction !== "keep"
    );
  }
  function feedback(message, tone = "message") {
    connectionStatus.update(message, tone === "failure" ? "critical" : "default");
    showNativeToast(message, tone);
  }
  function changed() {
    lastSaveError = "";
    lastSaveSuccess = false;
    connectionStatus.update("");
    syncState();
  }
  function presentedConflict() {
    const notice = storageNotice(nativeStatus);
    if (storageUnavailable(nativeStatus))
      return { overwrite: false, reload: notice.reload, conflict: false };
    const showConflict = conflict || notice.conflict;
    return {
      overwrite: showConflict || notice.overwrite,
      reload: showConflict || notice.reload,
      conflict: showConflict,
    };
  }
  function syncState() {
    const presented = presentedConflict();
    save.disabled = saving || (!dirty() && !presented.overwrite);
    discard.disabled = saving || (!dirty() && !presented.reload);
    save.setLabel(presented.overwrite ? msg("plugin.overwrite") : msg("plugin.save"));
    discard.setLabel(presented.reload ? msg("plugin.reload") : msg("plugin.discard"));
    let message = "",
      tone = "default";
    if (lastSaveError) {
      message = lastSaveError;
      tone = "critical";
    } else if (saving) message = msg("plugin.saving");
    else if (presented.conflict) {
      message = msg("plugin.conflict");
      tone = "warning";
    } else if (nativeError) {
      message = nativeError;
      tone = "critical";
    } else if (dirty()) message = msg("plugin.dirty");
    else if (lastSaveSuccess) message = msg("plugin.savedToast");
    saveStatus.update(message, tone);
  }
  function context() {
    return JSON.stringify([
      formState.model.provider,
      formState.model.baseUrl,
      formState.model.protocol,
      formState.model.modelId,
      credentialToken,
    ]);
  }
  function currentSettingsRequest() {
    const request = { settings: preferences() };
    const apiKey = apiKeyValueForRequest(formState.__apiKey);
    if (apiKey) request.apiKey = apiKey;
    return request;
  }
  function modelCacheKey() {
    return `${formState.model.provider}:${formState.model.baseUrl}:${formState.model.protocol}`;
  }
  function keyDescription() {
    if (keyAction === "reset") return { text: msg("plugin.key.resetExplain"), tone: "default" };
    if (providerApiKeyStatus.unavailable)
      return {
        text: msg(providerApiKeyStatus.unavailable.recoverable ? "plugin.key.damaged" : "plugin.key.accessDenied"),
        tone: "critical",
      };
    if (keyAction === "remove") return { text: msg("plugin.key.removePending"), tone: "default" };
    if (keyAction === "link") return { text: msg("plugin.key.linkPending"), tone: "default" };
    if (keyAction === "removeLegacy") return { text: msg("plugin.key.legacyRemovePending"), tone: "default" };
    if (formState.__apiKey)
      return {
        text: msg(providerApiKeyStatus.secureStorageAvailable === false ? "plugin.key.testOnly" : "plugin.key.replacePending"),
        tone: "default",
      };
    if (providerApiKeyStatus.unlinked) return { text: msg("plugin.key.unlinked"), tone: "warning" };
    return "";
  }
  function renderKeyActions() {
    clearChildren(keyActionsHost);
    const items = [];
    if (providerApiKeyStatus.unavailable?.recoverable) {
      const reset = button(msg("plugin.key.reset"), "secondary");
      reset.addEventListener("click", () => {
        formState.__apiKey = "";
        keyAction = "reset";
        credentialToken++;
        keyStatus.update(keyDescription());
        changed();
      });
      items.push(reset);
    }
    if (providerApiKeyStatus.unavailable) {
      keyActionsHost.appendChild(buttonRow(items));
      setRowVisible(keyActionsHost, items.length > 0);
      return;
    }
    if (providerApiKeyStatus[formState.model.provider]) {
      const remove = button(msg("plugin.key.remove"), "secondary");
      remove.addEventListener("click", () => {
        formState.__apiKey = "";
        keyAction = "remove";
        credentialToken++;
        keyStatus.update(keyDescription());
        changed();
      });
      items.push(remove);
    }
    if (providerApiKeyStatus.unlinked) {
      if (formState.model.provider === "custom") {
        const link = button(msg("plugin.key.link"), "secondary");
        link.addEventListener("click", () => {
          keyAction = "link";
          credentialToken++;
          keyStatus.update(keyDescription());
          changed();
        });
        items.push(link);
      }
      const remove = button(msg("plugin.key.removeLegacy"), "secondary");
      remove.addEventListener("click", () => {
        keyAction = "removeLegacy";
        credentialToken++;
        keyStatus.update(keyDescription());
        changed();
      });
      items.push(remove);
    }
    keyActionsHost.appendChild(buttonRow(items));
    setRowVisible(keyActionsHost, items.length > 0);
  }
  async function refreshKeyStatus() {
    const captured = context();
    try {
      const result = unwrap(
        await nativeApi.getApiKeyStatus?.({
          provider: formState.model.provider,
          baseUrl: formState.model.baseUrl,
        }),
      );
      if (generation !== settingsPageGeneration || context() !== captured)
        return;
      providerApiKeyStatus = result || {};
      keyStatus.update(keyDescription());
      renderKeyActions();
    } catch (error) {
      keyStatus.update(errorMessage(error), "critical");
    }
  }
  function renderProviderSelect() {
    clearChildren(providerSelectHost);
    providerSelectHost.appendChild(
      selectField(
        msg("plugin.provider"),
        formState.model.provider,
        providerOptionsWithStatus(providerApiKeyStatus),
        (value) => {
          const provider = providerById(value);
          Object.assign(formState.model, {
            provider: provider.value,
            baseUrl: provider.baseUrl,
            modelId: provider.defaultModel,
            protocol: providerProtocolValues(provider)[0],
            allowInsecureHttp: false,
            insecureHttpEndpoint: "",
          });
          formState.__apiKey = "";
          keyAction = "keep";
          credentialToken++;
          renderProtocolField();
          renderProviderFields();
          renderApiKeyField();
          refreshKeyStatus();
          changed();
        },
      ),
    );
  }
  function renderHttp() {
    clearChildren(httpHost);
    let shown = false;
    try {
      const endpoint = normalizeEndpoint(formState.model.baseUrl),
        url = new URL(endpoint);
      if (
        formState.model.provider === "custom" &&
        url.protocol === "http:" &&
        !isLoopback(url.hostname)
      ) {
        httpHost.appendChild(
          toggleRow(
            msg("plugin.allowHttp"),
            formState.model.allowInsecureHttp,
            (value) => {
              formState.model.allowInsecureHttp = value;
              formState.model.insecureHttpEndpoint = value ? endpoint : "";
              changed();
            },
          ),
        );
        shown = true;
      }
    } catch (_) {
      httpHost.appendChild(
        statusField(msg("plugin.error.CONFIG.INVALID_ENDPOINT"), "critical"),
      );
      shown = true;
    }
    setRowVisible(httpHost, shown);
  }
  function renderProviderFields() {
    clearChildren(baseUrlFieldHost);
    baseUrlFieldHost.appendChild(
      inputField(
        msg("plugin.endpoint"),
        "text",
        formState.model.baseUrl,
        (value) => {
          formState.model.baseUrl = value;
          formState.model.allowInsecureHttp = false;
          formState.model.insecureHttpEndpoint = "";
          formState.__apiKey = "";
          keyAction = "keep";
          credentialToken++;
          providerApiKeyStatus = {
            ...providerApiKeyStatus,
            custom: false,
            previews: { ...providerApiKeyStatus.previews, custom: "" },
          };
          renderHttp();
          renderApiKeyField();
          refreshKeyStatus();
          changed();
        },
        { disabled: formState.model.provider !== "custom" },
      ),
    );
    renderHttp();
    renderModelField();
  }
  function renderModelField() {
    const provider = providerById(formState.model.provider),
      options = optionsWithCurrentValue(
        (fetchedModelOptions.get(modelCacheKey()) || provider.models || []).map(item => item.label === "OpenAI 最新别名" ? { ...item, label: msg("plugin.modelAlias") } : item),
        formState.model.modelId,
      );
    if (modelComboBoxHost?.parentElement === modelFieldHost) {
      modelComboBoxHost.updateOptions(formState.model.modelId, options);
      return;
    }
    clearChildren(modelFieldHost);
    modelComboBoxHost = modelComboBoxHostFor(
      msg("plugin.model"),
      formState.model.modelId,
      options,
      (value) => {
        formState.model.modelId = value;
        changed();
      },
    );
    modelFieldHost.appendChild(modelComboBoxHost);
  }
  // The API format selector appears only where the provider allows more than
  // one format; the selected format never follows the base URL path.
  function renderProtocolField() {
    clearChildren(protocolFieldHost);
    const provider = providerById(formState.model.provider),
      allowed = providerProtocolValues(provider);
    setRowVisible(protocolFieldHost, allowed.length > 1);
    if (allowed.length <= 1) return;
    protocolFieldHost.appendChild(
      selectField(
        msg("plugin.protocol"),
        formState.model.protocol,
        MODEL_PROTOCOL_OPTIONS.filter((option) => allowed.includes(option.value)),
        (value) => {
          formState.model.protocol = value;
          renderModelField();
          changed();
        },
      ),
    );
  }
  function renderApiKeyField() {
    clearChildren(apiKeyFieldHost);
    apiKeyFieldHost.appendChild(
      passwordField(
        "API Key",
        formState.__apiKey || "",
        (value) => {
          if (providerApiKeyStatus.unavailable) return;
          formState.__apiKey = value;
          keyAction = value ? "replace" : "keep";
          credentialToken++;
          keyStatus.update(keyDescription());
          changed();
        },
        apiKeyPlaceholder(formState.model.provider),
        Boolean(providerApiKeyStatus.unavailable),
      ),
    );
    keyStatus.update(keyDescription());
    renderKeyActions();
  }
  async function refreshModelList() {
    if (refreshModelsInFlight) return;
    refreshModelsInFlight = true;
    refreshModels.setLoading(true);
    connectionStatus.update("");
    const captured = context(),
      request = currentSettingsRequest(),
      key = modelCacheKey();
    try {
      const result = unwrap(await nativeApi.listModels(request));
      if (generation !== settingsPageGeneration || context() !== captured)
        return;
      fetchedModelOptions.set(key, result.models || []);
      renderModelField();
      feedback(msg("plugin.modelsRefreshed", { count: (result.models || []).length }), "success");
    } catch (error) {
      if (generation === settingsPageGeneration && context() === captured)
        feedback(errorMessage(error), "failure");
    } finally {
      refreshModelsInFlight = false;
      refreshModels.setLoading(false);
    }
  }
  refreshModels.addEventListener("click", refreshModelList);
  testConnection.addEventListener("click", async () => {
    if (testConnectionInFlight) return;
    testConnectionInFlight = true;
    testConnection.setLoading(true);
    connectionStatus.update("");
    const captured = context(),
      request = currentSettingsRequest();
    try {
      unwrap(await nativeApi.testConnection(request));
      if (generation === settingsPageGeneration && context() === captured)
        feedback(
          msg("plugin.connectionSuccess", { origin: new URL(normalizeEndpoint(request.settings.model.baseUrl)).origin }),
          "success",
        );
    } catch (error) {
      if (generation === settingsPageGeneration && context() === captured)
        feedback(
          errorMessage(error),
          "failure",
        );
    } finally {
      testConnectionInFlight = false;
      testConnection.setLoading(false);
    }
  });
  renderProviderSelect();
  renderProtocolField();
  renderProviderFields();
  renderApiKeyField();
  const updateStylePreview = () => {
    refreshStylePreview(preview, formState.style);
    changed();
  };
  customPromptHost.appendChild(
    inputField(
      msg("plugin.customPrompt"),
      "textarea",
      formState.customPrompt,
      (value) => {
        formState.customPrompt = value;
        changed();
      },
      { maxLength: 4000 },
    ),
  );
  const syncCustomPromptVisibility = () => {
    setRowVisible(customPromptHost, formState.translationStyle === "custom");
  };
  syncCustomPromptVisibility();
  const pair = (left, right) => {
    const row = div();
    row.dataset.dtmPair = "true";
    row.append(left, right);
    return row;
  };
  const column = (child) => {
    const row = div();
    row.dataset.dtmPair = "true";
    row.append(child);
    return row;
  };
  const modelButtons = buttonRow([refreshModels, testConnection]);
  modelButtons.dataset.dtmActionButtons = "true";
  const modelActions = div();
  modelActions.dataset.dtmActions = "true";
  modelActions.append(keyActionsHost, modelButtons);
  body.append(
    section(
      msg("plugin.section.general"),
      [
        toggleRow(msg("plugin.enabled"), formState.enabled, (value) => {
          formState.enabled = value;
          changed();
        }),
      ],
      "general",
    ),
    section(
      msg("plugin.section.model"),
      [
        pair(providerSelectHost, modelFieldHost),
        pair(baseUrlFieldHost, apiKeyFieldHost),
        httpHost,
        protocolFieldHost,
        keyStatus,
        modelActions,
        connectionStatus,
      ],
      "model",
    ),
    section(
      msg("plugin.section.read"),
      [
        pair(
          languageSelectField(
            msg("plugin.readTarget"),
            formState.model.targetLanguage,
            (value) => {
              formState.model.targetLanguage = value;
              changed();
            },
          ),
          languageSelectField(
            msg("plugin.sendTarget"),
            formState.model.sendLanguage,
            (value) => {
              formState.model.sendLanguage = value;
              changed();
            },
          ),
        ),
        column(
          selectField(
            msg("plugin.translationStyle"),
            formState.translationStyle,
            TRANSLATION_STYLE_OPTIONS,
            (value) => {
              formState.translationStyle = value;
              syncCustomPromptVisibility();
              changed();
            },
          ),
        ),
        customPromptHost,
        toggleRow(
          msg("plugin.autoTranslate"),
          formState.autoTranslate.enabled,
          (value) => {
            formState.autoTranslate.enabled = value;
            changed();
          },
        ),
        pauseStatus,
        toggleRow(
          msg("plugin.sendEnabled"),
          formState.sendTranslation.enabled,
          (value) => {
            formState.sendTranslation.enabled = value;
            changed();
          },
        ),
        toggleRow(
          msg("plugin.autoSend"),
          formState.sendTranslation.enterToSend,
          (value) => {
            formState.sendTranslation.enterToSend = value;
            changed();
          },
        ),
      ],
      "read",
    ),
    section(
      msg("plugin.section.style"),
      [
        preview,
        pair(
          selectField(
            msg("plugin.position"),
            formState.style.position,
            TRANSLATION_POSITION_OPTIONS,
            (value) => {
              formState.style.position = value;
              changed();
            },
          ),
          selectField(
            msg("plugin.emphasis"),
            formState.style.emphasis,
            STYLE_EMPHASIS_OPTIONS,
            (value) => {
              formState.style.emphasis = value;
              updateStylePreview();
            },
          ),
        ),
        toggleRow(msg("plugin.background"), formState.style.background, (value) => {
          formState.style.background = value;
          updateStylePreview();
        }),
        pair(
          selectField(
            msg("plugin.backgroundColor"),
            formState.style.backgroundColor,
            colorChoices(BACKGROUND_COLOR_OPTIONS, formState.style.backgroundColor),
            (value) => {
              formState.style.backgroundColor = value;
              updateStylePreview();
            },
          ),
          selectField(
            msg("plugin.textColor"),
            formState.style.textColor,
            colorChoices(TEXT_COLOR_OPTIONS, formState.style.textColor),
            (value) => {
              formState.style.textColor = value;
              updateStylePreview();
            },
          ),
        ),
        pair(
          selectField(
            msg("plugin.font"),
            formState.style.fontFamily,
            optionsWithCurrentValue(FONT_OPTIONS, formState.style.fontFamily),
            (value) => {
              formState.style.fontFamily = value;
              updateStylePreview();
            },
          ),
          selectField(
            msg("plugin.opacity"),
            String(formState.sendBox.opacity),
            optionsWithCurrentValue(
              SEND_BOX_OPACITY_OPTIONS,
              String(formState.sendBox.opacity),
            ),
            (value) => {
              formState.sendBox.opacity = Number(value);
              changed();
            },
          ),
        ),
      ],
      "style",
    ),
  );
  async function updateCacheStatus() {
    const readGeneration = ++cacheReadGeneration;
    const pageGeneration = generation;
    try {
      const status = unwrap(await nativeApi.cacheStatus?.()) || {};
      // A read that started before a newer clear result must not replace it.
      if (readGeneration !== cacheReadGeneration || pageGeneration !== settingsPageGeneration) return;
      if (status.error) cacheStatus.update(errorMessage(status.error), "critical");
      else cacheStatus.update("");
    } catch (error) {
      if (readGeneration !== cacheReadGeneration || pageGeneration !== settingsPageGeneration) return;
      cacheStatus.update(errorMessage(error), "critical");
    }
  }
  clearCache.addEventListener("click", async () => {
    if (clearCache.disabled) return;
    clearCache.disabled = true;
    const pageGeneration = generation;
    try {
      await clearTranslationCache();
      if (pageGeneration !== settingsPageGeneration) return;
      cacheReadGeneration += 1;
      cacheStatus.update("");
      showNativeToast(msg("plugin.cacheCleared"), "success");
    } catch (error) {
      if (pageGeneration !== settingsPageGeneration) return;
      cacheReadGeneration += 1;
      cacheStatus.update(errorMessage(error), "critical");
    } finally {
      if (pageGeneration === settingsPageGeneration) clearCache.disabled = false;
    }
  });
  openConfig.addEventListener("click", async () => {
    const pageGeneration = generation;
    try {
      unwrap(await nativeApi.openSettingsFile());
      if (pageGeneration !== settingsPageGeneration) return;
      openConfigStatus.update("");
    } catch (error) {
      if (pageGeneration !== settingsPageGeneration) return;
      openConfigStatus.update(errorMessage(error), "critical");
    }
  });
  discard.addEventListener("click", () => {
    retainedDraft = null;
    settingsForm = null;
    closeSettingsPanel();
    openSettingsPanel(activeSettingsKey);
  });
  save.addEventListener("click", async () => {
    if (save.disabled) return;
    saving = true;
    lastSaveSuccess = false;
    const submitted = preferences(),
      submittedKey = formState.__apiKey,
      submittedAction = keyAction;
    const overwrite = presentedConflict().overwrite;
    const request = {
      baseSettingsRevision: overwrite ? observedRevision : baseRevision,
      settings: submitted,
      key: {
        action: submittedAction,
        value: submittedAction === "replace" ? submittedKey : undefined,
      },
    };
    syncState();
    try {
      const result = unwrap(await nativeApi.saveConfig(request));
      applySnapshot(result);
      applyAutoTranslateSettings();
      ensureSendBox();
      refreshTranslationStyles();
      const savedSettings = normalizeSettings({
        ...submitted,
        sendBox: {
          ...submitted.sendBox,
          x: settings.sendBox.x,
          y: settings.sendBox.y,
          width: settings.sendBox.width,
        },
      });
      // A save that finishes after this form closed may reconcile only that form's draft.
      if (generation !== settingsPageGeneration) {
        reconcileRetainedDraft(generation, savedSettings, settingsRevision);
        return;
      }
      base = savedSettings;
      Object.assign(formState.sendBox, {
        x: settings.sendBox.x,
        y: settings.sendBox.y,
        width: settings.sendBox.width,
      });
      baseRevision = settingsRevision;
      observedRevision = settingsRevision;
      conflict = false;
      if (
        submittedAction !== "keep" &&
        formState.__apiKey === submittedKey &&
        keyAction === submittedAction
      ) {
        formState.__apiKey = "";
        keyAction = "keep";
        renderApiKeyField();
      }
      lastSaveSuccess = true;
      showNativeToast(msg("plugin.savedToast"), "success");
    } catch (error) {
      if (error.code === "CONFLICT") {
        await loadSettingsSafe();
        observedRevision = settingsRevision;
        conflict = true;
      }
      lastSaveError = errorMessage(error);
      lastSaveSuccess = false;
    } finally {
      saving = false;
      if (generation === settingsPageGeneration) syncState();
    }
  });
  settingsForm = {
    externalChange: () => {
      observedRevision = settingsRevision;
      if (saving) return;
      if (JSON.stringify(base) === JSON.stringify(settings)) {
        // No meaningful external change: only ignored legacy fields may differ,
        // so the open draft stays authoritative.
        base = JSON.parse(JSON.stringify(settings)); baseRevision = settingsRevision;
        syncState(); return;
      }
      if (dirty()) conflict = true;
      else {
        retainedDraft = null;
        settingsForm = null;
        closeSettingsPanel();
        openSettingsPanel(activeSettingsKey);
      }
      syncState();
    },
    draft: () =>
      dirty()
        ? { settings: preferences(), base, revision: baseRevision, formId: generation }
        : null,
    /* @dtm-test-only:start */
    keyActionForTests: () => keyAction,
    /* @dtm-test-only:end */
    reportReadNotice: (message) => {
      pauseStatus.update(message || "");
    },
    refreshCacheStatus: () => updateCacheStatus(),
    dispose: () => {
      formState.__apiKey = "";
      keyAction = "keep";
    },
  };
  sharedFormFooter = div();
  sharedFormFooter.append(
    actionRow([saveStatus, openConfigStatus, cacheStatus], [openConfig, clearCache, discard, save]),
    aboutFooter(generation),
  );
  sharedFormFooter.style.cssText =
    "display:flex;flex-direction:column;gap:16px";
  settingsSections = new Map(
    SETTINGS_SECTION_NAV.map(({ key }) => [
      key,
      body.querySelector(`#${settingsSectionId(key)}`),
    ]),
  );
  settingsSections.get(activeSettingsKey)?.appendChild(sharedFormFooter);
  syncState();
  updateCacheStatus();
  mountSettingsSections();
}
function isLoopback(host) {
  return (
    host === "localhost" ||
    host === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}
function statusField(message, tone = "default") {
  const host = reactControlHost("status");
  let shown = null;
  host.update = (value, nextTone = "default") => {
    let text = value,
      resolved = nextTone;
    if (value && typeof value === "object" && !value.__dtmText && Object.prototype.hasOwnProperty.call(value, "text")) {
      text = value.text;
      resolved = value.tone || nextTone;
    }
    const visible = Boolean(text && (text.__dtmText || String(text).length));
    const signature = `${text && text.__dtmText ? text.id : ""}\n${text && text.__dtmText ? JSON.stringify(text.params || {}) : String(visible ? text : "")}\n${resolved}`;
    setRowVisible(host, visible);
    if (signature === shown) return;
    shown = signature;
    mountDiscordReactControl(host, {
      kind: "status",
      helperText: visible ? text : "",
      tone: resolved,
      live: resolved === "critical" ? "assertive" : "polite",
      role: resolved === "critical" ? "alert" : "status",
    });
  };
  host.update(message, tone);
  return host;
}

function mountSettingsSections() {
  if (sharedFormFooter && settingsSections.get(activeSettingsKey))
    settingsSections.get(activeSettingsKey).appendChild(sharedFormFooter);
  for (const [key, content] of settingsSections) {
    const slot = document.getElementById(`dtm-settings-slot-${key}`);
    if (!slot || !content || content.parentElement === slot) continue;
    slot.appendChild(content);
    for (const host of content.querySelectorAll("[data-dtm-control-id]")) {
      requestMainWorldControl(host, host.__dtmControlSource);
    }
  }
}

function closeSettingsPanel() {
  // A live form decides retention. A clean form returns null and drops the previous draft.
  if (settingsForm) retainedDraft = settingsForm.draft();
  settingsForm?.dispose();
  settingsForm = null;
  sharedFormFooter = null;
  settingsPageOpen = false;
  settingsPageGeneration += 1;
  for (const content of settingsSections.values()) {
    disposeControls(content);
    content.remove();
  }
  settingsSections.clear();
  mainWorldControlCallbacks.clear();
}

const SUPPORTER_A = "Lallen 女士";
const SUPPORTER_B = "Silva 先生";

const BABEL_ICON_PATHS =
  '<path d="M10 4h4l1 2.6H9z"/>' +
  '<path d="M9 8.2h6l1.2 2.8H7.8z"/>' +
  '<path d="M7.6 12.4h8.8l1.3 3H6.3z"/>' +
  '<path d="M6 17h12l1.4 3.4H4.6z"/>' +
  '<path d="M11 20.4v-1.6a1 1 0 0 1 2 0v1.6"/>';

function aboutFooter(pageGeneration) {
  const wrap = div("dtm-about");

  const title = div("dtm-about-title");
  const name = div();
  name.textContent = "Babel · 巴别";
  const version = div("dtm-about-version");
  version.textContent = `v${BABEL_VERSION}`;
  title.append(name, version);

  const desc = div("dtm-about-desc");
  chromeText(desc, msg("plugin.about.description"));

  const why = div("dtm-about-why");
  chromeText(why, msg("plugin.about.why"));

  wrap.append(title, desc, why);

  const updateRow = div("dtm-about-update");
  const updateButton = button(msg("plugin.update.check"));
  updateButton.setLive("polite");
  let phase = "idle";
  let latestVersion = "";
  let updateUrl = "";
  let busy = false;
  const paintUpdate = () => {
    const label = phase === "checking" ? msg("plugin.update.checking")
      : phase === "current" ? msg("plugin.update.current")
      : phase === "available" ? msg("plugin.update.available", { version: latestVersion })
      : phase === "check-failed" ? msg("plugin.update.failed")
      : phase === "open-failed" ? msg("plugin.update.openFailed")
      : msg("plugin.update.check");
    updateButton.setLabel(label);
    updateButton.setLoading(phase === "checking");
    updateButton.setBusy(busy);
  };
  const alive = () => pageGeneration === settingsPageGeneration;
  async function runCheck() {
    if (busy) return;
    busy = true;
    phase = "checking";
    paintUpdate();
    try {
      const info = unwrap(await nativeApi.checkUpdate());
      if (!alive()) return;
      if (info?.updateAvailable) {
        if (typeof info.url === "string" && info.url) {
          latestVersion = String(info.latest || "").replace(/^v/i, "");
          updateUrl = info.url;
          phase = "available";
        } else phase = "check-failed";
      } else phase = "current";
    } catch (_) {
      if (!alive()) return;
      phase = "check-failed";
    } finally {
      if (alive()) {
        busy = false;
        paintUpdate();
      }
    }
  }
  async function runOpen() {
    if (busy || !updateUrl) return;
    busy = true;
    paintUpdate();
    try {
      unwrap(await nativeApi.openExternal(updateUrl));
      if (!alive()) return;
      phase = "available";
    } catch (error) {
      if (!alive()) return;
      phase = "open-failed";
      showNativeToast(errorMessage(error), "failure");
    } finally {
      if (alive()) {
        busy = false;
        paintUpdate();
      }
    }
  }
  updateButton.addEventListener("click", () => {
    if (busy) return;
    if (phase === "available" || phase === "open-failed") return runOpen();
    return runCheck();
  });
  updateRow.append(buttonRow([updateButton]));
  wrap.append(updateRow);
  const thanks = div("dtm-about-thanks");
  chromeText(thanks, msg("plugin.about.thanks", { supporterA: SUPPORTER_A, supporterB: SUPPORTER_B }));
  wrap.append(thanks);
  return wrap;
}

function onMessageDoubleClick(event) {
  if (!settings || !settings.enabled) return;
  if (
    event.target.closest(
      `[data-dtm-section-key], #${SEND_BOX_ID}, .dtm-translation-block`,
    )
  )
    return;

  const message = findMessage(event.target);
  if (!message) return;

  if (findAnyTranslationBlock(message)) {
    event.preventDefault();
    event.stopPropagation();
    clearTextSelection();
    dismissMessage(message);
    // Remember the dismissal so periodic restore from cache doesn't bring it back.
    dismissedTranslations.add(getMessageId(message));
    return;
  }

  if (getMessageUnits(message).length === 0) return;

  event.preventDefault();
  event.stopPropagation();
  clearTextSelection();

  dismissedTranslations.delete(getMessageId(message));
  translateMessage(message).catch(() => {});
}

// The browser selects the word on a double-click before our handler runs, leaving the
// message highlighted. preventDefault can't stop that (it happens at mousedown), so just
// clear the selection once we've claimed the double-click as a translate gesture.
function clearTextSelection() {
  const selection =
    typeof window !== "undefined" && typeof window.getSelection === "function"
      ? window.getSelection()
      : null;
  if (selection && typeof selection.removeAllRanges === "function")
    selection.removeAllRanges();
}

async function translateMessage(message, automatic = false) {
  if (!settings.enabled) return;
  const id = getMessageId(message),
    token = Symbol();
  const previous = displayState.get(id);
  if (previous?.active.size) await requests?.cancel([...previous.active]);
  const record = displayState.set(id, {
    token,
    context: readDisplayContext,
    revision: executionRevision,
    automatic,
    units: new Map(),
    active: new Set(),
  });
  for (const unit of getMessageUnits(message)) {
    if (displayState.get(id)?.token !== token || !settings.enabled) return;
    if (automatic && shouldSkipSameLanguage(unit.text)) continue;
    const state = {
      source: unit.text,
      status: "pending",
      text: "",
      revision: executionRevision,
    };
    record.units.set(unit.kind, state);
    const placeholder = renderUnitTranslation(message, unit, msg("plugin.loading"), { chrome: true });
    const operation = requests.request({
      direction: "read",
      text: unit.text,
      priority: automatic ? "background" : "foreground",
    });
    if (operation.requestId) record.active.add(operation.requestId);
    if (placeholder) chromeText(placeholder, msg("plugin.loading"));
    try {
      const result = await operation.promise;
      const live = findLiveMessage(id);
      if (
        !settings.enabled ||
        displayState.get(id)?.token !== token ||
        record.revision !== executionRevision
      ) {
        // This unit's work was detached or superseded while its result was
        // already on its way (cancellation cannot recall a delivered native
        // result): drop the pending state and placeholder so neither a loading
        // block nor a restorable canceled result survives.
        discardDetachedUnit(id, message, record, state, unit);
        continue;
      }
      state.text = result.text;
      state.status = "success";
      const currentUnit =
        live &&
        getMessageUnits(live).find((candidate) => candidate.kind === unit.kind);
      if (!currentUnit || currentUnit.text !== unit.text) {
        findUnitBlock(live || message, unit.kind)?.remove();
        continue;
      }
      renderUnitTranslation(live, currentUnit, result.text, {
        cacheHit: result.cacheHit,
      });
      settingsForm?.reportReadNotice?.("");
    } catch (error) {
      const live = findLiveMessage(id),
        currentUnit =
          live &&
          getMessageUnits(live).find(
            (candidate) => candidate.kind === unit.kind,
          );
      if (
        settings.enabled &&
        displayState.get(id)?.token === token &&
        record.revision === executionRevision &&
        currentUnit?.text === unit.text
      ) {
        state.status = "error";
        state.error = errorMessage(error);
        state.text = "";
        state.retry = !["CANCELED", "STALE_REVISION", "BUSY_SKIPPED", "PAUSED"].includes(error.code);
        const block = renderUnitTranslation(live, currentUnit, state.retry ? msg("plugin.retry", { message: state.error }) : state.error, {
          isError: true, chrome: true,
        });

        if (
          error.code === "PAUSED" &&
          pauseNoticeRevision !== executionRevision
        ) {
          pauseNoticeRevision = executionRevision;
          showNativeToast(msg("plugin.error.PAUSED"), "failure");
        }
        if (!["CANCELED", "STALE_REVISION", "BUSY_SKIPPED"].includes(error.code))
          settingsForm?.reportReadNotice?.(error.code === "PAUSED" ? msg("plugin.error.PAUSED") : errorMessage(error));
      } else discardDetachedUnit(id, message, record, state, unit);
    } finally {
      record.active.delete(operation.requestId);
      displayState.trim();
    }
  }
}

// The unit settled (success or failure) but its work is no longer live: the
// token was invalidated, the revision changed or the plugin turned off. Drop
// this unit's pending state so no late result can be restored later, and remove
// only the placeholder this record still owns — a newer operation on the same
// message keeps its record, block and state untouched.
function discardDetachedUnit(id, message, record, state, unit) {
  if (record.units.get(unit.kind) === state) record.units.delete(unit.kind);
  if (displayState.get(id) === record) findUnitBlock(message, unit.kind)?.remove();
}
function dismissMessage(message) {
  const id = getMessageId(message),
    record = displayState.get(id);
  if (record) {
    requests?.cancel([...record.active]);
    record.token = Symbol();
    record.units.clear();
  }
  removeAllTranslations(message);
  dismissedTranslations.add(id);
  if (dismissedTranslations.size > 500)
    dismissedTranslations.delete(dismissedTranslations.values().next().value);
}
async function clearTranslationCache() {
  return unwrap(await nativeApi.clearCache());
}

// ---- Auto-translate ------------------------------------------------------------
// Use the enabling/channel-entry time, never the newest currently visible message:
// scrolling through history must not turn a newer page of history into new arrivals.

function visibleMessages() {
  return Array.from(
    document.querySelectorAll(
      "[id^='chat-messages-'], [data-list-item-id*='chat-messages']",
    ),
  );
}

function getCurrentChannelId() {
  const match = String(
    (typeof location !== "undefined" && location.pathname) || "",
  ).match(/\/channels\/[^/]+\/(\d+)/);
  return match ? match[1] : "";
}

// Cancel automatic work at its source. The record token is invalidated BEFORE the
// request IDs are canceled: a settling request can then neither render a stale
// result nor let its unit loop start the next unit, and the canceled placeholder
// is removed without a red error block. Only this record's request IDs are
// canceled, so a provider job shared with a manual or send consumer stays alive
// for that consumer. Re-detaching is free: canceled records drop their request
// bookkeeping, so a later disabled maintenance pass adds no cancellation sweep.
function detachAutomaticRecord(record) {
  if (!record || !record.automatic || !record.active.size) return;
  record.token = Symbol();
  const requestIds = [...record.active];
  record.active.clear();
  requests?.cancel(requestIds);
}

function detachAutomaticWork() {
  for (const record of displayState.records.values())
    detachAutomaticRecord(record);
}

function syncCurrentChannel() {
  const id = getCurrentChannelId();
  if (id === currentChannelId) return;
  currentChannelId = id;
  if (id && autoTranslateEnabled()) autoTranslateBaseline.set(id, Date.now());
  // Detach this channel’s automatic consumers, including work already in flight.
  document.getElementById(SEND_BOX_ID)?.__dtmCancelSend?.();
  autoHandledMessages.clear();
  autoEvictionFloor = 0n;
  detachAutomaticWork();
}

function messageSnowflake(message) {
  // Discord ids look like "chat-messages-<channelId>-<messageId>"; the trailing
  // long digit run is the message snowflake (monotonic with time).
  const match = String(getMessageId(message)).match(/(\d{17,21})(?!.*\d)/);
  return match ? match[1] : "";
}

function snowflakeTimestamp(snowflake) {
  // Discord timestamp: https://docs.discord.com/developers/reference#snowflakes
  return snowflake ? Number(BigInt(snowflake) >> 22n) + 1420070400000 : 0;
}

function autoTranslateEnabled() {
  return Boolean(
    settings &&
      settings.enabled &&
      settings.autoTranslate &&
      settings.autoTranslate.enabled,
  );
}

// Called after settings save: when auto-translate is turned off, forget the baselines
// so re-enabling later starts fresh from "now" instead of replaying a backlog.
function applyAutoTranslateSettings() {
  if (!settings.enabled) {
    requests?.cancel();
    for (const block of document.querySelectorAll(".dtm-translation-block"))
      block.remove();
    domWatch?.stop();
    const sendBox = document.getElementById(SEND_BOX_ID);
    removeSendBox(sendBox);
  } else {
    domWatch?.start();
  }
  if (autoTranslateEnabled()) {
    if (currentChannelId && !autoTranslateBaseline.has(currentChannelId))
      autoTranslateBaseline.set(currentChannelId, Date.now());
  } else {
    // Turning only auto-translate off detaches the queued and in-flight automatic
    // work here at its source; rendered translations and manual/send consumers are
    // kept. The sweep runs only while the automatic-work bookkeeping still
    // reflects active auto translation (the channel baseline and handled ids):
    // that is the enable→disable transition. Once it is cleared, later disabled
    // maintenance passes never traverse the display records at all.
    if (autoTranslateBaseline.size || autoHandledMessages.size)
      detachAutomaticWork();
    autoTranslateBaseline.clear();
    autoHandledMessages.clear();
    autoEvictionFloor = 0n;
  }
}

function shouldSkipSameLanguage(text) {
  if (
    !settings.autoTranslate ||
    settings.autoTranslate.skipSameLanguage === false
  )
    return false;
  return (
    !hasLetters(text) ||
    textMatchesLanguage(text, settings.model.targetLanguage)
  );
}

function runAutoTranslate(messages = visibleMessages()) {
  applyAutoTranslateSettings();
  if (!autoTranslateEnabled()) return;
  const channelId = currentChannelId;
  if (!channelId) return;

  const threshold = autoTranslateBaseline.get(channelId);
  for (const message of [...messages].sort((a, b) => {
    const x = BigInt(messageSnowflake(a) || 0),
      y = BigInt(messageSnowflake(b) || 0);
    return x < y ? -1 : x > y ? 1 : 0;
  })) {
    const id = getMessageId(message);
    if (!id || autoHandledMessages.has(id)) continue;
    // Belongs to this channel and is newer than the baseline.
    if (id.indexOf(channelId) === -1) continue;
    const snowflake = messageSnowflake(message);
    if (
      !snowflake ||
      BigInt(snowflake) <= autoEvictionFloor ||
      snowflakeTimestamp(snowflake) <= threshold
    )
      continue;
    if (dismissedTranslations.has(id)) continue;
    if (findAnyTranslationBlock(message)) {
      autoHandledMessages.add(id);
      continue;
    }
    if (getMessageUnits(message).length === 0) continue;
    autoHandledMessages.add(id);
    autoTranslateMessage(message);
  }

  while (autoHandledMessages.size > 2000) {
    const lowest = [...autoHandledMessages].sort((a, b) => {
      const x = BigInt(a.match(/(\d+)$/)?.[1] || 0),
        y = BigInt(b.match(/(\d+)$/)?.[1] || 0);
      return x < y ? -1 : x > y ? 1 : 0;
    })[0];
    autoHandledMessages.delete(lowest);
    const floor = BigInt(lowest.match(/(\d+)$/)?.[1] || 0);
    if (floor > autoEvictionFloor) autoEvictionFloor = floor;
  }
}

function autoTranslateMessage(message) {
  return translateMessage(message, true);
}

function findMessage(target) {
  let node = target instanceof Element ? target : null;
  for (let i = 0; node && i < 10; i += 1, node = node.parentElement) {
    const id = node.getAttribute("id") || "";
    const listId = node.getAttribute("data-list-item-id") || "";
    if (id.includes("chat-messages") || listId.includes("chat-messages"))
      return node;
  }

  return target.closest(
    "[id^='chat-messages-'], [data-list-item-id*='chat-messages'], [class*='messageListItem']",
  );
}

function messageContentEl(message, quote) {
  // The actual message body. Query separately (not one comma selector) so a reply's
  // quoted preview — which also has a [class*='markup'] earlier in the DOM — never
  // wins, and explicitly skip anything inside the quote preview.
  const insideQuote = (el) =>
    Boolean(
      quote && el && typeof quote.contains === "function" && quote.contains(el),
    );
  const byId = message.querySelector("[id^='message-content-']");
  if (byId && !insideQuote(byId)) return byId;
  for (const el of Array.from(
    message.querySelectorAll("[class*='messageContent'], [class*='markup']"),
  )) {
    if (!insideQuote(el)) return el;
  }
  return null;
}

function replyQuoteEl(message) {
  // The "replying to …" preview row (smaller text). Discord hashes class suffixes,
  // so match on the stable id prefix / class substrings; best-effort + fail-safe.
  return (
    message.querySelector("[id^='message-reply-context-']") ||
    message.querySelector("[class*='repliedMessage']")
  );
}

function unitText(el) {
  return el ? String(el.textContent || "").trim() : "";
}

// A message is 1–2 translatable units: an optional quoted preview, plus the body.
// Only recognized actual text qualifies: the container fallbacks are gone, because
// the preview row and the whole message also carry author, time and attachment
// metadata that must never be sent for translation. A missing or empty unit is
// simply skipped.
function getMessageUnits(message) {
  const units = [];
  const quote = replyQuoteEl(message);
  if (quote) {
    const quoteText = unitText(
      quote.querySelector(
        "[class*='repliedTextContent'], [class*='repliedText']",
      ),
    );
    // The quote译文 is anchored right under the (block-level) preview row.
    if (quoteText)
      units.push({ kind: "quote", anchor: quote, text: quoteText });
  }
  const content = messageContentEl(message, quote);
  const bodyText = unitText(content);
  // The body译文 always appends to the bottom of the message — a safe, block-level
  // spot — never anchored to the (possibly inline) content element.
  if (bodyText)
    units.push({
      kind: "content",
      anchor: null,
      source: content,
      text: bodyText,
    });
  return units;
}

function getMessageId(message) {
  return (
    message.getAttribute("id") ||
    message.getAttribute("data-list-item-id") ||
    ""
  );
}

// The async result paths resolve the live message with the same identity as
// getMessageId: the DOM node can be replaced or removed while a request is in
// flight (virtualized lists recycle nodes), so look it up again instead of
// holding the original — first the cheap element-id hit, then a matching id
// among the visible messages for data-list-item-id-only nodes.
function findLiveMessage(id) {
  if (!id) return null;
  const direct = document.getElementById(id);
  if (direct && direct.isConnected !== false) return direct;
  return (
    visibleMessages().find((message) => getMessageId(message) === id) || null
  );
}

function findUnitBlock(message, kind) {
  for (const block of Array.from(
    message.querySelectorAll(".dtm-translation-block"),
  )) {
    if (block.dataset && block.dataset.dtmUnit === kind) return block;
  }
  return null;
}

function findAnyTranslationBlock(message) {
  return message ? message.querySelector(".dtm-translation-block") : null;
}

function removeAllTranslations(message) {
  for (const block of Array.from(
    message.querySelectorAll(".dtm-translation-block"),
  ))
    block.remove();
}

function renderUnitTranslation(message, unit, text, options = {}) {
  if (!settings.enabled) return null;
  const isError = Boolean(options.isError);
  let block = findUnitBlock(message, unit.kind);
  if (!block) {
    block = document.createElement("div");
    block.className = "dtm-translation-block";
    block.dataset.dtmUnit = unit.kind;
    block.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (block.dataset.dtmError === "true") translateMessage(message);
      else dismissMessage(message);
    });
  }
  placeTranslationBlock(message, unit, block);
  block.dataset.dtmError = isError ? "true" : "false";
  block.dataset.dtmCacheHit = options.cacheHit ? "true" : "false";
  block.__dtmChrome = Boolean(options.chrome || isError);
  if (block.__dtmChrome) chromeText(block, text);
  else {
    clearChrome(block);
    block.textContent = text;
    block.lang = translationTag(settings.model.targetLanguage);
  }
  applyTranslationStyle(block, unit.kind === "quote");
  return block;
}

function placeTranslationBlock(message, unit, block) {
  const above = settings.style.position === "above";
  if (
    unit.anchor &&
    typeof unit.anchor.insertAdjacentElement === "function" &&
    unit.anchor.parentElement
  ) {
    unit.anchor.insertAdjacentElement(
      above ? "beforebegin" : "afterend",
      block,
    );
    return;
  }
  if (
    above &&
    unit.source &&
    typeof unit.source.insertAdjacentElement === "function" &&
    unit.source.parentElement
  ) {
    unit.source.insertAdjacentElement("beforebegin", block);
    return;
  }
  if (block.parentElement) block.remove();
  message.appendChild(block);
}

function restoreVisibleTranslations(messages = visibleMessages()) {
  if (!settings.enabled) return;
  for (const message of messages) {
    const id = getMessageId(message),
      record = displayState.get(id);
    for (const unit of getMessageUnits(message)) {
      const state = record?.units.get(unit.kind);
      if (
        record?.revision !== executionRevision ||
        state?.source !== unit.text
      ) {
        findUnitBlock(message, unit.kind)?.remove();
        continue;
      }
      if (
        state?.status === "success" &&
        !dismissedTranslations.has(id) &&
        !findUnitBlock(message, unit.kind)
      )
        renderUnitTranslation(message, unit, state.text);
    }
  }
}

function refreshTranslationStyles() {
  for (const block of document.querySelectorAll(".dtm-translation-block")) {
    const message = findMessage(block);
    const unit =
      message &&
      getMessageUnits(message).find(
        (candidate) => candidate.kind === block.dataset.dtmUnit,
      );
    if (message && unit) placeTranslationBlock(message, unit, block);
    applyTranslationStyle(block, block.dataset.dtmUnit === "quote");
  }
}

function applyTranslationStyle(block, small) {
  applyTranslationStyleObject(
    block,
    settings.style,
    block.dataset.dtmError === "true",
    small,
  );
  const above = settings.style.position === "above";
  block.style.marginTop = above
    ? "0"
    : settings.style.background === false
      ? "2px"
      : "6px";
  block.style.marginBottom = above
    ? settings.style.background === false
      ? "2px"
      : "6px"
    : "0";
}

function applyTranslationStyleObject(block, style, isError, small) {
  Object.assign(block.style, translationPreviewStyle(style, isError));
  if (small) {
    // The quoted message is shown small in Discord, so its译文 matches.
    const fontSize = Number(style.fontSize) || 14;
    block.style.fontSize = `${Math.max(11, Math.round(fontSize * 0.78))}px`;
  }
}

const STYLE_MARKER_BAND =
  "linear-gradient(transparent 54%, color-mix(in srgb, currentColor 24%, transparent) 54%, color-mix(in srgb, currentColor 24%, transparent) 92%, transparent 92%)";

function translationPreviewStyle(style, isError) {
  const emphasis = style.emphasis || "none";
  const backgroundOn = style.background !== false;
  const backgroundColor =
    style.backgroundColor === "auto"
      ? "var(--background-surface-high, var(--background-secondary))"
      : style.backgroundColor;
  return {
    backgroundColor: backgroundOn ? backgroundColor : "transparent",
    backgroundImage: emphasis === "marker" ? STYLE_MARKER_BAND : "none",
    color: isError
      ? "var(--text-feedback-critical, var(--text-danger))"
      : style.textColor === "auto"
        ? automaticTextColor(style)
        : style.textColor,
    opacity: emphasis === "light" ? "0.72" : "1",
    fontWeight: emphasis === "bold" ? "700" : "400",
    // No background → no bubble: drop the card padding/border/shadow and sit the
    // translation right under the original message instead of in a padded box.
    padding: backgroundOn ? "" : "1px 0 0",
    marginTop: backgroundOn ? "" : "2px",
    borderColor: backgroundOn ? "" : "transparent",
    boxShadow: backgroundOn ? "" : "none",
    borderRadius: `${style.borderRadius}px`,
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    textDecorationLine: emphasisDecorationLine(emphasis),
    textDecorationStyle: emphasis === "wavy" ? "wavy" : "solid",
  };
}

function automaticTextColor(style) {
  const color =
    style.background !== false &&
    /^#[0-9a-f]{6}$/i.test(style.backgroundColor || "")
      ? style.backgroundColor.slice(1)
      : "";
  if (!color) return "var(--text-default, var(--text-normal))";
  const [r, g, b] = color.match(/../g).map((hex) => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? "#111827" : "#f2f3f5";
}

function emphasisDecorationLine(emphasis) {
  if (emphasis === "strike") return "line-through";
  if (emphasis === "underline" || emphasis === "wavy") return "underline";
  return "none";
}

function removeSendBox(box) {
  box?.__dtmDispose?.();
  box?.remove();
}

function ensureSendBox() {
  const existing = document.getElementById(SEND_BOX_ID);

  if (!settings || !settings.enabled || !settings.sendTranslation.enabled) {
    removeSendBox(existing);
    return;
  }

  // The box lives on the document root as a fixed overlay, never inside Discord's
  // React-managed composer tree, so it can't crash the native input. We still read
  // the composer to detect the active view and compute the default position. It only
  // appears when send-translation is enabled — users who don't need it see nothing.
  const editor = findDiscordEditor();
  const mount = editor ? findDiscordComposerMount(editor) : null;
  if (!mount) {
    if (existing) existing.style.display = "none";
    return;
  }

  const box = existing || createSendBox();
  if (!existing) (document.body || document.documentElement).appendChild(box);
  box.style.display = "";
  positionSendBox(box, mount);
  applyComposerBackground(box, editor);
  applySendBoxOpacity(box);
  const status = box.querySelector("span");
  if (status && status.textContent === status.dataset.dtmHint) {
    const hint = enterHint();
    if (status.textContent !== text(hint)) chromeText(status, hint);
    status.dataset.dtmHint = text(hint);
  }
}

function applySendBoxOpacity(box) {
  const opacity = settings && settings.sendBox ? settings.sendBox.opacity : 1;
  box.style.opacity = String(Number.isFinite(opacity) ? opacity : 1);
}

function applyComposerBackground(box, editor) {
  // Match the real Discord message-input background (follows the active theme)
  // instead of guessing a CSS token that may not resolve in this build.
  if (!editor || typeof getComputedStyle !== "function") return;
  let node = editor;
  for (
    let depth = 0;
    node && depth < 6;
    depth += 1, node = node.parentElement
  ) {
    const bg = getComputedStyle(node).backgroundColor;
    const match = bg && bg.match(/rgba?\(([^)]+)\)/);
    if (!match) continue;
    const parts = match[1].split(",").map((part) => part.trim());
    const alpha = parts.length === 4 ? parseFloat(parts[3]) : 1;
    if (alpha > 0) {
      box.style.background = bg;
      return;
    }
  }
}

function createSendBox() {
  const box = document.createElement("div");
  box.id = SEND_BOX_ID;

  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "dtm-send-grip";
  grip.textContent = "⠿";
  chromeText(grip, msg("plugin.send.drag"), "aria-label");

  const input = document.createElement("input");
  input.type = "text";
  chromeText(input, msg("plugin.send.input"), "aria-label");

  const status = document.createElement("span");
  chromeText(status, enterHint());
  status.dataset.dtmHint = status.textContent;
  let statusTimer = 0;

  input.addEventListener("keydown", async (event) => {
    if (event.key === "Escape" && input.readOnly) {
      event.stopPropagation();
      event.preventDefault();
      box.__dtmCancelSend?.();
      return;
    }
    if (event.key !== "Enter") return;
    event.stopPropagation();
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      input.readOnly ||
      event.repeat ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;
    const channelId = getCurrentChannelId();
    const editor = findDiscordEditor();
    const send = settings.sendTranslation.enterToSend;
    if (!editor) return;
    let canceled = false;
    const current = () =>
      !canceled &&
      settings.enabled &&
      settings.sendTranslation.enabled &&
      box.isConnected &&
      editor.isConnected &&
      channelId === getCurrentChannelId() &&
      editor === findDiscordEditor();

    input.readOnly = true;
    clearTimeout(statusTimer);
    delete status.dataset.error;
    chromeText(status, msg("plugin.send.loading"));
    let id;
    box.__dtmCancelSend = () => {
      canceled = true;
      requests.cancel(box.__dtmSendRequest ? [box.__dtmSendRequest] : []);
      if (id != null) nativeApi.cancelSend(id).catch(() => {});
    };

    try {
      id = await nativeApi.beginSend(send);
      if (canceled)
        throw Object.assign(new Error("已取消发送翻译，原文已保留。"), {
          code: "CANCELED", reason: "SEND",
        });
      if (!current())
        throw failure("COMPOSER_CHANGED");
      const operation = requests.request({ direction: "send", text });
      box.__dtmSendRequest = operation.requestId;
      const result = await operation.promise;
      if (!current())
        throw failure("COMPOSER_CHANGED");
      const outcome = await nativeApi.insertAndSend({ id, text: result.text });
      if (!outcome || !outcome.ok)
        throw Object.assign(failure("COMPOSER_UNAVAILABLE"), outcome?.error && typeof outcome.error === "object" ? outcome.error : {});
      input.value = "";
      chromeText(status, msg(outcome.sent === false ? "plugin.send.inserted" : "plugin.send.submitted"));
      if (current())
        statusTimer = setTimeout(() => {
          chromeText(status, enterHint());
          status.dataset.dtmHint = status.textContent;
        }, 1200);
      if (statusTimer && typeof statusTimer.unref === "function")
        statusTimer.unref();
    } catch (error) {
      status.dataset.error = "true";
      chromeText(status, errorMessage(error));
    } finally {
      delete box.__dtmCancelSend;
      delete box.__dtmSendRequest;
      if (id != null)
        await nativeApi
          .cancelSend(id)
          .catch((error) => diagnosticLog(publicError(error)));
      input.readOnly = false;
      if (current() && send) input.focus();
    }
  });

  const resize = document.createElement("div");
  resize.className = "dtm-send-resize";
  chromeText(resize, msg("plugin.send.resize"), "aria-label");

  const stopDrag = installSendBoxDrag(box, grip);
  const stopResize = installSendBoxResize(box, resize);
  box.__dtmDispose = () => {
    clearTimeout(statusTimer);
    box.__dtmCancelSend?.();
    stopDrag();
    stopResize();
  };
  box.append(grip, input, status, resize);
  return box;
}

function hasCustomSendBoxPos() {
  return Boolean(
    settings.sendBox &&
      Number.isFinite(settings.sendBox.x) &&
      Number.isFinite(settings.sendBox.y),
  );
}

function hasCustomSendBoxWidth() {
  return Boolean(
    settings.sendBox &&
      Number.isFinite(settings.sendBox.width) &&
      settings.sendBox.width > 0,
  );
}

function positionSendBox(box, mount) {
  if (box.dataset.dtmDragging === "true" || box.dataset.dtmResizing === "true")
    return;
  const rect =
    typeof mount.getBoundingClientRect === "function"
      ? mount.getBoundingClientRect()
      : null;

  if (hasCustomSendBoxWidth()) {
    box.style.width = `${settings.sendBox.width}px`;
  } else if (rect && rect.width) {
    box.style.width = `${Math.round(rect.width)}px`;
  }

  if (hasCustomSendBoxPos()) {
    applyBoxPosition(box, settings.sendBox.x, settings.sendBox.y);
  } else if (rect && rect.width) {
    // Default: sit just above the native composer, matching its width.
    const rectLeft = Number.isFinite(rect.left) ? rect.left : rect.x;
    const rectTop = Number.isFinite(rect.top) ? rect.top : rect.y;
    applyBoxPosition(
      box,
      Math.round(rectLeft),
      Math.round(rectTop - (box.offsetHeight || 0) - 8),
    );
  }
}

function applyBoxPosition(box, x, y) {
  let nx = Number.isFinite(x) ? x : 0;
  let ny = Number.isFinite(y) ? y : 0;
  if (typeof window !== "undefined" && window.innerWidth) {
    nx = Math.min(
      Math.max(0, nx),
      Math.max(0, window.innerWidth - (box.offsetWidth || 0)),
    );
    ny = Math.min(
      Math.max(0, ny),
      Math.max(0, window.innerHeight - (box.offsetHeight || 0)),
    );
  } else {
    nx = Math.max(0, nx);
    ny = Math.max(0, ny);
  }
  box.style.left = `${Math.round(nx)}px`;
  box.style.top = `${Math.round(ny)}px`;
  box.style.right = "auto";
  box.style.bottom = "auto";
}

function installSendBoxDrag(box, grip) {
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const onMove = (event) => {
    applyBoxPosition(
      box,
      originLeft + (event.clientX - startX),
      originTop + (event.clientY - startY),
    );
  };
  const stop = () => {
    box.dataset.dtmDragging = "false";
    if (typeof document !== "undefined") {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", stop, true);
    }
  };
  const onUp = () => {
    stop();
    if (box.isConnected && settings.enabled && settings.sendTranslation.enabled)
      persistSendBoxPosition(box);
  };

  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = box.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    startX = event.clientX;
    startY = event.clientY;
    box.dataset.dtmDragging = "true";
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", stop, true);
  });

  grip.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetSendBoxPosition(box);
  });
  return stop;
}

function installSendBoxResize(box, handle) {
  let startX = 0;
  let startWidth = 0;

  const onMove = (event) => {
    box.style.width = `${clampBoxWidth(startWidth + (event.clientX - startX))}px`;
  };
  const stop = () => {
    box.dataset.dtmResizing = "false";
    if (typeof document !== "undefined") {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", stop, true);
    }
  };
  const onUp = () => {
    stop();
    if (box.isConnected && settings.enabled && settings.sendTranslation.enabled)
      persistSendBoxWidth(box);
  };

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    startX = event.clientX;
    startWidth = box.getBoundingClientRect().width;
    box.dataset.dtmResizing = "true";
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", stop, true);
  });

  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetSendBoxWidth(box);
  });
  return stop;
}

function clampBoxWidth(width) {
  const max =
    typeof window !== "undefined" && window.innerWidth
      ? window.innerWidth
      : 4000;
  return Math.min(Math.max(220, Math.round(width)), max);
}

async function saveSendBox(patch, box, mount) {
  settings.sendBox = { ...settings.sendBox, ...patch };
  try {
    applySnapshot(unwrap(await nativeApi.patchSendBox(patch)));
  } catch (error) {
    diagnosticLog(publicError(error));
  }
  if (box && mount) positionSendBox(box, mount);
}

function activeComposerMount() {
  const editor = findDiscordEditor();
  return editor ? findDiscordComposerMount(editor) : null;
}

function persistSendBoxPosition(box) {
  const rect = box.getBoundingClientRect();
  return saveSendBox({ x: Math.round(rect.left), y: Math.round(rect.top) });
}

function resetSendBoxPosition(box) {
  return saveSendBox({ x: null, y: null }, box, activeComposerMount());
}

function persistSendBoxWidth(box) {
  return saveSendBox({ width: Math.round(box.getBoundingClientRect().width) });
}

function resetSendBoxWidth(box) {
  return saveSendBox({ width: null }, box, activeComposerMount());
}

function enterHint() {
  return msg(settings.sendTranslation.enterToSend ? "plugin.send.enter" : "plugin.send.insert");
}

function findDiscordComposerMount(editor) {
  return (
    editor.closest("[class*='channelTextArea']") ||
    editor.closest("[class*='scrollableContainer']") ||
    editor.closest("form") ||
    editor.parentElement
  );
}

function findDiscordEditor() {
  return document.querySelector("[role='textbox'][contenteditable='true']");
}

function div(className) {
  const node = document.createElement("div");
  if (className) node.className = className;
  return node;
}

function reactControlHost(kind, className) {
  const host = div(className);
  host.dataset.dtmNativeReactControl = "true";
  host.dataset.dtmNativeReactKind = kind;
  return host;
}

function button(label, variant) {
  const host = reactControlHost("button");
  host.dataset.dtmButtonDisabled = "false";
  host.dataset.dtmButtonLoading = "false";

  let currentLabel = label;

  function renderButton() {
    mountDiscordReactControl(host, {
      kind: "button",
      label: currentLabel,
      variant: variant === "secondary" ? "secondary" : "primary",
      disabled: host.disabled,
      loading: host.dataset.dtmButtonLoading === "true",
    });
  }

  host.setLabel = (value) => {
    currentLabel = value;
    renderButton();
  };
  host.setBusy = (value) => {
    if (value) host.setAttribute("aria-busy", "true");
    else host.removeAttribute("aria-busy");
  };
  host.setLive = (value) => {
    if (value === "polite" || value === "assertive") host.setAttribute("aria-live", value);
    else host.removeAttribute("aria-live");
  };

  Object.defineProperty(host, "disabled", {
    configurable: true,
    get() {
      return host.dataset.dtmButtonDisabled === "true";
    },
    set(value) {
      host.dataset.dtmButtonDisabled = value ? "true" : "false";
      renderButton();
    },
  });

  host.setLoading = (value) => {
    host.dataset.dtmButtonLoading = value ? "true" : "false";
    renderButton();
  };

  renderButton();
  return host;
}

function disposeControls(node) {
  const ids = Array.from(node.querySelectorAll("[data-dtm-control-id]")).map(
    (host) => {
      host.dataset.dtmNativeReactMounted = "disposed";
      mainWorldControlCallbacks.delete(host.dataset.dtmControlId);
      controlHosts.delete(host.dataset.dtmControlId);
      return host.dataset.dtmControlId;
    },
  );
  if (ids.length) sendMainWorldMessage("dtm:unmount-controls", { ids });
}

function clearChildren(node) {
  disposeControls(node);
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren();
    return;
  }
  if (Array.isArray(node.children)) node.children.length = 0;
  else while (node.firstChild) node.firstChild.remove();
}

function mountDiscordReactControl(host, bridgeSpec) {
  if (bridgeSpec && requestMainWorldControl(host, bridgeSpec)) {
    return true;
  }

  host.dataset.dtmNativeReactMounted = "false";
  host.dataset.dtmNativeReactError = MAIN_WORLD_BRIDGE_ERROR;
  diagnosticLog(host.dataset.dtmNativeReactError);
  return false;
}

function diagnosticLog(message) {
  const text = `[Babel] ${String(message || "Unknown Discord UI mount error.")}`;
  if (diagnosticLoggedMessages.has(text)) return;
  diagnosticLoggedMessages.add(text);
  if (typeof console !== "undefined" && typeof console.warn === "function")
    console.warn(text);
}

function showNativeToast(message, tone = "message") {
  // Always route feedback through Discord's own toast system so it inherits the
  // active light/dark theme instead of a hand-rolled panel toast with fixed colors.
  return requestMainWorldToast({ message: text(message), tone });
}

function sendMainWorldMessage(type, detail) {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof window.CustomEvent !== "function"
  ) {
    return false;
  }

  mainWorldMessageId += 1;
  const payload = {
    ...detail,
    __dtmMessageId: `dtm-renderer-${mainWorldMessageId}`,
  };
  window.dispatchEvent(new window.CustomEvent(type, { detail: payload }));
  if (typeof window.postMessage === "function") {
    window.postMessage({ source: "dtm", type, detail: payload }, "*");
  }
  return true;
}

function requestMainWorldControl(host, spec) {
  installMainWorldControlEvents();

  let id = host.dataset.dtmControlId;
  if (!id) {
    nativeControlId += 1;
    id = `dtm-control-${nativeControlId}`;
  }
  if (host.dataset.dtmNativeReactMounted === "disposed") return false;
  host.__dtmControlSource = spec;
  spec = localizedSpec(spec);
  host.__dtmControlSpec = spec;
  host.lang = i18n.getLocale();
  controlHosts.set(id, host);
  host.dataset.dtmControlId = id;
  host.dataset.dtmNativeReactMounted = "pending";
  host.dataset.dtmControlMountVersion = String(
    Number(host.dataset.dtmControlMountVersion || 0) + 1,
  );
  mainWorldControlCallbacks.set(
    id,
    typeof spec.onChange === "function" ? spec.onChange : () => {},
  );

  const detail = { ...spec, id };
  delete detail.onChange;
  const sent = sendMainWorldMessage("dtm:mount-control", detail);
  if (sent)
    scheduleMainWorldControlRetry(
      host,
      detail,
      host.dataset.dtmControlMountVersion,
      1,
    );
  return sent;
}

function requestMainWorldToast(detail) {
  if (!sendMainWorldMessage("dtm:show-toast", detail)) {
    diagnosticLog(MAIN_WORLD_BRIDGE_ERROR);
    return false;
  }
  return true;
}

function messageSequence(id) {
  // Main-world sends a primitive canonical dtm-main-<positive decimal>.
  // Boxed strings compare by identity, so they are rejected before coercion.
  if (typeof id !== "string") return null;
  const text = id;
  const prefix = "dtm-main-";
  const suffix = text.slice(prefix.length);
  if (!text.startsWith(prefix) || !/^[1-9][0-9]*$/.test(suffix)) return null;
  const value = Number(suffix);
  return Number.isSafeInteger(value) ? value : null;
}

function acceptMessageId(state, id) {
  const sequence = messageSequence(id);
  if (sequence == null) return false;
  if (state.ids.has(id) || (state.floor && sequence <= state.floor)) return false;
  state.ids.add(id);
  if (sequence > state.highest) state.highest = sequence;
  if (state.ids.size > 1000) {
    state.floor = state.highest - 1000;
    for (const seen of state.ids) {
      const seenSequence = messageSequence(seen);
      if (seenSequence != null && seenSequence <= state.floor) state.ids.delete(seen);
    }
  }
  return true;
}

function shouldHandleMainWorldMessage(detail) {
  const id = detail && detail.__dtmMessageId;
  if (!id) return true;
  return acceptMessageId(handledMainWorldMessages, id);
}

function scheduleMainWorldControlRetry(host, detail, version, attempt) {
  if (
    attempt >= MAIN_WORLD_CONTROL_MAX_ATTEMPTS ||
    typeof window === "undefined" ||
    typeof window.setTimeout !== "function"
  ) {
    return;
  }
  window.setTimeout(() => {
    if (
      !host ||
      host.dataset.dtmControlMountVersion !== version ||
      host.dataset.dtmNativeReactMounted !== "pending"
    ) {
      return;
    }
    const latest = { ...localizedSpec(host.__dtmControlSource), id: detail.id };
    delete latest.onChange;
    if (!sendMainWorldMessage("dtm:mount-control", latest)) return;
    scheduleMainWorldControlRetry(host, detail, version, attempt + 1);
  }, MAIN_WORLD_CONTROL_RETRY_MS);
}

function installMainWorldControlEvents() {
  if (mainWorldControlEventsInstalled || typeof window === "undefined") return;
  mainWorldControlEventsInstalled = true;

  window.addEventListener("dtm:settings-open", (event) => {
    if (shouldHandleMainWorldMessage(event.detail))
      openSettingsPanel(event.detail?.key);
  });
  window.addEventListener("dtm:settings-close", (event) => {
    if (!shouldHandleMainWorldMessage(event.detail)) return;
    closeSettingsPanel();
  });
  window.addEventListener("dtm:control-change", (event) => {
    const detail = event.detail || {};
    if (!shouldHandleMainWorldMessage(detail)) return;
    const callback = mainWorldControlCallbacks.get(detail.id);
    if (callback) callback(detail.value);
  });

  window.addEventListener("dtm:control-mounted", (event) => {
    const detail = event.detail || {};
    if (!shouldHandleMainWorldMessage(detail)) return;
    handleMainWorldControlMounted(detail);
  });

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (event.source !== window || data.source !== "dtm") return;
    if (data.type === "dtm:settings-open") {
      if (shouldHandleMainWorldMessage(data.detail))
        openSettingsPanel(data.detail?.key);
      return;
    }
    if (data.type === "dtm:settings-close") {
      if (shouldHandleMainWorldMessage(data.detail)) {
        closeSettingsPanel();
      }
      return;
    }
    if (data.type === "dtm:control-change") {
      const detail = data.detail || {};
      if (!shouldHandleMainWorldMessage(detail)) return;
      const callback = mainWorldControlCallbacks.get(detail.id);
      if (callback) callback(detail.value);
      return;
    }
    if (data.type === "dtm:control-mounted") {
      const detail = data.detail || {};
      if (!shouldHandleMainWorldMessage(detail)) return;
      handleMainWorldControlMounted(detail);
      return;
    }
  });
}

function handleMainWorldControlMounted(detail) {
  const host = document.querySelector(`[data-dtm-control-id="${detail.id}"]`);
  if (!host) return;
  host.dataset.dtmNativeReactMounted = detail.ok ? "true" : "false";
  if (detail.error) {
    host.dataset.dtmNativeReactError = detail.error?.code || "CONFIG";
    diagnosticLog(host.dataset.dtmNativeReactError);
  }
}

function translationStylePreview(style) {
  const host = reactControlHost("translation-preview");
  let currentStyle = { ...style };

  function renderPreview() {
    // Re-mount through the bridge without wiping the host: the main-world React
    // root owns these children, so clearing them would corrupt its reconciliation
    // and blank the preview on every color change.
    mountDiscordReactControl(host, {
      kind: "translation-preview",
      name: msg("plugin.preview"),
      previewText: msg("plugin.previewText"),
      style: translationPreviewStyle(currentStyle, false),
    });
  }

  host.updateStyle = (nextStyle) => {
    currentStyle = { ...nextStyle };
    renderPreview();
  };
  renderPreview();
  return host;
}

function refreshStylePreview(wrapper, style) {
  if (wrapper && typeof wrapper.updateStyle === "function") {
    wrapper.updateStyle(style);
    return;
  }
  const block = wrapper.querySelector("[data-dtm-style-preview-block='true']");
  if (!block) return;
  applyTranslationStyleObject(block, style, false);
}

function section(_title, children, sectionKey) {
  const rows = div(DISCORD_UI.stack);
  rows.id = settingsSectionId(sectionKey);
  applyDiscordStackLayout(rows, DISCORD_STACK_LAYOUTS.rows);
  for (const child of children) rows.appendChild(settingRow(child));
  return rows;
}

function applyHidden(node, hidden) {
  if (!node) return;
  node.hidden = hidden;
  if (hidden) node.setAttribute("hidden", "");
  else node.removeAttribute("hidden");
}

function setRowVisible(host, visible) {
  if (!host) return;
  host.__dtmVisible = Boolean(visible);
  const self = host.dataset && host.dataset.dtmSelfHide === "true";
  const row = !self && typeof host.closest === "function" ? host.closest("[data-dtm-native-setting-row]") : null;
  applyHidden(self ? host : row || host, !visible);
  if (row && row !== host) applyHidden(host, false);
}

function settingRow(child) {
  const row = div(DISCORD_UI.settingCard);
  row.dataset.dtmNativeSettingRow = "true";

  const inner = stack("settingRow", DISCORD_UI.settingStack);
  inner.appendChild(child);
  row.appendChild(inner);
  if (child && child.__dtmVisible === false) applyHidden(row, true);
  if (child && !(child.dataset && child.dataset.dtmSelfHide === "true")) applyHidden(child, false);
  return row;
}

function actionRow(statuses, buttons) {
  const row = div();
  row.dataset.dtmActions = "true";
  for (const status of [].concat(statuses)) {
    if (!status) continue;
    status.dataset.dtmSelfHide = "true";
    row.appendChild(status);
  }
  const actions = buttonRow(buttons);
  actions.dataset.dtmActionButtons = "true";
  row.appendChild(actions);
  return row;
}

function buttonRow(children) {
  const row = stack("actionsRow");
  for (const child of children) row.appendChild(child);
  return row;
}

function stack(layout, className = DISCORD_UI.stack) {
  const node = div(className);
  applyDiscordStackLayout(node, DISCORD_STACK_LAYOUTS[layout]);
  return node;
}

function applyDiscordStackLayout(node, layout) {
  if (!layout) return;
  node.setAttribute("data-align", layout.align);
  node.setAttribute("data-justify", layout.justify);
  node.setAttribute("data-direction", layout.direction);
  node.setAttribute("data-wrap", layout.wrap);
  node.setAttribute("data-full-width", layout.fullWidth);
  node.setAttribute("style", layout.style);
}

function passwordField(name, value, onChange, placeholder, disabled = false) {
  return inputField(name, "password", value, onChange, { placeholder, disabled });
}

function inputField(name, type, value, onChange, options = {}) {
  const resolvedKind = type === "textarea" ? "text-area" : "text-input";
  const host = reactControlHost(resolvedKind);

  mountDiscordReactControl(host, {
    kind: resolvedKind,
    name,
    type:
      type === "password" ? "password" : type === "number" ? "number" : "text",
    value: value == null ? "" : String(value),
    placeholder: options.placeholder || "",
    min: options.min,
    max: options.max,
    maxLength: options.maxLength,
    disabled: Boolean(options.disabled),
    onChange,
  });

  return host;
}

function languageSelectField(name, value, onChange) {
  return selectField(
    name,
    value,
    optionsWithCurrentValue(LANGUAGE_OPTIONS, value),
    onChange,
  );
}

function providerById(value) {
  return (
    MODEL_PROVIDERS.find((provider) => provider.value === value) ||
    MODEL_PROVIDERS[0]
  );
}

function providerHasApiKey(provider) {
  return Boolean(providerApiKeyStatus && providerApiKeyStatus[provider]);
}

function providerOptionsWithStatus(status) {
  const saved = status && typeof status === "object" ? status : {};
  return MODEL_PROVIDERS.map((provider) => ({
    value: provider.value,
    label: provider.value === "custom" ? msg("plugin.provider.custom") : ["ollama", "lmstudio"].includes(provider.value) ? msg("plugin.provider.local", { provider: provider.value === "ollama" ? "Ollama" : "LM Studio" }) : provider.label,
    savedKeyLabel: msg("plugin.key.savedAria"),
    apiKeySaved: Boolean(saved[provider.value]),
  }));
}

function apiKeyPlaceholder(provider) {
  if (!providerHasApiKey(provider)) return msg("plugin.key.paste");
  const previews = providerApiKeyStatus && providerApiKeyStatus.previews;
  const masked = previews && previews[provider];
  return masked ? msg("plugin.key.savedPlaceholder", { preview: masked }) : msg("plugin.key.replacePlaceholder");
}

function apiKeyValueForRequest(value) {
  const trimmed = String(value || "").trim();
  return trimmed && trimmed !== API_KEY_MASK ? trimmed : "";
}

function safeSwatch(value) {
  const text = String(value || "").trim();
  if (/^auto$/i.test(text)) return "auto";
  const match = /^#([0-9a-fA-F]{6})$/.exec(text);
  return match ? `#${match[1].toUpperCase()}` : "";
}

function colorChoices(options, current) {
  const saved = String(current ?? "");
  const trimmed = saved.trim();
  const withSwatch = (option) => {
    const swatch = safeSwatch(option.value);
    return swatch ? { ...option, swatch } : { ...option };
  };
  if (!trimmed || options.some((option) => option.value === saved)) return options.map(withSwatch);
  const match = options.findIndex((option) => String(option.value).toLowerCase() === trimmed.toLowerCase());
  if (match >= 0) {
    return options.map((option, index) => {
      const next = withSwatch(option);
      if (index !== match) return next;
      const swatch = safeSwatch(saved) || next.swatch;
      return { ...next, value: saved, ...(swatch ? { swatch } : {}) };
    });
  }
  const swatch = safeSwatch(trimmed);
  if (swatch && swatch !== "auto") {
    return options.map(withSwatch).concat({ value: saved, label: msg("plugin.color.custom"), swatch });
  }
  return options.map(withSwatch).concat({ value: saved, label: saved });
}

function optionsWithCurrentValue(options, value) {
  const current = String(value || "").trim();
  if (!current || options.some((option) => option.value === current))
    return options;
  return options.concat({ value: current, label: current });
}

function selectField(name, value, options, onChange) {
  const items = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  const host = reactControlHost("select");

  mountDiscordReactControl(host, {
    kind: "select",
    name,
    value,
    options: items,
    onChange,
  });

  return host;
}

function modelComboBoxHostFor(name, value, options, onChange) {
  const host = reactControlHost("combobox");

  host.updateOptions = (nextValue, nextOptions) => {
    mountDiscordReactControl(host, {
      kind: "combobox",
      name,
      placeholder: msg("plugin.modelPlaceholder"),
      value: nextValue,
      options: nextOptions.map(comboBoxOption),
      onChange,
    });
  };

  host.updateOptions(value, options);

  return host;
}

function comboBoxOption(option) {
  const item =
    typeof option === "string" ? { value: option, label: option } : option;
  const value = item && item.value != null ? String(item.value) : "";
  const label = item && item.label != null ? item.label : value;
  return { ...item, id: value, value, label };
}

function toggleRow(name, checked, onChange) {
  const host = reactControlHost("switch");

  mountDiscordReactControl(host, {
    kind: "switch",
    name,
    value: Boolean(checked),
    onChange,
  });

  return host;
}

function publicError(error) {
  let message = error && error.message ? error.message : String(error);
  message = message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
     .replace(/^Error:\s*/i, "");




  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/([?&]key=)[^&\s]+/g, "$1[redacted]")
    .replace(
      /x-api-key\s*[:=]\s*[A-Za-z0-9._~+/=-]+/gi,
      "x-api-key: [redacted]",
    );
}

module.exports = { start };

/* @dtm-test-only:start */
function setRuntimeForTests(runtime) {
  nativeApi = runtime.nativeApi || {};
  settings = normalizeSettings(runtime.settings);
  systemLocale = UI_LOCALES.includes(runtime.systemLocale) ? runtime.systemLocale : "zh-Hans";
  i18n.setLocale(systemLocale);
  controlHosts.clear();
  settingsRevision = 1;
  executionRevision = 1;
  credentialContext = readDisplayContext = "";
  pauseNoticeRevision = 0;
  requests = new RequestClient(nativeApi, () => executionRevision);
  displayState = new DisplayState();
  providerApiKeyStatus = runtime.providerApiKeyStatus || {};
  nativeStatus = runtime.nativeStatus || null;
  nativeError = nativeStatus ? errorMessage(nativeStatus) : runtime.nativeError || "";
  settingsPageOpen = false;
  settingsPageGeneration++;
  activeSettingsKey = "general";
  settingsSections.clear();
  mainWorldControlCallbacks.clear();
  handledMainWorldMessages.ids.clear();
  handledMainWorldMessages.highest = 0;
  handledMainWorldMessages.floor = 0;
  mainWorldControlEventsInstalled = false;
  dismissedTranslations = new Set();
  currentChannelId = runtime.channelId || "";
  autoTranslateBaseline = new Map();
  autoHandledMessages = new Set();
  autoEvictionFloor = 0n;
  settingsForm = null;
  retainedDraft = null;
}
function resetRuntimeForTests() {
  requests?.cancel();
  domWatch?.stop();
  domWatch = null;
  settingsForm = null;
  settingsPageOpen = false;
  activeSettingsKey = "general";
  settingsSections.clear();
}
module.exports.__test = {
  openSettingsPanel,
  closeSettingsPanel,
  clearChildren,
  createSendBox,
  SETTINGS_LABEL,
  apiKeyPlaceholder,
  apiKeyValueForRequest,
  button,
  ensureSendBox,
  inputField,
  injectBaseStyles,
  languageSelectField,
  modelComboBoxHostFor,
  onMessageDoubleClick,
  publicError,
  providerOptionsWithStatus,
  resetRuntimeForTests,
  section,
  setRuntimeForTests,
  showNativeToast,
  translateMessage,
  translationPreviewStyle,
  toggleRow,
  applyAutoTranslateSettings,
  autoTranslateMessage,
  clearTranslationCache,
  acceptMainWorldMessageId: (id) => acceptMessageId(handledMainWorldMessages, id),
  mainWorldDedupeSize: () => handledMainWorldMessages.ids.size,
  getSettingsForTests: () => settings,
  getCurrentChannelId,
  messageSnowflake,
  runAutoTranslate,
  shouldSkipSameLanguage,
  snowflakeTimestamp,
  syncCurrentChannel,
  restoreVisibleTranslations,
  refreshTranslationStyles,
  applySnapshot,
  refreshUiChrome,
  getUiLocale: i18n.getLocale,
  getFormForTests: () => settingsForm,
  safeSwatch,
  injectBaseStyles,
  msg,
  text,
  controlHosts,
  displayState: () => displayState,
};
/* @dtm-test-only:end */
