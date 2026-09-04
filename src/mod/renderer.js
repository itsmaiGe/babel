"use strict";

const { createHash } = require("node:crypto");
const { MODEL_PROVIDERS, TRANSLATION_STYLE_PRESETS, BABEL_VERSION } = requireShared("defaults");
const { normalizeSettings } = requireShared("settings");
const { textMatchesLanguage } = requireShared("language");
const { buildTranslationMessages, resolveModelConfig } = requireShared("translate");

const RUNTIME_FLAG = "__discordTranslatorModStarted";
const SEND_BOX_ID = "dtm-send-box";
const SETTINGS_LABEL = "Babel";
const SETTINGS_SECTION_ID_PREFIX = "dtm-settings-section-";
const API_KEY_MASK = "************";
const SETTINGS_SECTION_NAV = Object.freeze([
  { key: "model", label: "模型" },
  { key: "read", label: "消息翻译" },
  { key: "send", label: "发送翻译" },
  { key: "style", label: "译文外观" }
]);
const LANGUAGE_OPTIONS = [
  { value: "简体中文", label: "简体中文" },
  { value: "繁体中文", label: "繁体中文" },
  { value: "英语", label: "英语" },
  { value: "日语", label: "日语" },
  { value: "韩语", label: "韩语" },
  { value: "法语", label: "法语" },
  { value: "德语", label: "德语" },
  { value: "西班牙语", label: "西班牙语" },
  { value: "俄语", label: "俄语" }
];
const TRANSLATION_STYLE_OPTIONS = TRANSLATION_STYLE_PRESETS.map(style => ({ value: style.value, label: style.label }));
const SEND_BOX_OPACITY_OPTIONS = [
  { value: "1", label: "100%" },
  { value: "0.9", label: "90%" },
  { value: "0.8", label: "80%" },
  { value: "0.7", label: "70%" },
  { value: "0.6", label: "60%" },
  { value: "0.5", label: "50%" },
  { value: "0.4", label: "40%" }
];
const TRANSLATION_POSITION_OPTIONS = [
  { value: "below", label: "原文下方" },
  { value: "above", label: "原文上方" }
];
const FONT_OPTIONS = [
  { value: "var(--font-primary)", label: "Discord 默认" },
  { value: "inherit", label: "跟随消息" },
  { value: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif", label: "系统无衬线" },
  { value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", label: "等宽字体" },
  { value: "Georgia, \"Times New Roman\", serif", label: "衬线字体" }
];
const STYLE_EMPHASIS_OPTIONS = [
  { value: "none", label: "无" },
  { value: "bold", label: "加重" },
  { value: "light", label: "浅色" },
  { value: "marker", label: "马克笔" },
  { value: "underline", label: "下划线" },
  { value: "wavy", label: "波浪线" },
  { value: "strike", label: "删除线" }
];
const BACKGROUND_COLOR_OPTIONS = [
  { value: "auto", label: "跟随 Discord 主题" },
  { value: "#303446", label: "夜间蓝灰" },
  { value: "#2b2d31", label: "Discord 深灰" },
  { value: "#35384a", label: "石板蓝" },
  { value: "#26364a", label: "深海蓝" },
  { value: "#233a3f", label: "静谧青" },
  { value: "#263a2f", label: "苔藓绿" },
  { value: "#3f3827", label: "柔和琥珀" },
  { value: "#463238", label: "玫瑰灰" },
  { value: "#3f344f", label: "薰衣草灰" },
  { value: "#41364a", label: "紫藤灰" },
  { value: "#e8edf8", label: "浅雾蓝" },
  { value: "#e6f4f1", label: "浅薄荷" },
  { value: "#f3efe5", label: "浅暖灰" },
  { value: "#f4e8ee", label: "浅玫瑰" },
  { value: "#ece7f7", label: "浅紫雾" },
  { value: "#f2f3f5", label: "Discord 浅灰" }
];
const TEXT_COLOR_OPTIONS = [
  { value: "auto", label: "自动（跟随主题和背景）" },
  { value: "#f2f3f5", label: "强白" },
  { value: "#dbdee1", label: "Discord 正文" },
  { value: "#cbd5e1", label: "冷灰白" },
  { value: "#dbeafe", label: "雾蓝白" },
  { value: "#ccfbf1", label: "薄荷白" },
  { value: "#dcfce7", label: "柔绿白" },
  { value: "#fef3c7", label: "暖米白" },
  { value: "#ffe4e6", label: "玫瑰白" },
  { value: "#ede9fe", label: "淡紫白" },
  { value: "#111827", label: "深墨" },
  { value: "#1f2937", label: "深灰" },
  { value: "#1e3a5f", label: "深蓝" },
  { value: "#164e63", label: "深青" },
  { value: "#14532d", label: "深绿" },
  { value: "#7c2d12", label: "深琥珀" },
  { value: "#7f1d1d", label: "深玫瑰" }
];
const DISCORD_UI = Object.freeze({
  accountCategories: "categories__6131a",
  settingCard: "container__75920",
  stack: "stack_dbd263",
  settingStack: "stack_dbd263 baseSettingWrapper__32428",
});
const DISCORD_STACK_LAYOUTS = Object.freeze({
  rows: {
    align: "stretch",
    justify: "start",
    direction: "vertical",
    wrap: "false",
    fullWidth: "true",
    style: "gap: var(--space-xs); padding: var(--space-0);"
  },
  settingRow: {
    align: "stretch",
    justify: "start",
    direction: "vertical",
    wrap: "false",
    fullWidth: "true",
    style: "gap: var(--space-0); padding-top: var(--space-xs); padding-bottom: var(--space-xs);"
  },
  actionsRow: {
    align: "center",
    justify: "end",
    direction: "horizontal",
    wrap: "false",
    fullWidth: "true",
    style: "gap: var(--space-xs); padding: var(--space-0);"
  }
});

let nativeApi = null;
let settings = normalizeSettings({});
let providerApiKeyStatus = {};
let nativeError = "";
let translationCache = new Map();
let translationCacheGeneration = 0;
let pendingTranslations = new Map();
let messageOperations = new WeakMap();
let persistCacheTimer = 0;
let dismissedTranslations = new Set();
// Message ids the user (or auto-translate) actually translated. The text cache is keyed
// by text for API reuse, but only THESE messages get their translations restored on
// scroll — otherwise a cached translation would "bleed" onto any other message that
// happens to share the same text (e.g. a reply's quoted preview vs the original).
let translatedMessages = new Set();
let currentChannelId = "";
let autoTranslateBaseline = new Map();
let autoHandledMessages = new Set();
let autoTranslateQueue = [];
let autoTranslateActive = 0;
const AUTO_TRANSLATE_CONCURRENCY = 2;
let domHooksInstalled = false;
let maintenanceScheduled = false;
let settingsPageGeneration = 0;
let settingsPageOpen = false;
let settingsSections = new Map();
let nativeControlId = 0;
let mainWorldMessageId = 0;
let originalTestRuntime = null;
const diagnosticLoggedMessages = new Set();
const mainWorldControlCallbacks = new Map();
const handledMainWorldMessageIds = new Set();
let mainWorldControlEventsInstalled = false;
const MAIN_WORLD_BRIDGE_ERROR = "Discord main-world bridge was not captured.";
const MAIN_WORLD_CONTROL_RETRY_MS = 100;
const MAIN_WORLD_CONTROL_MAX_ATTEMPTS = 20;
const MAX_TRANSLATION_CACHE = 500;

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
  sendMainWorldMessage("dtm:settings-config", { title: SETTINGS_LABEL, sections: SETTINGS_SECTION_NAV, icon: BABEL_ICON_PATHS });
  installDomHooks();
  loadSettingsSafe().then(loadPersistedCache).then(runDomMaintenance);
}

async function loadPersistedCache() {
  if (!settings || !settings.readTranslation.cache) return;
  if (!nativeApi || typeof nativeApi.loadCache !== "function") return;
  const generation = translationCacheGeneration;
  try {
    const stored = await nativeApi.loadCache();
    if (generation !== translationCacheGeneration) return;
    if (!stored || typeof stored !== "object") return;
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === "string") translationCache.set(key, value);
    }
    while (translationCache.size > MAX_TRANSLATION_CACHE) {
      const oldest = translationCache.keys().next().value;
      if (oldest === undefined) break;
      translationCache.delete(oldest);
    }
  } catch (_error) {
    // A missing/corrupt cache is non-fatal.
  }
}

function schedulePersistCache() {
  if (!settings || !settings.readTranslation.cache) return;
  if (!nativeApi || typeof nativeApi.saveCache !== "function") return;
  if (persistCacheTimer) return;
  persistCacheTimer = setTimeout(() => {
    persistCacheTimer = 0;
    try {
      nativeApi.saveCache(Object.fromEntries(translationCache));
    } catch (_error) {
      // Persisting the cache is best-effort.
    }
  }, 3000);
  if (persistCacheTimer && typeof persistCacheTimer.unref === "function") persistCacheTimer.unref();
}

function installDomHooks() {
  if (domHooksInstalled) return;
  domHooksInstalled = true;

  document.addEventListener("dblclick", onMessageDoubleClick, true);
  const observer = new MutationObserver(scheduleDomMaintenance);

  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(runDomMaintenance, 1500);
}

function scheduleDomMaintenance() {
  if (maintenanceScheduled) return;
  maintenanceScheduled = true;

  const schedule = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : callback => window.setTimeout(callback, 16);

  schedule(() => {
    maintenanceScheduled = false;
    runDomMaintenance();
  });
}

function runDomMaintenance() {
  syncCurrentChannel();
  ensureSendBox();

  // Both translation passes walk the visible-message list. Skip the DOM query
  // entirely when neither is active, and otherwise query once and share it.
  const cacheActive = Boolean(settings && settings.readTranslation.cache && translationCache.size > 0);
  if (!cacheActive && !autoTranslateEnabled()) return;
  const messages = visibleMessages();
  restoreVisibleTranslations(messages);
  runAutoTranslate(messages);
}

async function loadSettingsSafe() {
  try {
    settings = normalizeSettings(await nativeApi.getSettings());
    providerApiKeyStatus = typeof nativeApi.getApiKeyStatus === "function"
      ? await nativeApi.getApiKeyStatus()
      : {};
    nativeError = "";
  } catch (error) {
    settings = normalizeSettings(settings);
    providerApiKeyStatus = {};
    nativeError = publicError(error);
  }
}

function injectBaseStyles() {
  const existing = document.getElementById("dtm-style");
  if (existing) existing.remove();
  const style = document.createElement("style");
  style.id = "dtm-style";
  style.textContent = `
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
    .dtm-swatch-field {
      display: grid;
      gap: 10px;
    }
    .dtm-field-label {
      color: var(--text-normal);
      font-weight: 600;
    }
    .dtm-swatch-grid {
      display: grid;
      grid-template-columns: repeat(9, 28px);
      gap: 8px;
    }
    .dtm-swatch {
      width: 28px;
      height: 28px;
      padding: 0;
      border: 2px solid var(--border-subtle, rgba(128, 132, 142, .4));
      border-radius: 7px;
      background: var(--dtm-swatch-color);
      cursor: pointer;
    }
    .dtm-swatch[aria-pressed="true"] {
      border-color: var(--brand-500, #5865f2);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-500, #5865f2) 28%, transparent);
    }
    .dtm-about {
      margin-top: 28px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle, rgba(128, 132, 142, .2));
      color: var(--text-muted, #949ba4);
      font-size: 12px;
      line-height: 1.6;
    }
    .dtm-about-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-default, var(--header-primary, #dbdee1));
    }
    .dtm-about-desc { margin-top: 6px; }
    .dtm-about-why { margin-top: 4px; }
    .dtm-about-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .dtm-about-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--text-link, #00a8fc);
      cursor: pointer;
      text-decoration: none;
    }
    .dtm-about-link:hover { text-decoration: underline; }
    .dtm-about-update {
      margin-top: 10px;
      font-size: 13px;
      font-weight: 600;
    }
    .dtm-about-update-status {
      color: var(--text-muted, #949ba4);
      font-weight: 400;
    }
  `;
  document.documentElement.appendChild(style);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function settingsSectionId(sectionKey) {
  return `${SETTINGS_SECTION_ID_PREFIX}${sectionKey}`;
}

async function openSettingsPanel() {
  if (settingsPageOpen) {
    mountSettingsSections();
    return;
  }
  settingsPageOpen = true;
  const generation = ++settingsPageGeneration;
  await loadSettingsSafe();
  if (generation !== settingsPageGeneration) return;

  const body = div(DISCORD_UI.accountCategories);
  const formState = JSON.parse(JSON.stringify(settings));
  const preview = translationStylePreview(formState.style);
  const updateStylePreview = () => refreshStylePreview(preview, formState.style);
  const fetchedModelOptions = new Map();
  const providerSelectHost = div();
  const baseUrlFieldHost = div();
  const modelFieldHost = div();
  const apiKeyFieldHost = div();
  const customPromptHost = div();
  let modelComboBoxHost = null;

  const save = button("保存", "primary");
  const openConfig = button("打开配置文件夹", "secondary");
  const clearCache = button("清除翻译缓存", "secondary");
  const refreshModels = button("刷新模型", "secondary");
  const testConnection = button("测试连接", "secondary");
  let refreshModelsInFlight = false;
  let testConnectionInFlight = false;
  if (nativeError) showNativeToast(nativeError, "failure");

  function currentSettingsRequest() {
    const { __apiKey, ...preferences } = formState;
    const request = { settings: normalizeSettings(preferences) };
    const apiKey = apiKeyValueForRequest(formState.__apiKey);
    if (apiKey) request.apiKey = apiKey;
    return request;
  }

  testConnection.addEventListener("click", async () => {
    if (testConnectionInFlight) return;
    testConnectionInFlight = true;
    testConnection.setLoading(true);
    try {
      const result = await nativeApi.testConnection(currentSettingsRequest());
      showNativeToast(`连接成功：${result.text}`, "success");
    } catch (error) {
      showNativeToast(publicError(error), "failure");
    } finally {
      testConnection.setLoading(false);
      testConnectionInFlight = false;
    }
  });

  refreshModels.addEventListener("click", () => refreshModelList());

  function renderProviderSelect() {
    clearChildren(providerSelectHost);
    providerSelectHost.appendChild(selectField("AI 平台", formState.model.provider, providerOptionsWithStatus(providerApiKeyStatus), value => {
      const provider = providerById(value);
      formState.model.provider = provider.value;
      formState.model.baseUrl = provider.baseUrl;
      formState.model.modelId = provider.defaultModel;
      delete formState.__apiKey;
      renderProviderFields();
      renderApiKeyField();
    }));
  }

  function renderProviderFields() {
    clearChildren(baseUrlFieldHost);
    const provider = providerById(formState.model.provider);

    baseUrlFieldHost.appendChild(inputField("模型地址", "text", formState.model.baseUrl, value => {
      if (provider.value === "custom") formState.model.baseUrl = value;
    }, { disabled: provider.value !== "custom" }));

    renderModelField();
  }

  function renderModelField() {
    const provider = providerById(formState.model.provider);
    const allOptions = fetchedModelOptions.get(modelCacheKey(provider)) || provider.models || [];
    const modelOptions = optionsWithCurrentValue(allOptions, formState.model.modelId);
    if (modelComboBoxHost && modelComboBoxHost.parentElement === modelFieldHost) {
      modelComboBoxHost.updateOptions(formState.model.modelId, modelOptions);
      return;
    }

    clearChildren(modelFieldHost);
    modelComboBoxHost = modelComboBoxHostFor("匹配模型", formState.model.modelId, modelOptions, value => {
      formState.model.modelId = value;
    });
    modelFieldHost.appendChild(modelComboBoxHost);
  }

  function renderApiKeyField() {
    clearChildren(apiKeyFieldHost);
    formState.__apiKey = "";
    apiKeyFieldHost.appendChild(passwordField("API Key", "", value => { formState.__apiKey = value; }, apiKeyPlaceholder(formState.model.provider)));
  }

  function modelCacheKey(provider) {
    return provider.value === "custom"
      ? `${provider.value}:${String(formState.model.baseUrl || "").trim()}`
      : provider.value;
  }

  async function refreshModelList() {
    if (refreshModelsInFlight) return;
    refreshModelsInFlight = true;
    refreshModels.setLoading(true);
    const request = currentSettingsRequest();
    const requestKey = modelCacheKey(providerById(formState.model.provider));
    try {
      const result = await nativeApi.listModels(request);
      if (generation !== settingsPageGeneration) return;
      const models = Array.isArray(result && result.models) ? result.models : [];
      if (models.length === 0) throw new Error("没有可用模型。");
      fetchedModelOptions.set(requestKey, models);
      if (requestKey !== modelCacheKey(providerById(formState.model.provider))) return;
      if (formState.model.modelId === request.settings.model.modelId && !models.some(model => model.value === formState.model.modelId)) {
        formState.model.modelId = models[0].value;
      }
      renderModelField();
      showNativeToast(`已刷新 ${models.length} 个模型`, "success");
    } catch (error) {
      showNativeToast(publicError(error), "failure");
    } finally {
      refreshModels.setLoading(false);
      refreshModelsInFlight = false;
    }
  }
  renderProviderSelect();
  renderProviderFields();
  renderApiKeyField();

  const customPromptField = inputField("自定义提示词", "textarea", formState.customPrompt, value => {
    formState.customPrompt = value;
  }, { placeholder: "例如：使用简短自然的游戏聊天语气，保留专有名词。" });
  customPromptHost.appendChild(customPromptField);
  const syncCustomPromptVisibility = () => {
    const display = formState.translationStyle === "custom" ? "" : "none";
    customPromptHost.style.display = display;
    const row = customPromptHost.closest("[data-dtm-native-setting-row='true']");
    if (row) row.style.display = display;
  };
  syncCustomPromptVisibility();

  body.append(
    section("模型", [
      providerSelectHost,
      baseUrlFieldHost,
      modelFieldHost,
      apiKeyFieldHost,
      buttonRow([refreshModels, testConnection])
    ], "model"),
    section("消息翻译", [
      toggleRow("启用插件", formState.enabled, value => { formState.enabled = value; }),
      toggleRow("自动翻译新消息", formState.autoTranslate.enabled, value => { formState.autoTranslate.enabled = value; }),
      languageSelectField("阅读目标语言", formState.model.targetLanguage, value => { formState.model.targetLanguage = value; }),
      selectField("翻译风格", formState.translationStyle, TRANSLATION_STYLE_OPTIONS, value => {
        formState.translationStyle = value;
        syncCustomPromptVisibility();
      }),
      customPromptHost
    ], "read"),
    section("发送翻译", [
      toggleRow("启用发送翻译输入框", formState.sendTranslation.enabled, value => { formState.sendTranslation.enabled = value; }),
      languageSelectField("发送目标语言", formState.model.sendLanguage, value => { formState.model.sendLanguage = value; }),
      toggleRow("回车后自动发送", formState.sendTranslation.enterToSend, value => { formState.sendTranslation.enterToSend = value; }),
      selectField("输入框透明度", String(formState.sendBox.opacity), SEND_BOX_OPACITY_OPTIONS, value => {
        formState.sendBox.opacity = Number(value);
      })
    ], "send")
  );

  body.append(section("译文外观", [
    preview,
    selectField("译文位置", formState.style.position, TRANSLATION_POSITION_OPTIONS, value => {
      formState.style.position = value;
    }),
    toggleRow("显示译文背景", formState.style.background, value => {
      formState.style.background = value;
      updateStylePreview();
    }),
    selectField("译文样式", formState.style.emphasis, STYLE_EMPHASIS_OPTIONS, value => {
      formState.style.emphasis = value;
      updateStylePreview();
    }),
    colorSwatchField("背景色", formState.style.backgroundColor, BACKGROUND_COLOR_OPTIONS, value => {
      formState.style.backgroundColor = value;
      updateStylePreview();
    }),
    colorSwatchField("译文颜色", formState.style.textColor, TEXT_COLOR_OPTIONS, value => {
      formState.style.textColor = value;
      updateStylePreview();
    }),
    selectField("字体", formState.style.fontFamily, optionsWithCurrentValue(FONT_OPTIONS, formState.style.fontFamily), value => {
      formState.style.fontFamily = value;
      updateStylePreview();
    })
  ], "style"));
  syncCustomPromptVisibility();

  openConfig.addEventListener("click", async () => {
    try {
      await nativeApi.openSettingsFile();
    } catch (error) {
      console.error("[Babel] Failed to open settings directory:", error);
    }
  });

  clearCache.addEventListener("click", async () => {
    if (clearCache.disabled) return;
    clearCache.disabled = true;
    try {
      await clearTranslationCache();
      clearCache.flashLabel("已清除");
    } catch (error) {
      showNativeToast(publicError(error), "failure");
    } finally {
      clearCache.disabled = false;
    }
  });

  save.addEventListener("click", async () => {
    if (save.disabled) return;
    // Saving is instant local I/O: no spinner, no progress/success toast. Only a
    // double-submit guard, and a toast if it actually fails.
    save.disabled = true;
    const request = currentSettingsRequest();
    const stagedKey = formState.__apiKey;
    try {
      if (request.apiKey) await nativeApi.setApiKey({ provider: request.settings.model.provider, apiKey: request.apiKey });
      settings = await nativeApi.saveSettings(request.settings);
      ensureSendBox();
      applyAutoTranslateSettings();
      refreshTranslationStyles();
      providerApiKeyStatus = typeof nativeApi.getApiKeyStatus === "function"
        ? await nativeApi.getApiKeyStatus()
        : providerApiKeyStatus;
      if (generation !== settingsPageGeneration) return;
      renderProviderSelect();
      if (formState.model.provider === request.settings.model.provider && formState.__apiKey === stagedKey) renderApiKeyField();
      save.flashLabel("已保存");
    } catch (error) {
      showNativeToast(publicError(error), "failure");
    } finally {
      save.disabled = false;
    }
  });

  const saveRow = settingRow(buttonRow([openConfig, clearCache, save]));
  saveRow.id = settingsSectionId("save");
  body.lastElementChild.append(saveRow, aboutFooter());
  settingsSections = new Map(SETTINGS_SECTION_NAV.map(({ key }) => [key, body.querySelector(`#${settingsSectionId(key)}`)]));
  mountSettingsSections();
}

function mountSettingsSections() {
  for (const [key, content] of settingsSections) {
    const slot = document.getElementById(`dtm-settings-slot-${key}`);
    if (!slot || !content || content.parentElement === slot) continue;
    slot.appendChild(content);
    for (const host of content.querySelectorAll("[data-dtm-control-id]")) {
      requestMainWorldControl(host, host.__dtmControlSpec);
    }
  }
}

function closeSettingsPanel() {
  settingsPageOpen = false;
  settingsPageGeneration += 1;
  for (const content of settingsSections.values()) disposeControls(content);
  settingsSections.clear();
  mainWorldControlCallbacks.clear();
}

const AUTHOR_X_URL = "https://x.com/unflwMaige";

const BABEL_ICON_PATHS = '<path d="M10 4h4l1 2.6H9z"/>'
  + '<path d="M9 8.2h6l1.2 2.8H7.8z"/>'
  + '<path d="M7.6 12.4h8.8l1.3 3H6.3z"/>'
  + '<path d="M6 17h12l1.4 3.4H4.6z"/>'
  + '<path d="M11 20.4v-1.6a1 1 0 0 1 2 0v1.6"/>';

function aboutFooter() {
  const wrap = div("dtm-about");

  const title = div("dtm-about-title");
  title.textContent = "Babel · 巴别";

  const desc = div("dtm-about-desc");
  desc.textContent = "在 Discord 里双击消息即时翻译，也能把你输入的内容翻译后再发送。";

  const why = div("dtm-about-why");
  why.textContent = "取名 Babel，源自通天的「巴别塔」——传说人类因语言不通而未能建成它；这个插件想做的，正是抹平 Discord 里的语言之墙。";

  const meta = div("dtm-about-meta");
  meta.appendChild(document.createTextNode(`v${BABEL_VERSION} · 作者 麦格 · `));
  const link = document.createElement("a");
  link.className = "dtm-about-link";
  link.href = AUTHOR_X_URL;
  link.setAttribute("role", "link");
  link.textContent = "在 X 上关注我";
  link.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (nativeApi && typeof nativeApi.openExternal === "function") nativeApi.openExternal(AUTHOR_X_URL);
  });
  meta.appendChild(link);

  wrap.append(title, desc, why, meta);

  // Manual update check: click to query GitHub and show the result inline. This avoids a
  // startup network call and the async-timing problem of an auto-check (the footer would
  // render before the check resolved and then never update).
  const updateRow = div("dtm-about-update");
  const checkLink = document.createElement("a");
  checkLink.className = "dtm-about-link";
  checkLink.setAttribute("role", "button");
  checkLink.textContent = "检查更新";
  const result = document.createElement("span");
  result.className = "dtm-about-update-status";

  let checking = false;
  checkLink.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    if (checking) return;
    checking = true;
    result.textContent = " · 检查中…";
    try {
      const info = nativeApi && typeof nativeApi.checkUpdate === "function" ? await nativeApi.checkUpdate() : null;
      if (info && info.ok && info.updateAvailable) {
        result.textContent = ` · 发现新版本 v${info.latest} · `;
        const download = document.createElement("a");
        download.className = "dtm-about-link";
        download.setAttribute("role", "link");
        download.textContent = "点击下载";
        download.addEventListener("click", downloadEvent => {
          downloadEvent.preventDefault();
          downloadEvent.stopPropagation();
          if (nativeApi && typeof nativeApi.openExternal === "function") nativeApi.openExternal(info.url);
        });
        result.appendChild(download);
      } else if (info && info.ok) {
        result.textContent = ` · 已是最新版本（v${BABEL_VERSION}）`;
      } else {
        result.textContent = " · 检查失败，请稍后重试";
      }
    } catch (_error) {
      result.textContent = " · 检查失败，请稍后重试";
    } finally {
      checking = false;
    }
  });
  updateRow.append(checkLink, result);
  wrap.append(updateRow);

  return wrap;
}

function onMessageDoubleClick(event) {
  if (!settings || !settings.enabled) return;
  if (event.target.closest(`[data-dtm-section-key], #${SEND_BOX_ID}, .dtm-translation-block`)) return;

  const message = findMessage(event.target);
  if (!message) return;

  if (findAnyTranslationBlock(message)) {
    event.preventDefault();
    event.stopPropagation();
    clearTextSelection();
    messageOperations.delete(message);
    removeAllTranslations(message);
    // Remember the dismissal so periodic restore from cache doesn't bring it back.
    dismissedTranslations.add(getMessageId(message));
    translatedMessages.delete(getMessageId(message));
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
  const selection = typeof window !== "undefined" && typeof window.getSelection === "function"
    ? window.getSelection()
    : null;
  if (selection && typeof selection.removeAllRanges === "function") selection.removeAllRanges();
}

async function translateMessage(message, automatic = false) {
  const operation = Symbol();
  messageOperations.set(message, operation);
  for (const unit of getMessageUnits(message)) {
    if (messageOperations.get(message) !== operation) return;
    if (automatic && shouldSkipSameLanguage(unit.text)) continue;
    await translateUnit(message, unit, operation);
  }
}

async function translateUnit(message, unit, operation) {
  const key = getUnitCacheKey(unit);
  if (settings.readTranslation.cache && translationCache.has(key)) {
    translatedMessages.add(getMessageId(message));
    renderUnitTranslation(message, unit, translationCache.get(key), { cacheHit: true });
    return;
  }

  const placeholder = renderUnitTranslation(message, unit, "正在翻译...");
  try {
    let pending = pendingTranslations.get(key);
    if (!pending) {
      const generation = translationCacheGeneration;
      pending = Promise.resolve(nativeApi.translate({ direction: "read", text: unit.text }))
        .then(result => {
          if (generation === translationCacheGeneration) cacheTranslation(key, result.text);
          return result;
        })
        .finally(() => {
          if (pendingTranslations.get(key) === pending) pendingTranslations.delete(key);
        });
      pendingTranslations.set(key, pending);
    }
    const result = await pending;
    // If the user dismissed the in-progress block while we waited, don't resurrect it.
    if (messageOperations.get(message) !== operation || (placeholder && !placeholder.parentElement)) return;
    translatedMessages.add(getMessageId(message));
    renderUnitTranslation(message, unit, result.text);
  } catch (error) {
    if (messageOperations.get(message) !== operation || (placeholder && !placeholder.parentElement)) return;
    renderUnitTranslation(message, unit, publicError(error), { isError: true });
  }
}

function cacheTranslation(key, text) {
  translationCache.delete(key);
  translationCache.set(key, text);
  while (translationCache.size > MAX_TRANSLATION_CACHE) {
    const oldest = translationCache.keys().next().value;
    if (oldest === undefined) break;
    translationCache.delete(oldest);
  }
  schedulePersistCache();
}

// Empty the translation cache in memory and on disk. Already-displayed translations
// stay (they're rendered); only the stored entries are cleared, so future re-views
// will re-translate.
async function clearTranslationCache() {
  translationCacheGeneration += 1;
  pendingTranslations.clear();
  translationCache.clear();
  if (persistCacheTimer) {
    clearTimeout(persistCacheTimer);
    persistCacheTimer = 0;
  }
  if (nativeApi && typeof nativeApi.saveCache === "function") {
    await nativeApi.saveCache({});
  }
}

// ---- Auto-translate ------------------------------------------------------------
// Use the enabling/channel-entry time, never the newest currently visible message:
// scrolling through history must not turn a newer page of history into new arrivals.

function visibleMessages() {
  return Array.from(document.querySelectorAll("[id^='chat-messages-'], [data-list-item-id*='chat-messages']"));
}

function getCurrentChannelId() {
  const match = String((typeof location !== "undefined" && location.pathname) || "").match(/\/channels\/[^/]+\/(\d+)/);
  return match ? match[1] : "";
}

function syncCurrentChannel() {
  const id = getCurrentChannelId();
  if (id === currentChannelId) return;
  currentChannelId = id;
  if (id && autoTranslateEnabled()) autoTranslateBaseline.set(id, Date.now());
  // Drop queued auto-translate work for the channel we just left — no sense spending
  // API calls translating messages that are no longer on screen. In-flight requests
  // finish on their own; only the not-yet-started queue is cleared.
  autoTranslateQueue = [];
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
  return Boolean(settings && settings.enabled && settings.autoTranslate && settings.autoTranslate.enabled);
}

// Called after settings save: when auto-translate is turned off, forget the baselines
// so re-enabling later starts fresh from "now" instead of replaying a backlog.
function applyAutoTranslateSettings() {
  if (autoTranslateEnabled()) {
    if (currentChannelId && !autoTranslateBaseline.has(currentChannelId)) {
      autoTranslateBaseline.set(currentChannelId, Date.now());
    }
    return;
  }
  autoTranslateBaseline.clear();
  autoHandledMessages.clear();
  autoTranslateQueue = [];
}

function shouldSkipSameLanguage(text) {
  if (!settings.autoTranslate || settings.autoTranslate.skipSameLanguage === false) return false;
  return textMatchesLanguage(text, settings.model.targetLanguage);
}

function runAutoTranslate(messages = visibleMessages()) {
  applyAutoTranslateSettings();
  if (!autoTranslateEnabled()) return;
  const channelId = currentChannelId;
  if (!channelId) return;

  const threshold = autoTranslateBaseline.get(channelId);
  for (const message of messages) {
    const id = getMessageId(message);
    if (!id || autoHandledMessages.has(id)) continue;
    // Belongs to this channel and is newer than the baseline.
    if (id.indexOf(channelId) === -1) continue;
    const snowflake = messageSnowflake(message);
    if (!snowflake || snowflakeTimestamp(snowflake) <= threshold) continue;
    if (dismissedTranslations.has(id)) continue;
    if (findAnyTranslationBlock(message)) {
      autoHandledMessages.add(id);
      continue;
    }
    if (getMessageUnits(message).length === 0) continue;
    autoHandledMessages.add(id);
    enqueueAutoTranslate(message);
  }

  if (autoHandledMessages.size > 4000) autoHandledMessages.clear();
}

// Auto-translate runs new messages through a small concurrency-limited queue, so a
// burst of messages can't fire a burst of parallel API calls (rate-limit / cost
// protection). Manual double-click stays immediate; this only gates the automatic path.
function enqueueAutoTranslate(message) {
  autoTranslateQueue.push(message);
  pumpAutoTranslateQueue();
}

function pumpAutoTranslateQueue() {
  while (autoTranslateActive < AUTO_TRANSLATE_CONCURRENCY && autoTranslateQueue.length > 0) {
    const message = autoTranslateQueue.shift();
    autoTranslateActive += 1;
    Promise.resolve(autoTranslateMessage(message))
      .catch(() => {})
      .then(() => {
        autoTranslateActive -= 1;
        pumpAutoTranslateQueue();
      });
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
    if (id.includes("chat-messages") || listId.includes("chat-messages")) return node;
  }

  return target.closest("[id^='chat-messages-'], [data-list-item-id*='chat-messages'], [class*='messageListItem']");
}

function messageContentEl(message, quote) {
  // The actual message body. Query separately (not one comma selector) so a reply's
  // quoted preview — which also has a [class*='markup'] earlier in the DOM — never
  // wins, and explicitly skip anything inside the quote preview.
  const insideQuote = el => Boolean(quote && el && typeof quote.contains === "function" && quote.contains(el));
  const byId = message.querySelector("[id^='message-content-']");
  if (byId && !insideQuote(byId)) return byId;
  for (const el of Array.from(message.querySelectorAll("[class*='messageContent'], [class*='markup']"))) {
    if (!insideQuote(el)) return el;
  }
  return null;
}

function replyQuoteEl(message) {
  // The "replying to …" preview row (smaller text). Discord hashes class suffixes,
  // so match on the stable id prefix / class substrings; best-effort + fail-safe.
  return message.querySelector("[id^='message-reply-context-']")
    || message.querySelector("[class*='repliedMessage']");
}

function unitText(el) {
  return el ? String(el.textContent || "").trim() : "";
}

// A message is 1–2 translatable units: an optional quoted preview, plus the body.
function getMessageUnits(message) {
  const units = [];
  const quote = replyQuoteEl(message);
  if (quote) {
    const quoteText = unitText(quote.querySelector("[class*='repliedTextContent'], [class*='repliedText']") || quote);
    // The quote译文 is anchored right under the (block-level) preview row.
    if (quoteText) units.push({ kind: "quote", anchor: quote, text: quoteText });
  }
  const content = messageContentEl(message, quote);
  const bodyText = unitText(content) || (quote ? "" : unitText(message));
  // The body译文 always appends to the bottom of the message — a safe, block-level
  // spot — never anchored to the (possibly inline) content element.
  if (bodyText) units.push({ kind: "content", anchor: null, source: content, text: bodyText });
  return units;
}

function getMessageId(message) {
  return message.getAttribute("id") || message.getAttribute("data-list-item-id") || "";
}

// Share results across messages only when the effective model and actual prompts match.
function getUnitCacheKey(unit) {
  return createHash("sha256").update(JSON.stringify({
    model: resolveModelConfig(settings.model),
    messages: buildTranslationMessages({ text: unit.text, direction: "read", settings })
  })).digest("hex");
}

function findUnitBlock(message, kind) {
  for (const block of Array.from(message.querySelectorAll(".dtm-translation-block"))) {
    if (block.dataset && block.dataset.dtmUnit === kind) return block;
  }
  return null;
}

function findAnyTranslationBlock(message) {
  return message ? message.querySelector(".dtm-translation-block") : null;
}

function removeAllTranslations(message) {
  for (const block of Array.from(message.querySelectorAll(".dtm-translation-block"))) block.remove();
}

function renderUnitTranslation(message, unit, text, options = {}) {
  const isError = Boolean(options.isError);
  let block = findUnitBlock(message, unit.kind);
  if (!block) {
    block = document.createElement("div");
    block.className = "dtm-translation-block";
    block.dataset.dtmUnit = unit.kind;
  }
  placeTranslationBlock(message, unit, block);
  block.dataset.dtmError = isError ? "true" : "false";
  block.dataset.dtmCacheHit = options.cacheHit ? "true" : "false";
  block.textContent = text;
  applyTranslationStyle(block, unit.kind === "quote");
  return block;
}

function placeTranslationBlock(message, unit, block) {
  const above = settings.style.position === "above";
  if (unit.anchor && typeof unit.anchor.insertAdjacentElement === "function" && unit.anchor.parentElement) {
    unit.anchor.insertAdjacentElement(above ? "beforebegin" : "afterend", block);
    return;
  }
  if (above && unit.source && typeof unit.source.insertAdjacentElement === "function" && unit.source.parentElement) {
    unit.source.insertAdjacentElement("beforebegin", block);
    return;
  }
  if (block.parentElement) block.remove();
  message.appendChild(block);
}

function restoreVisibleTranslations(messages = visibleMessages()) {
  if (!settings || !settings.readTranslation.cache || translationCache.size === 0) return;
  for (const message of messages) {
    const id = getMessageId(message);
    // Restore only messages the user actually translated — never bleed a cached
    // translation onto a different message that merely shares the same text.
    if (!translatedMessages.has(id) || dismissedTranslations.has(id)) continue;
    for (const unit of getMessageUnits(message)) {
      if (findUnitBlock(message, unit.kind)) continue;
      const key = getUnitCacheKey(unit);
      if (translationCache.has(key)) renderUnitTranslation(message, unit, translationCache.get(key), { cacheHit: true });
    }
  }
}

function refreshTranslationStyles() {
  for (const block of document.querySelectorAll(".dtm-translation-block")) {
    const message = findMessage(block);
    const unit = message && getMessageUnits(message).find(candidate => candidate.kind === block.dataset.dtmUnit);
    if (message && unit) placeTranslationBlock(message, unit, block);
    applyTranslationStyle(block, block.dataset.dtmUnit === "quote");
  }
}

function applyTranslationStyle(block, small) {
  applyTranslationStyleObject(block, settings.style, block.dataset.dtmError === "true", small);
  const above = settings.style.position === "above";
  block.style.marginTop = above ? "0" : (settings.style.background === false ? "2px" : "6px");
  block.style.marginBottom = above ? (settings.style.background === false ? "2px" : "6px") : "0";
}

function applyTranslationStyleObject(block, style, isError, small) {
  Object.assign(block.style, translationPreviewStyle(style, isError));
  if (small) {
    // The quoted message is shown small in Discord, so its译文 matches.
    const fontSize = Number(style.fontSize) || 14;
    block.style.fontSize = `${Math.max(11, Math.round(fontSize * 0.78))}px`;
  }
}

const STYLE_MARKER_BAND = "linear-gradient(transparent 54%, color-mix(in srgb, currentColor 24%, transparent) 54%, color-mix(in srgb, currentColor 24%, transparent) 92%, transparent 92%)";

function translationPreviewStyle(style, isError) {
  const emphasis = style.emphasis || "none";
  const backgroundOn = style.background !== false;
  const backgroundColor = style.backgroundColor === "auto"
    ? "var(--background-surface-high, var(--background-secondary))" : style.backgroundColor;
  return {
    backgroundColor: backgroundOn ? backgroundColor : "transparent",
    backgroundImage: emphasis === "marker" ? STYLE_MARKER_BAND : "none",
    color: isError ? "var(--text-feedback-critical, var(--text-danger))"
      : style.textColor === "auto" ? automaticTextColor(style) : style.textColor,
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
    textDecorationStyle: emphasis === "wavy" ? "wavy" : "solid"
  };
}

function automaticTextColor(style) {
  const color = style.background !== false && /^#[0-9a-f]{6}$/i.test(style.backgroundColor || "")
    ? style.backgroundColor.slice(1) : "";
  if (!color) return "var(--text-default, var(--text-normal))";
  const [r, g, b] = color.match(/../g).map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? "#111827" : "#f2f3f5";
}

function emphasisDecorationLine(emphasis) {
  if (emphasis === "strike") return "line-through";
  if (emphasis === "underline" || emphasis === "wavy") return "underline";
  return "none";
}

function ensureSendBox() {
  const existing = document.getElementById(SEND_BOX_ID);

  if (!settings || !settings.enabled || !settings.sendTranslation.enabled) {
    if (existing) existing.remove();
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
    if (status.textContent !== hint) status.textContent = hint;
    status.dataset.dtmHint = hint;
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
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    const match = bg && bg.match(/rgba?\(([^)]+)\)/);
    if (!match) continue;
    const parts = match[1].split(",").map(part => part.trim());
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
  grip.setAttribute("aria-label", "拖动翻译输入框（双击复位）");

  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("aria-label", "翻译发送输入框");

  const status = document.createElement("span");
  status.textContent = enterHint();
  status.dataset.dtmHint = status.textContent;
  let statusTimer = 0;

  input.addEventListener("keydown", async event => {
    if (event.key !== "Enter") return;
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229 || input.readOnly ||
        event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;
    const channelId = getCurrentChannelId();
    const editor = findDiscordEditor();
    const send = settings.sendTranslation.enterToSend;
    if (!editor) return;
    const current = () => box.isConnected && editor.isConnected &&
      channelId === getCurrentChannelId() && editor === findDiscordEditor();

    input.readOnly = true;
    clearTimeout(statusTimer);
    delete status.dataset.error;
    status.textContent = "正在翻译...";
    let id;

    try {
      id = await nativeApi.beginSend(send);
      if (!current()) throw new Error("频道或输入框已切换，原文已保留，请重新翻译。");
      const result = await nativeApi.translate({ direction: "send", text });
      if (!current()) throw new Error("频道或输入框已切换，原文已保留，请重新翻译。");
      const outcome = await nativeApi.insertAndSend({ id, text: result.text });
      if (!outcome || !outcome.ok) throw new Error(outcome?.error || "未能填入 Discord 输入框，原文已保留。");
      input.value = "";
      status.textContent = outcome.sent === false ? "已填入输入框" : "已提交发送";
      statusTimer = setTimeout(() => { status.textContent = enterHint(); status.dataset.dtmHint = status.textContent; }, 1200);
      if (statusTimer && typeof statusTimer.unref === "function") statusTimer.unref();
    } catch (error) {
      status.dataset.error = "true";
      status.textContent = publicError(error);
    } finally {
      if (id != null) await nativeApi.cancelSend(id).catch(error => diagnosticLog(publicError(error)));
      input.readOnly = false;
      if (current() && send) input.focus();
    }
  });

  const resize = document.createElement("div");
  resize.className = "dtm-send-resize";
  resize.setAttribute("aria-label", "调整翻译输入框宽度（双击复位）");

  installSendBoxDrag(box, grip);
  installSendBoxResize(box, resize);
  box.append(grip, input, status, resize);
  return box;
}

function hasCustomSendBoxPos() {
  return Boolean(settings.sendBox && Number.isFinite(settings.sendBox.x) && Number.isFinite(settings.sendBox.y));
}

function hasCustomSendBoxWidth() {
  return Boolean(settings.sendBox && Number.isFinite(settings.sendBox.width) && settings.sendBox.width > 0);
}

function positionSendBox(box, mount) {
  if (box.dataset.dtmDragging === "true" || box.dataset.dtmResizing === "true") return;
  const rect = typeof mount.getBoundingClientRect === "function" ? mount.getBoundingClientRect() : null;

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
    applyBoxPosition(box, Math.round(rectLeft), Math.round(rectTop - (box.offsetHeight || 0) - 8));
  }
}

function applyBoxPosition(box, x, y) {
  let nx = Number.isFinite(x) ? x : 0;
  let ny = Number.isFinite(y) ? y : 0;
  if (typeof window !== "undefined" && window.innerWidth) {
    nx = Math.min(Math.max(0, nx), Math.max(0, window.innerWidth - (box.offsetWidth || 0)));
    ny = Math.min(Math.max(0, ny), Math.max(0, window.innerHeight - (box.offsetHeight || 0)));
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

  const onMove = event => {
    applyBoxPosition(box, originLeft + (event.clientX - startX), originTop + (event.clientY - startY));
  };
  const onUp = () => {
    box.dataset.dtmDragging = "false";
    if (typeof document !== "undefined") {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
    }
    persistSendBoxPosition(box);
  };

  grip.addEventListener("pointerdown", event => {
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
  });

  grip.addEventListener("dblclick", event => {
    event.preventDefault();
    event.stopPropagation();
    resetSendBoxPosition(box);
  });
}

function installSendBoxResize(box, handle) {
  let startX = 0;
  let startWidth = 0;

  const onMove = event => {
    box.style.width = `${clampBoxWidth(startWidth + (event.clientX - startX))}px`;
  };
  const onUp = () => {
    box.dataset.dtmResizing = "false";
    if (typeof document !== "undefined") {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
    }
    persistSendBoxWidth(box);
  };

  handle.addEventListener("pointerdown", event => {
    event.preventDefault();
    event.stopPropagation();
    startX = event.clientX;
    startWidth = box.getBoundingClientRect().width;
    box.dataset.dtmResizing = "true";
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
  });

  handle.addEventListener("dblclick", event => {
    event.preventDefault();
    event.stopPropagation();
    resetSendBoxWidth(box);
  });
}

function clampBoxWidth(width) {
  const max = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 4000;
  return Math.min(Math.max(220, Math.round(width)), max);
}

async function saveSendBox(patch, box, mount) {
  settings.sendBox = { ...settings.sendBox, ...patch };
  try {
    settings = normalizeSettings(await nativeApi.saveSettings(settings));
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
  return settings.sendTranslation.enterToSend ? "回车发送" : "回车填入输入框";
}

function findDiscordComposerMount(editor) {
  return editor.closest("[class*='channelTextArea']") ||
    editor.closest("[class*='scrollableContainer']") ||
    editor.closest("form") ||
    editor.parentElement;
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
  let flashTimer = 0;

  function renderButton() {
    mountDiscordReactControl(host, {
      kind: "button",
      label: currentLabel,
      variant: variant === "secondary" ? "secondary" : "primary",
      disabled: host.disabled,
      loading: host.dataset.dtmButtonLoading === "true"
    });
  }

  host.flashLabel = (temporaryLabel, durationMs = 1500) => {
    currentLabel = temporaryLabel;
    // Fade the button a touch while it shows the confirmation, then restore it.
    host.style.transition = "opacity .15s ease";
    host.style.opacity = "0.6";
    renderButton();
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      currentLabel = label;
      flashTimer = 0;
      host.style.opacity = "";
      renderButton();
    }, durationMs);
    if (flashTimer && typeof flashTimer.unref === "function") flashTimer.unref();
  };

  Object.defineProperty(host, "disabled", {
    configurable: true,
    get() {
      return host.dataset.dtmButtonDisabled === "true";
    },
    set(value) {
      host.dataset.dtmButtonDisabled = value ? "true" : "false";
      renderButton();
    }
  });

  host.setLoading = value => {
    host.dataset.dtmButtonLoading = value ? "true" : "false";
    renderButton();
  };

  renderButton();
  return host;
}

function disposeControls(node) {
  const ids = Array.from(node.querySelectorAll("[data-dtm-control-id]")).map(host => {
    host.dataset.dtmNativeReactMounted = "disposed";
    mainWorldControlCallbacks.delete(host.dataset.dtmControlId);
    return host.dataset.dtmControlId;
  });
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
  if (typeof console !== "undefined" && typeof console.warn === "function") console.warn(text);
}

function showNativeToast(message, tone = "message") {
  // Always route feedback through Discord's own toast system so it inherits the
  // active light/dark theme instead of a hand-rolled panel toast with fixed colors.
  return requestMainWorldToast({ message: String(message || ""), tone });
}

function sendMainWorldMessage(type, detail) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function" || typeof window.CustomEvent !== "function") {
    return false;
  }

  mainWorldMessageId += 1;
  const payload = { ...detail, __dtmMessageId: `dtm-renderer-${mainWorldMessageId}` };
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
  host.__dtmControlSpec = spec;
  host.dataset.dtmControlId = id;
  host.dataset.dtmNativeReactMounted = "pending";
  host.dataset.dtmControlMountVersion = String(Number(host.dataset.dtmControlMountVersion || 0) + 1);
  mainWorldControlCallbacks.set(id, typeof spec.onChange === "function" ? spec.onChange : () => {});

  const detail = { ...spec, id };
  delete detail.onChange;
  const sent = sendMainWorldMessage("dtm:mount-control", detail);
  if (sent) scheduleMainWorldControlRetry(host, detail, host.dataset.dtmControlMountVersion, 1);
  return sent;
}

function requestMainWorldToast(detail) {
  if (!sendMainWorldMessage("dtm:show-toast", detail)) {
    diagnosticLog(MAIN_WORLD_BRIDGE_ERROR);
    return false;
  }
  return true;
}

function shouldHandleMainWorldMessage(detail) {
  const id = detail && detail.__dtmMessageId;
  if (!id) return true;
  if (handledMainWorldMessageIds.has(id)) return false;
  handledMainWorldMessageIds.add(id);
  if (handledMainWorldMessageIds.size > 1000) handledMainWorldMessageIds.clear();
  return true;
}

function scheduleMainWorldControlRetry(host, detail, version, attempt) {
  if (attempt >= MAIN_WORLD_CONTROL_MAX_ATTEMPTS || typeof window === "undefined" || typeof window.setTimeout !== "function") {
    return;
  }
  window.setTimeout(() => {
    if (!host || host.dataset.dtmControlMountVersion !== version || host.dataset.dtmNativeReactMounted !== "pending") {
      return;
    }
    if (!sendMainWorldMessage("dtm:mount-control", detail)) return;
    scheduleMainWorldControlRetry(host, detail, version, attempt + 1);
  }, MAIN_WORLD_CONTROL_RETRY_MS);
}

function installMainWorldControlEvents() {
  if (mainWorldControlEventsInstalled || typeof window === "undefined") return;
  mainWorldControlEventsInstalled = true;

  window.addEventListener("dtm:settings-open", event => {
    if (shouldHandleMainWorldMessage(event.detail)) openSettingsPanel();
  });
  window.addEventListener("dtm:settings-close", event => {
    if (!shouldHandleMainWorldMessage(event.detail)) return;
    closeSettingsPanel();
  });
  window.addEventListener("dtm:control-change", event => {
    const detail = event.detail || {};
    if (!shouldHandleMainWorldMessage(detail)) return;
    const callback = mainWorldControlCallbacks.get(detail.id);
    if (callback) callback(detail.value);
  });

  window.addEventListener("dtm:control-mounted", event => {
    const detail = event.detail || {};
    if (!shouldHandleMainWorldMessage(detail)) return;
    handleMainWorldControlMounted(detail);
  });

  window.addEventListener("message", event => {
    const data = event.data || {};
    if (event.source !== window || data.source !== "dtm") return;
    if (data.type === "dtm:settings-open") {
      if (shouldHandleMainWorldMessage(data.detail)) openSettingsPanel();
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
    host.dataset.dtmNativeReactError = String(detail.error);
    diagnosticLog(detail.error);
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
      name: "预览",
      style: translationPreviewStyle(currentStyle, false)
    });
  }

  host.updateStyle = nextStyle => {
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

function settingRow(child) {
  const row = div(DISCORD_UI.settingCard);
  row.dataset.dtmNativeSettingRow = "true";

  const inner = stack("settingRow", DISCORD_UI.settingStack);
  inner.appendChild(child);
  row.appendChild(inner);
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

function passwordField(name, value, onChange, placeholder) {
  return inputField(name, "password", value, onChange, { placeholder });
}

function inputField(name, type, value, onChange, options = {}) {
  const resolvedKind = type === "textarea" ? "text-area" : "text-input";
  const host = reactControlHost(resolvedKind);

  mountDiscordReactControl(host, {
    kind: resolvedKind,
    name,
    type: type === "password" ? "password" : type === "number" ? "number" : "text",
    value: value == null ? "" : String(value),
    placeholder: options.placeholder || "",
    min: options.min,
    max: options.max,
    disabled: Boolean(options.disabled),
    onChange
  });

  return host;
}

function languageSelectField(name, value, onChange) {
  return selectField(name, value, optionsWithCurrentValue(LANGUAGE_OPTIONS, value), onChange);
}

function providerById(value) {
  return MODEL_PROVIDERS.find(provider => provider.value === value) || MODEL_PROVIDERS[0];
}

function providerHasApiKey(provider) {
  return Boolean(providerApiKeyStatus && providerApiKeyStatus[provider]);
}

function providerOptionsWithStatus(status) {
  const saved = status && typeof status === "object" ? status : {};
  return MODEL_PROVIDERS.map(provider => ({
    value: provider.value,
    label: provider.label,
    apiKeySaved: Boolean(saved[provider.value])
  }));
}

function apiKeyPlaceholder(provider) {
  if (!providerHasApiKey(provider)) return "粘贴 API Key";
  const previews = providerApiKeyStatus && providerApiKeyStatus.previews;
  const masked = previews && previews[provider];
  return masked ? `已保存 ${masked}` : "已保存（粘贴可替换）";
}

function apiKeyValueForRequest(value) {
  const trimmed = String(value || "").trim();
  return trimmed && trimmed !== API_KEY_MASK ? trimmed : "";
}

function optionsWithCurrentValue(options, value) {
  const current = String(value || "").trim();
  if (!current || options.some(option => option.value === current)) return options;
  return options.concat({ value: current, label: `${current}（当前自定义）` });
}

function selectField(name, value, options, onChange) {
  const items = options.map(option => typeof option === "string" ? { value: option, label: option } : option);
  const host = reactControlHost("select");

  mountDiscordReactControl(host, {
    kind: "select",
    name,
    value,
    options: items,
    onChange
  });

  return host;
}

function colorSwatchField(name, value, options, onChange) {
  const host = div("dtm-swatch-field");
  const label = div("dtm-field-label");
  label.textContent = name;
  const grid = div("dtm-swatch-grid");
  const buttons = [];

  const setSelected = nextValue => {
    for (const buttonNode of buttons) {
      buttonNode.setAttribute("aria-pressed", buttonNode.dataset.dtmColorValue === nextValue ? "true" : "false");
    }
  };

  for (const option of optionsWithCurrentValue(options, value)) {
    const buttonNode = document.createElement("button");
    buttonNode.type = "button";
    buttonNode.className = "dtm-swatch";
    buttonNode.title = option.label;
    buttonNode.setAttribute("aria-label", `${name}：${option.label}`);
    buttonNode.dataset.dtmColorValue = option.value;
    buttonNode.style.background = option.value === "auto" ? "var(--background-surface-high, var(--background-secondary))" : option.value;
    if (option.value === "auto") {
      buttonNode.textContent = "A";
      buttonNode.style.color = "var(--text-default, var(--text-normal))";
    }
    buttonNode.addEventListener("click", () => {
      setSelected(option.value);
      onChange(option.value);
    });
    buttons.push(buttonNode);
    grid.appendChild(buttonNode);
  }

  host.append(label, grid);
  setSelected(value);
  return host;
}

function modelComboBoxHostFor(name, value, options, onChange) {
  const host = reactControlHost("combobox");

  host.updateOptions = (nextValue, nextOptions) => {
    mountDiscordReactControl(host, {
      kind: "combobox",
      name,
      value: nextValue,
      options: nextOptions.map(comboBoxOption),
      onChange
    });
  };

  host.updateOptions(value, options);

  return host;
}

function comboBoxOption(option) {
  const item = typeof option === "string" ? { value: option, label: option } : option;
  const value = item && item.value != null ? String(item.value) : "";
  const label = item && item.label != null ? String(item.label) : value;
  return { ...item, id: value, value, label };
}

function toggleRow(name, checked, onChange) {
  const host = reactControlHost("switch");

  mountDiscordReactControl(host, {
    kind: "switch",
    name,
    value: Boolean(checked),
    onChange
  });

  return host;
}

function publicError(error) {
  let message = error && error.message ? error.message : String(error);
  message = message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/^Model list request failed/i, "模型列表请求失败")
    .replace(/^Model request failed/i, "模型请求失败")
    .replace(/^Model list is empty\.$/i, "没有可用模型。")
    .replace(/^Nothing to translate\.$/i, "没有可翻译的文本。");
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/([?&]key=)[^&\s]+/g, "$1[redacted]")
    .replace(/x-api-key\s*[:=]\s*[A-Za-z0-9._~+/=-]+/gi, "x-api-key: [redacted]");
}

module.exports = { start };

/* @dtm-test-only:start — stripped from the shipped payload by the build/install copy */
function setRuntimeForTests(runtime) {
  if (!originalTestRuntime) {
    originalTestRuntime = {
      nativeApi,
      settings,
      providerApiKeyStatus,
      nativeError,
      translationCache
    };
  }

  if (runtime && runtime.nativeApi) nativeApi = runtime.nativeApi;
  if (runtime && runtime.settings) settings = normalizeSettings(runtime.settings);
  if (runtime && runtime.providerApiKeyStatus) providerApiKeyStatus = { ...runtime.providerApiKeyStatus };
  if (runtime && Object.prototype.hasOwnProperty.call(runtime, "nativeError")) nativeError = String(runtime.nativeError || "");
  settingsPageOpen = false;
  settingsPageGeneration += 1;
  settingsSections.clear();
  mainWorldControlCallbacks.clear();
  handledMainWorldMessageIds.clear();
  mainWorldControlEventsInstalled = false;
  translationCache = new Map();
  translationCacheGeneration += 1;
  pendingTranslations = new Map();
  messageOperations = new WeakMap();
  if (persistCacheTimer) clearTimeout(persistCacheTimer);
  persistCacheTimer = 0;
  dismissedTranslations = new Set();
  translatedMessages = new Set();
  currentChannelId = runtime && runtime.channelId ? String(runtime.channelId) : "";
  autoTranslateBaseline = new Map();
  autoHandledMessages = new Set();
  autoTranslateQueue = [];
  autoTranslateActive = 0;
}

function resetRuntimeForTests() {
  if (!originalTestRuntime) return;
  translationCacheGeneration += 1;
  pendingTranslations.clear();
  messageOperations = new WeakMap();
  if (persistCacheTimer) clearTimeout(persistCacheTimer);
  persistCacheTimer = 0;
  nativeApi = originalTestRuntime.nativeApi;
  settings = originalTestRuntime.settings;
  providerApiKeyStatus = originalTestRuntime.providerApiKeyStatus;
  nativeError = originalTestRuntime.nativeError;
  translationCache = originalTestRuntime.translationCache;
  originalTestRuntime = null;
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
  runDomMaintenance,
  section,
  setRuntimeForTests,
  showNativeToast,
  translateMessage,
  translationPreviewStyle,
  toggleRow,
  applyAutoTranslateSettings,
  autoTranslateMessage,
  clearTranslationCache,
  getSettingsForTests: () => settings,
  getUnitCacheKey,
  loadPersistedCache,
  getCurrentChannelId,
  messageSnowflake,
  runAutoTranslate,
  shouldSkipSameLanguage,
  snowflakeTimestamp,
  syncCurrentChannel,
  restoreVisibleTranslations,
  refreshTranslationStyles
};
/* @dtm-test-only:end */
