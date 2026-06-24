"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { MODEL_PROVIDERS } = requireShared("defaults");
const { normalizeSettings } = requireShared("settings");
const {
  buildAnthropicMessagesUrl,
  buildChatCompletionsUrl,
  buildGeminiModelsUrl,
  buildOpenAIModelsUrl,
  buildTranslationMessages,
  parseAnthropicResponse,
  parseModelListResponse,
  parseOpenAICompatibleResponse,
  resolveModelConfig
} = requireShared("translate");

const CHANNELS = Object.freeze({
  getSettings: "dtm:get-settings",
  saveSettings: "dtm:save-settings",
  getApiKeyStatus: "dtm:get-api-key-status",
  setApiKey: "dtm:set-api-key",
  translate: "dtm:translate",
  testConnection: "dtm:test-connection",
  listModels: "dtm:list-models",
  insertAndSend: "dtm:insert-and-send",
  openSettingsFile: "dtm:open-settings-file",
  openExternal: "dtm:open-external"
});

const MAX_TRANSLATE_CHARS = 12000;
const MODEL_LIST_TIMEOUT_MS = 30000;

let installed = false;
let patchedBrowserWindow = false;
let registeredIpc = false;
let runtimeElectron = null;

function electronApi() {
  return runtimeElectron || require("electron");
}

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

function install() {
  if (installed) return;
  installed = true;

  const electron = require("electron");
  runtimeElectron = electron;
  patchBrowserWindow();
  registerIpcHandlers(electron);
}

function patchBrowserWindow() {
  if (patchedBrowserWindow) return;
  patchedBrowserWindow = true;

  const electron = require("electron");
  const OriginalBrowserWindow = electron.BrowserWindow;
  const translatorPreload = path.join(__dirname, "preload.js");

  class PatchedBrowserWindow extends OriginalBrowserWindow {
    constructor(options) {
      super(patchBrowserWindowOptions(options, translatorPreload));
    }
  }

  Object.assign(PatchedBrowserWindow, OriginalBrowserWindow);
  Object.defineProperty(PatchedBrowserWindow, "name", {
    configurable: true,
    value: "BrowserWindow"
  });

  const electronPath = require.resolve("electron");
  if (require.cache[electronPath]) {
    delete require.cache[electronPath].exports;
    require.cache[electronPath].exports = {
      ...electron,
      BrowserWindow: PatchedBrowserWindow
    };
  }

  try {
    Object.defineProperty(electron, "BrowserWindow", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: PatchedBrowserWindow
    });
  } catch (_error) {
    // Discord may expose Electron as a guarded object; require.cache patching above is the important path.
  }
}

function patchBrowserWindowOptions(inputOptions, translatorPreload) {
  const options = inputOptions && typeof inputOptions === "object" ? { ...inputOptions } : {};
  options.webPreferences = { ...(options.webPreferences || {}) };

  const originalPreload = typeof options.webPreferences.preload === "string"
    ? options.webPreferences.preload
    : "";

  const additionalArguments = Array.isArray(options.webPreferences.additionalArguments)
    ? [...options.webPreferences.additionalArguments]
    : [];

  const alreadyPatched = additionalArguments.includes("--dtm-preload=1") ||
    originalPreload.includes("discord-translator-mod/preload.js");

  if (!alreadyPatched && !originalPreload.includes("splashScreenPreload.js")) {
    if (originalPreload) {
      additionalArguments.push(`--dtm-original-preload=${Buffer.from(originalPreload, "utf8").toString("base64")}`);
    }

    additionalArguments.push("--dtm-preload=1");
    options.webPreferences.preload = translatorPreload;
    options.webPreferences.additionalArguments = additionalArguments;
    options.webPreferences.sandbox = false;
    options.webPreferences.contextIsolation = false;
  }

  return options;
}

function registerIpcHandlers(electron) {
  if (registeredIpc) return;
  registeredIpc = true;

  const { ipcMain } = electron;

  ipcMain.handle(CHANNELS.getSettings, () => readSettings());
  ipcMain.handle(CHANNELS.saveSettings, (_event, settings) => saveSettings(settings));
  ipcMain.handle(CHANNELS.getApiKeyStatus, () => getApiKeyStatus());
  ipcMain.handle(CHANNELS.setApiKey, (_event, request) => setApiKey(request));
  ipcMain.handle(CHANNELS.translate, (_event, request) => translate(request));
  ipcMain.handle(CHANNELS.testConnection, (_event, request) => testConnection(request));
  ipcMain.handle(CHANNELS.listModels, (_event, request) => listModels(request));
  ipcMain.handle(CHANNELS.openSettingsFile, () => openSettingsFile(electron));
  ipcMain.handle(CHANNELS.openExternal, (_event, url) => openExternal(electron, url));
  ipcMain.handle(CHANNELS.insertAndSend, async (event, text) => {
    const webContents = event.sender;
    const outgoingText = String(text || "").trim();
    if (!outgoingText) return { ok: false, error: "Nothing to send." };
    const send = readSettings().sendTranslation.enterToSend;

    await webContents.insertText(outgoingText);
    if (send) {
      await wait(40);
      webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    }

    return { ok: true, sent: send };
  });
}

function getStoreDir() {
  return path.join(electronApi().app.getPath("userData"), "discord-translator-mod");
}

function getSettingsPath() {
  return path.join(getStoreDir(), "settings.json");
}

function readSettings() {
  try {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return normalizeSettings({});
    return normalizeSettings(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (_error) {
    return normalizeSettings({});
  }
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  fs.mkdirSync(getStoreDir(), { recursive: true });
  fs.writeFileSync(getSettingsPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

async function openSettingsFile(electron) {
  const filePath = getSettingsPath();
  if (!fs.existsSync(filePath)) saveSettings(readSettings());
  const directoryPath = path.dirname(filePath);
  const error = await electron.shell.openPath(directoryPath);
  if (error) throw new Error(error);
  return { ok: true, path: directoryPath };
}

async function openExternal(electron, url) {
  const value = String(url || "").trim();
  if (!/^https:\/\//i.test(value)) return { ok: false, error: "Only https links are allowed." };
  await electron.shell.openExternal(value);
  return { ok: true, url: value };
}

function getApiKeysPath() {
  return path.join(getStoreDir(), "api-keys.json");
}

function readApiKeyStore() {
  try {
    const filePath = getApiKeysPath();
    if (!fs.existsSync(filePath)) return {};
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (_error) {
    return {};
  }
}

function writeApiKeyStore(store) {
  fs.mkdirSync(getStoreDir(), { recursive: true });
  fs.writeFileSync(getApiKeysPath(), `${JSON.stringify(store)}\n`, "utf8");
}

function encryptApiKey(value) {
  const safeStorage = electronApi().safeStorage;
  if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
    return { enc: "safeStorage", value: safeStorage.encryptString(value).toString("base64") };
  }
  // No OS keyring available (e.g. some Linux setups): keep it local, base64-wrapped.
  return { enc: "plain", value: Buffer.from(value, "utf8").toString("base64") };
}

function decryptApiKey(entry) {
  if (!entry || typeof entry !== "object") return "";
  try {
    if (entry.enc === "safeStorage") {
      const safeStorage = electronApi().safeStorage;
      if (!safeStorage || !safeStorage.isEncryptionAvailable || !safeStorage.isEncryptionAvailable()) return "";
      return safeStorage.decryptString(Buffer.from(String(entry.value || ""), "base64"));
    }
    return Buffer.from(String(entry.value || ""), "base64").toString("utf8");
  } catch (_error) {
    return "";
  }
}

function providerKeyId(provider) {
  return MODEL_PROVIDERS.some(item => item.value === provider) ? provider : "custom";
}

function getStoredApiKey(provider) {
  return decryptApiKey(readApiKeyStore()[providerKeyId(provider)]);
}

function getApiKey(provider) {
  return getStoredApiKey(provider);
}

function getApiKeyStatus() {
  const store = readApiKeyStore();
  const status = {};
  const previews = {};
  for (const provider of MODEL_PROVIDERS) {
    const key = decryptApiKey(store[provider.value]);
    status[provider.value] = key.length > 0;
    if (key) previews[provider.value] = maskApiKey(key);
  }
  status.previews = previews;
  return status;
}

function maskApiKey(key) {
  const value = String(key || "");
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function parseApiKeyRequest(request) {
  if (request && typeof request === "object" && !Array.isArray(request)) {
    return {
      provider: providerKeyId(request.provider),
      apiKey: String(request.apiKey || "").trim()
    };
  }

  return {
    provider: "custom",
    apiKey: String(request || "").trim()
  };
}

function setApiKey(request) {
  const parsed = parseApiKeyRequest(request);
  const store = readApiKeyStore();
  if (!parsed.apiKey) {
    delete store[parsed.provider];
    writeApiKeyStore(store);
    return { ok: true, hasApiKey: false };
  }

  store[parsed.provider] = encryptApiKey(parsed.apiKey);
  writeApiKeyStore(store);
  return { ok: true, hasApiKey: true };
}

async function translate(request) {
  const settings = readSettings();
  const modelConfig = resolveModelConfig(settings.model);
  return translateWithSettings(request, settings, getApiKey(modelConfig.provider));
}

async function testConnection(request) {
  const settings = normalizeSettings(request && request.settings);
  settings.enabled = true;
  settings.readTranslation.enabled = true;

  return translateWithSettings({
    direction: "read",
    text: "Hello, this is a connection test."
  }, settings, request && Object.prototype.hasOwnProperty.call(request, "apiKey")
    ? String(request.apiKey || "").trim()
    : getApiKey(resolveModelConfig(settings.model).provider));
}

async function listModels(request) {
  const settings = normalizeSettings(request && request.settings);
  const modelConfig = resolveModelConfig(settings.model);
  const apiKey = request && Object.prototype.hasOwnProperty.call(request, "apiKey")
    ? String(request.apiKey || "").trim()
    : getApiKey(modelConfig.provider);
  const requestData = buildModelListRequest(modelConfig, apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);

  try {
    const response = await fetch(requestData.url, {
      method: "GET",
      headers: requestData.headers,
      signal: controller.signal
    });

    const responseText = await response.text();
    let body = null;
    try {
      body = responseText ? JSON.parse(responseText) : null;
    } catch (_error) {
      body = null;
    }

    if (!response.ok) {
      const detail = body && body.error && body.error.message
        ? body.error.message
        : responseText.slice(0, 300);
      throw new Error(`Model list request failed (${response.status}): ${detail}`);
    }

    const models = parseModelListResponse(body, modelConfig.provider);
    if (models.length === 0) throw new Error("Model list is empty.");

    return { ok: true, models };
  } finally {
    clearTimeout(timeout);
  }
}

async function translateWithSettings(request, settings, apiKey) {
  const direction = request && request.direction === "send" ? "send" : "read";
  const text = String((request && request.text) || "").trim();

  if (!settings.enabled) throw new Error("Translator is disabled.");
  if (direction === "send" && !settings.sendTranslation.enabled) throw new Error("Send translation is disabled.");
  if (!text) throw new Error("Nothing to translate.");
  if (text.length > MAX_TRANSLATE_CHARS) throw new Error(`Text is too long. Limit is ${MAX_TRANSLATE_CHARS} characters.`);

  const modelConfig = resolveModelConfig(settings.model);
  const messages = buildTranslationMessages({ text, direction, settings });
  const requestData = buildProviderRequest(modelConfig, messages, apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(requestData.url, {
      method: "POST",
      headers: requestData.headers,
      signal: controller.signal,
      body: JSON.stringify(requestData.body)
    });

    const responseText = await response.text();
    let body = null;
    try {
      body = responseText ? JSON.parse(responseText) : null;
    } catch (_error) {
      body = null;
    }

    if (!response.ok) {
      const detail = body && body.error && body.error.message
        ? body.error.message
        : responseText.slice(0, 300);
      throw new Error(`Model request failed (${response.status}): ${detail}`);
    }

    return {
      ok: true,
      text: requestData.protocol === "anthropic"
        ? parseAnthropicResponse(body)
        : parseOpenAICompatibleResponse(body)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildModelListRequest(modelConfig, apiKey) {
  if (modelConfig.provider === "google") {
    return {
      url: buildGeminiModelsUrl(apiKey),
      headers: {}
    };
  }

  if (modelConfig.protocol === "anthropic") {
    const headers = {
      "anthropic-version": "2023-06-01"
    };
    if (apiKey) headers["x-api-key"] = apiKey;

    return {
      url: buildOpenAIModelsUrl(modelConfig.baseUrl),
      headers
    };
  }

  const headers = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  return {
    url: buildOpenAIModelsUrl(modelConfig.baseUrl),
    headers
  };
}

function buildProviderRequest(modelConfig, messages, apiKey) {
  if (modelConfig.protocol === "anthropic") {
    const systemMessage = messages.find(message => message.role === "system");
    const userMessages = messages
      .filter(message => message.role !== "system")
      .map(message => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }));
    const headers = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01"
    };
    if (apiKey) headers["x-api-key"] = apiKey;

    return {
      protocol: "anthropic",
      url: buildAnthropicMessagesUrl(modelConfig.baseUrl),
      headers,
      body: {
        model: modelConfig.modelId,
        max_tokens: anthropicMaxTokens(userMessages),
        temperature: 0.2,
        system: systemMessage ? systemMessage.content : "",
        messages: userMessages
      }
    };
  }

  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  return {
    protocol: "openai",
    url: buildChatCompletionsUrl(modelConfig.baseUrl),
    headers,
    body: {
      model: modelConfig.modelId,
      temperature: 0.2,
      messages
    }
  };
}

function anthropicMaxTokens(userMessages) {
  // Anthropic requires an explicit max_tokens; a fixed 2048 truncates long
  // translations. Scale with the input size (CJK output can be ~1 token/char)
  // and keep it within a range every supported Claude model can return.
  const chars = userMessages.reduce((total, message) => total + String(message.content || "").length, 0);
  const estimate = Math.ceil(chars * 1.5) + 256;
  return Math.min(8192, Math.max(1024, estimate));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* @dtm-test-only:start — stripped from the shipped payload by the build/install copy */
function setElectronForTests(electron) {
  runtimeElectron = electron;
}
/* @dtm-test-only:end */

module.exports = {
  CHANNELS,
  getApiKeyStatus,
  install,
  listModels,
  openSettingsFile,
  openExternal,
  patchBrowserWindowOptions,
  setApiKey,
  /* @dtm-test-only:start */
  setElectronForTests,
  /* @dtm-test-only:end */
  testConnection,
  translateWithSettings
};
