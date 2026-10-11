"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { Writer } = require("./core/storage");
const { KeyStore } = require("./core/key-store");
const { SettingsStore } = require("./core/settings-store");
const { CacheStore } = require("./core/cache-store");
const { TranslationService } = require("./core/translation-service");
const { IpcGuard, mainPreload } = require("./core/ipc-guard");
const { createProvider } = require("./core/provider-fetch");
const { publicFailure, failure } = require("./core/errors");
const { normalizeSettings } = requireShared("settings");
const { resolveUiLocale, normalizePreference } = requireShared("ui-locale");
let sessionSystemLocale;
let localeDiagnosticSent = false;
function getSystemLocale() {
  if (sessionSystemLocale) return sessionSystemLocale;
  let app;
  try { app = electronApi().app; } catch (_) {}
  if (app?.isReady?.() === false) return "en";
  let preferences;
  try { preferences = app?.getPreferredSystemLanguages?.(); } catch (_) {}
  if (!Array.isArray(preferences) || !preferences.length || !preferences.some(value => normalizePreference(value))) {
    if (!localeDiagnosticSent) console.warn("[Babel] System UI language unavailable; using en.");
    localeDiagnosticSent = true;
  }
  return sessionSystemLocale = resolveUiLocale(preferences);
}
const { BABEL_VERSION } = requireShared("defaults");
const CHANNELS = Object.freeze({
  getSettings: "dtm:get-settings",
  saveConfig: "dtm:save-config",
  patchSendBox: "dtm:patch-send-box",
  getApiKeyStatus: "dtm:get-api-key-status",
  translate: "dtm:translate",
  cancel: "dtm:cancel",
  testConnection: "dtm:test-connection",
  listModels: "dtm:list-models",
  openSettingsFile: "dtm:open-settings-file",
  openExternal: "dtm:open-external",
  cacheStatus: "dtm:cache-status",
  clearCache: "dtm:clear-cache",
  checkUpdate: "dtm:check-update",
  configChanged: "dtm:config-changed",
});
const GITHUB_RELEASES_ATOM = "https://github.com/itsmaiGe/babel/releases.atom",
  UPDATE_CHECK_TIMEOUT_MS = 8000;
let runtimeElectron = null,
  runtime = null,
  installed = false,
  initializing = false,
  registeredIpc = false;
const auxiliary = new Map();
const guard = new IpcGuard((owner) => {
  if (runtime)
    runtime.service.cancel(
      owner,
      [
        ...runtime.service.consumers.values(),
        ...runtime.service.admissions.values(),
      ]
        .filter((c) => c.owner === owner)
        .map((c) => c.requestId),
    );
});
function requireShared(name) {
  try {
    return require(`./shared/${name}`);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return require(`../shared/${name}`);
    throw error;
  }
}
function electronApi() {
  return runtimeElectron || require("electron");
}
function getStoreDir() {
  return path.join(
    electronApi().app.getPath("userData"),
    "discord-translator-mod",
  );
}
function getRuntime() {
  if (runtime) return runtime;
  const electron = electronApi(),
    writer = new Writer(),
    keys = new KeyStore(getStoreDir(), electron, writer);
  const settings = new SettingsStore(
    getStoreDir(),
    writer,
    keys,
    (snapshot) => {
      if (runtime) {
        if (snapshot.executionRevision !== runtime.lastExecutionRevision) {
          runtime.service.invalidate(snapshot.executionRevision);
          runtime.lastExecutionRevision = snapshot.executionRevision;
        }
      }
      guard.broadcast(CHANNELS.configChanged, {
        settingsRevision: snapshot.settingsRevision,
        executionRevision: snapshot.executionRevision,
      });
    },
  );
  const cache = new CacheStore(getStoreDir(), writer);
  const provider = createProvider(electron);
  const service = new TranslationService({
    snapshot: () => settings.snapshot(),
    credential: (model) => keys.credential(model),
    provider,
    cache,
  });
  runtime = { writer, keys, settings, cache, provider, service, lastExecutionRevision: settings.executionRevision };
  settings.startWatching();
  electron.app.once?.("before-quit", () => settings.stopWatching());
  runtime.ready = keys
    .migrate(settings.settings, settings.savedCustomEndpoint)
    .catch(() => {
      settings.status = {
        code: "STORAGE",
        reason: "KEY_MIGRATION",
        message: "密钥迁移失败，原文件已保留。",
      };
    });
  return runtime;
}
async function getSettings() {
  const r = getRuntime();
  await r.ready;
  await r.cache.ready;
  return {
    ...r.settings.snapshot(),
    ui: { systemLocale: getSystemLocale() },
    keyStatus: r.keys.status(r.settings.settings.model),
    credentialContext: r.keys.displayContext(r.settings.settings.model),
    cache: r.cache.status(),
    translation: r.service.status(),
  };
}
async function saveConfig(request) {
  const r = getRuntime();
  await r.ready;
  const snapshot = await r.settings.save(request);
  return {
    ...snapshot,
    ui: { systemLocale: getSystemLocale() },
    keyStatus: r.keys.status(snapshot.settings.model),
    credentialContext: r.keys.displayContext(snapshot.settings.model),
    cache: r.cache.status(),
  };
}
function patchBrowserWindowOptions(inputOptions, translatorPreload) {
  const options = {
      ...inputOptions,
      webPreferences: { ...(inputOptions?.webPreferences || {}) },
    },
    original = options.webPreferences.preload;
  const args = [...(options.webPreferences.additionalArguments || [])].filter(arg => !String(arg).startsWith("--dtm-ui-locale="));
  if (mainPreload(original)) {
    if (!args.includes("--dtm-preload=1")) args.push(
      `--dtm-original-preload=${Buffer.from(original).toString("base64")}`,
      "--dtm-preload=1",
    );
    args.push(`--dtm-ui-locale=${getSystemLocale()}`);
    Object.assign(options.webPreferences, {
      preload: translatorPreload,
      additionalArguments: args,
      sandbox: false,
      contextIsolation: false,
    });
  }
  return options;
}
function replaceBrowserWindow(electron, replacement) {
  const descriptor = Object.getOwnPropertyDescriptor(electron, "BrowserWindow");
  let restore;
  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(electron, "BrowserWindow", {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      writable: true,
      value: replacement,
    });
    restore = () => {
      if (descriptor) Object.defineProperty(electron, "BrowserWindow", descriptor);
      else delete electron.BrowserWindow;
    };
  } else if (Object.hasOwn(descriptor, "value") && descriptor.writable) {
    Object.defineProperty(electron, "BrowserWindow", { value: replacement });
    restore = () => Object.defineProperty(electron, "BrowserWindow", descriptor);
  } else {
    // Electron 42 locks individual API getters, but its cached exports getter
    // is configurable. Never assign to that getter or eagerly spread API values.
    const cached = require.cache[require.resolve("electron")],
      exportsDescriptor = cached && Object.getOwnPropertyDescriptor(cached, "exports");
    if (!exportsDescriptor || (!exportsDescriptor.configurable &&
        !(Object.hasOwn(exportsDescriptor, "value") && exportsDescriptor.writable))) {
      throw new Error("Electron BrowserWindow is not replaceable.");
    }
    const descriptors = Object.getOwnPropertyDescriptors(electron);
    descriptors.BrowserWindow = { configurable: true, enumerable: descriptor.enumerable, writable: true, value: replacement };
    const api = Object.defineProperties(Object.create(Object.getPrototypeOf(electron)), descriptors);
    Object.defineProperty(cached, "exports", exportsDescriptor.configurable
      ? { configurable: true, enumerable: exportsDescriptor.enumerable, get: () => api }
      : { value: api });
    restore = () => Object.defineProperty(cached, "exports", exportsDescriptor);
    electron = require("electron");
  }
  if (electron.BrowserWindow !== replacement) {
    restore();
    throw new Error("Electron BrowserWindow hook was not applied.");
  }
  return { electron, restore };
}
function install() {
  if (installed || initializing) return;
  initializing = true;
  let restore;
  const previousElectron = runtimeElectron;
  try {
    const electron = electronApi();
    runtimeElectron = electron;
    if (electron.app?.isReady?.() !== false) getSystemLocale();
    else electron.app.whenReady?.().then(getSystemLocale);
    const Original = electron.BrowserWindow;
    class Patched extends Original {
      constructor(options) {
        const positive = mainPreload(options?.webPreferences?.preload);
        super(
          patchBrowserWindowOptions(options, path.join(__dirname, "preload.js")),
        );
        if (positive) guard.track(this);
      }
    }
    // Static APIs remain inherited, including any earlier injector's additions.
    Object.defineProperty(Patched, "name", { value: "BrowserWindow" });
    Object.defineProperty(Patched, "toString", {
      value: () => "function BrowserWindow() { [native code] }",
    });
    const binding = replaceBrowserWindow(electron, Patched);
    restore = binding.restore;
    runtimeElectron = binding.electron;
    registerIpcHandlers(binding.electron);
    installed = true;
  } catch (error) {
    restore?.();
    runtimeElectron = previousElectron;
    throw error;
  } finally {
    initializing = false;
  }
}
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value) => {
  try {
    return object(value) && JSON.stringify(value).length <= 32768;
  } catch (_) {
    return false;
  }
};
const empty = (value) => value === undefined || value === null;
const validators = {
  getSettings: empty,
  cacheStatus: empty,
  clearCache: empty,
  openSettingsFile: empty,
  checkUpdate: empty,
  saveConfig: (value) =>
    bounded(value) &&
    Number.isSafeInteger(value.baseSettingsRevision) &&
    object(value.settings) &&
    object(value.key) &&
    ["keep", "replace", "remove", "link", "removeLegacy", "reset"].includes(
      value.key.action,
    ),
  patchSendBox: (value) =>
    object(value) &&
    Object.keys(value).every(
      (key) =>
        ["x", "y", "width"].includes(key) &&
        (value[key] === null ||
          (Number.isFinite(value[key]) && Math.abs(value[key]) <= 100000)),
    ),
  getApiKeyStatus: (value) => empty(value) || bounded(value),
  translate: (value) =>
    bounded(value) &&
    typeof value.requestId === "string" &&
    Number.isSafeInteger(value.expectedExecutionRevision),
  cancel: (value) =>
    object(value) &&
    Array.isArray(value.requestIds) &&
    value.requestIds.length <= 64 &&
    value.requestIds.every(
      (id) => typeof id === "string" && /^[\w:-]{1,80}$/.test(id),
    ),
  testConnection: (value) =>
    bounded(value) &&
    object(value.settings) &&
    (value.apiKey === undefined ||
      (typeof value.apiKey === "string" && value.apiKey.length <= 8192)),
  listModels: (value) => validators.testConnection(value),
  openExternal: (value) => typeof value === "string" && value.length <= 2048,
};
function registerIpcHandlers(electron) {
  if (registeredIpc) return;
  const handlers = {
    getSettings: () => getSettings(),
    saveConfig: (_, value) => saveConfig(value),
    patchSendBox: (_, value) => getRuntime().settings.patchSendBox(value),
    getApiKeyStatus: (_, value) => getApiKeyStatus(value),
    translate: async (owner, value) => {
      await getRuntime().ready;
      return getRuntime().service.translate(owner, value);
    },
    cancel: (owner, value) =>
      getRuntime().service.cancel(owner, value.requestIds),
    testConnection: (owner, value) =>
      boundedAux(owner, "test", () => testConnection(value)),
    listModels: (owner, value) =>
      boundedAux(owner, "models", () => listModels(value)),
    openSettingsFile: () => openSettingsFile(electron),
    openExternal: (_, value) => openExternal(electron, value),
    cacheStatus: async () => {
      await getRuntime().cache.ready;
      return getRuntime().cache.status();
    },
    clearCache: async () => {
      await getRuntime().cache.clear();
      return { ok: true, ...getRuntime().cache.status() };
    },
    checkUpdate: () => checkForUpdate(),
  };
  const added = [];
  try {
    for (const [name, handle] of Object.entries(handlers)) {
      electron.ipcMain.handle(CHANNELS[name], async (event, value) => {
        try {
          const owner = guard.authorize(event, validators[name], value);
          return await handle(owner, value);
        } catch (error) {
          return publicFailure(error);
        }
      });
      added.push(CHANNELS[name]);
    }
    registeredIpc = true;
  } catch (error) {
    for (const channel of added) electron.ipcMain.removeHandler(channel);
    throw error;
  }
}
async function boundedAux(owner, operation, run) {
  const key = `${owner}:${operation}`;
  if (auxiliary.has(key)) throw failure("BUSY");
  auxiliary.set(key, true);
  try {
    return await run();
  } finally {
    auxiliary.delete(key);
  }
}
function getApiKeyStatus(request = {}) {
  const r = getRuntime(),
    model = normalizeSettings({
      model: { ...r.settings.settings.model, ...request },
    }).model;
  return r.keys.status(model);
}
async function testConnection(request) {
  const r = getRuntime();
  await r.ready;
  const settings = normalizeSettings(request?.settings);
  settings.enabled = true;
  settings.sendTranslation.enabled = true;
  const { apiKey } = r.keys.credential(settings.model, request?.apiKey);
  const text = await r.provider.translate({
    settings,
    apiKey,
    direction: "read",
    text: "Hello, this is a connection test.",
  });
  return { ok: true, text, endpoint: settings.model.baseUrl };
}
async function listModels(request) {
  const r = getRuntime();
  await r.ready;
  const settings = normalizeSettings(request?.settings),
    { apiKey } = r.keys.credential(settings.model, request?.apiKey);
  return { ok: true, models: await r.provider.models({ settings, apiKey }) };
}
async function openSettingsFile(electron) {
  const directory = getStoreDir();
  await fs.promises.mkdir(directory, { recursive: true });
  const error = await electron.shell.openPath(directory);
  if (error) throw failure("STORAGE", null, { reason: "OPEN_FOLDER" });
  return { ok: true, path: directory };
}
async function openExternal(electron, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return publicFailure(failure("INPUT", null, { reason: "EXTERNAL_HTTPS" }));
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    return publicFailure(failure("INPUT", null, { reason: "EXTERNAL_HTTPS" }));
  await electron.shell.openExternal(parsed.toString());
  return { ok: true, url: parsed.toString() };
}
function parseVersion(value) {
  const core = String(value || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[-+]/)[0];
  return core.split(".").map((part) => parseInt(part, 10) || 0);
}

// Returns 1 if a > b, -1 if a < b, 0 if equal (numeric semver-ish, ignores pre-release).
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

// Best-effort: read the latest release tag from GitHub's releases ATOM feed (rate-limit
// free) and compare to the bundled version. Any failure resolves to "no update".
async function checkForUpdate() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await createProvider(runtimeElectron || {}).http(
      GITHUB_RELEASES_ATOM,
      {
        method: "GET",
        headers: { "User-Agent": "Babel-Discord-Translator" },
        signal: controller.signal,
      },
    );
    if (!response.ok) return { ok: false, current: BABEL_VERSION };

    const xml = await response.text();
    // Entries are newest-first; the first /releases/tag/<tag> link is the latest release.
    const match = xml.match(/releases\/tag\/([^"'<>\s]+)/);
    const tag = match ? decodeURIComponent(match[1]).trim() : "";
    if (!tag) return { ok: false, current: BABEL_VERSION };

    return {
      ok: true,
      current: BABEL_VERSION,
      latest: tag.replace(/^v/i, ""),
      updateAvailable: compareVersions(tag, BABEL_VERSION) > 0,
      url: `https://github.com/itsmaiGe/babel/releases/tag/${tag}`,
    };
  } catch (_error) {
    return { ok: false, current: BABEL_VERSION };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { install, CHANNELS };
/* @dtm-test-only:start */
function setElectronForTests(electron) {
  sessionSystemLocale = undefined; localeDiagnosticSent = false;
  runtime?.cache && clearTimeout(runtime.cache.timer);
  // Tear down the outgoing runtime's file watching too: tests delete these
  // fixture directories right after this call, and Windows refuses to remove a
  // directory that still has a watch handle open.
  runtime?.settings?.stopWatching();
  runtimeElectron = electron;
  runtime = null;
}
async function setApiKey(request) {
  const r = getRuntime();
  await r.ready;
  const model = normalizeSettings({
    model: {
      provider: request?.provider || "custom",
      baseUrl: request?.baseUrl,
    },
  }).model;
  const snapshot = r.settings.snapshot();
  return saveConfig({
    baseSettingsRevision: snapshot.settingsRevision,
    settings: {
      ...snapshot.settings,
      model: { ...snapshot.settings.model, ...model },
    },
    key: request.apiKey
      ? { action: "replace", value: request.apiKey }
      : { action: "remove" },
  });
}
async function translateWithSettings(request, settings, apiKey) {
  return {
    ok: true,
    text: await createProvider(runtimeElectron || {}).translate({
      settings,
      apiKey,
      ...request,
    }),
  };
}
async function providerOnlyTest(request, models = false) {
  if (runtimeElectron)
    return models ? listModels(request) : testConnection(request);
  const settings = normalizeSettings(request.settings);
  settings.enabled = true;
  const provider = createProvider();
  return models
    ? {
        ok: true,
        models: await provider.models({
          settings,
          apiKey: request.apiKey || "",
        }),
      }
    : {
        ok: true,
        text: await provider.translate({
          settings,
          apiKey: request.apiKey || "",
          direction: "read",
          text: "Hello, this is a connection test.",
        }),
      };
}
Object.assign(module.exports, {
  checkForUpdate,
  compareVersions,
  getSettings,
  getSystemLocale,
  saveConfig,
  getRuntime,
  getApiKeyStatus,
  openSettingsFile,
  openExternal,
  patchBrowserWindowOptions,
  setApiKey,
  setElectronForTests,
  testConnection,
  listModels,
  translateWithSettings,
  registerIpcHandlers,
  guard,
  testConnection: (request) => providerOnlyTest(request),
  listModels: (request) => providerOnlyTest(request, true),
});
/* @dtm-test-only:end */
