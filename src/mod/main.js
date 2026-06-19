"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const electron = require("electron");
const { normalizeSettings } = require("./shared/settings");
const { buildChatCompletionsUrl, buildTranslationMessages, parseOpenAICompatibleResponse } = require("./shared/translate");

const CHANNELS = Object.freeze({
  getSettings: "dtm:get-settings",
  saveSettings: "dtm:save-settings",
  hasApiKey: "dtm:has-api-key",
  setApiKey: "dtm:set-api-key",
  translate: "dtm:translate",
  insertAndSend: "dtm:insert-and-send"
});

const KEYCHAIN_SERVICE = "DiscordTranslatorMod";
const KEYCHAIN_ACCOUNT = "default";
const MAX_TRANSLATE_CHARS = 12000;

let installed = false;
let patchedBrowserWindow = false;

function install() {
  if (installed) return;
  installed = true;

  patchBrowserWindow();
  registerIpcHandlers();
}

function patchBrowserWindow() {
  if (patchedBrowserWindow) return;
  patchedBrowserWindow = true;

  const OriginalBrowserWindow = electron.BrowserWindow;
  const translatorPreload = path.join(__dirname, "preload.js");

  const PatchedBrowserWindow = new Proxy(OriginalBrowserWindow, {
    construct(target, args, newTarget) {
      const options = args[0] && typeof args[0] === "object" ? { ...args[0] } : {};
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
      }

      return Reflect.construct(target, [options, ...args.slice(1)], newTarget);
    }
  });

  Object.defineProperty(electron, "BrowserWindow", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: PatchedBrowserWindow
  });
}

function registerIpcHandlers() {
  const { ipcMain } = electron;

  ipcMain.handle(CHANNELS.getSettings, () => readSettings());
  ipcMain.handle(CHANNELS.saveSettings, (_event, settings) => saveSettings(settings));
  ipcMain.handle(CHANNELS.hasApiKey, () => hasApiKey());
  ipcMain.handle(CHANNELS.setApiKey, (_event, apiKey) => setApiKey(apiKey));
  ipcMain.handle(CHANNELS.translate, (_event, request) => translate(request));
  ipcMain.handle(CHANNELS.insertAndSend, async (event, text) => {
    const webContents = event.sender;
    const outgoingText = String(text || "").trim();
    if (!outgoingText) return { ok: false, error: "Nothing to send." };

    await webContents.insertText(outgoingText);
    await wait(40);
    webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });

    return { ok: true };
  });
}

function getStoreDir() {
  return path.join(electron.app.getPath("userData"), "discord-translator-mod");
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

function runSecurity(args) {
  return childProcess.execFileSync("/usr/bin/security", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function getApiKey() {
  try {
    return runSecurity(["find-generic-password", "-w", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT]).trim();
  } catch (_error) {
    return "";
  }
}

function hasApiKey() {
  return getApiKey().length > 0;
}

function setApiKey(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) {
    try {
      runSecurity(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT]);
    } catch (_error) {
      // Missing key is already the desired state.
    }
    return { ok: true, hasApiKey: false };
  }

  runSecurity(["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", value]);
  return { ok: true, hasApiKey: true };
}

async function translate(request) {
  const settings = readSettings();
  const direction = request && request.direction === "send" ? "send" : "read";
  const text = String((request && request.text) || "").trim();

  if (!settings.enabled) throw new Error("Translator is disabled.");
  if (direction === "read" && !settings.readTranslation.enabled) throw new Error("Read translation is disabled.");
  if (direction === "send" && !settings.sendTranslation.enabled) throw new Error("Send translation is disabled.");
  if (!text) throw new Error("Nothing to translate.");
  if (text.length > MAX_TRANSLATE_CHARS) throw new Error(`Text is too long. Limit is ${MAX_TRANSLATE_CHARS} characters.`);

  const apiKey = getApiKey();
  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(buildChatCompletionsUrl(settings.model.baseUrl), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model.modelId,
        temperature: 0.2,
        messages: buildTranslationMessages({ text, direction, settings })
      })
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
      text: parseOpenAICompatibleResponse(body)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  CHANNELS,
  install
};
