"use strict";

const path = require("node:path");
const { ipcRenderer } = require("electron");

function runOriginalPreload() {
  const arg = process.argv.find(value => value.startsWith("--dtm-original-preload="));
  if (!arg) return;

  const encoded = arg.slice("--dtm-original-preload=".length);
  const originalPreload = Buffer.from(encoded, "base64").toString("utf8");
  if (!originalPreload) return;

  try {
    require(originalPreload);
  } catch (error) {
    console.error("[Discord Translator Mod] Failed to run Discord preload:", error);
  }
}

runOriginalPreload();

const api = Object.freeze({
  getSettings: () => ipcRenderer.invoke("dtm:get-settings"),
  saveSettings: settings => ipcRenderer.invoke("dtm:save-settings", settings),
  hasApiKey: () => ipcRenderer.invoke("dtm:has-api-key"),
  setApiKey: apiKey => ipcRenderer.invoke("dtm:set-api-key", apiKey),
  translate: request => ipcRenderer.invoke("dtm:translate", request),
  insertAndSend: text => ipcRenderer.invoke("dtm:insert-and-send", text)
});

function startRuntime() {
  try {
    require(path.join(__dirname, "renderer.js")).start(api);
  } catch (error) {
    console.error("[Discord Translator Mod] Failed to start renderer runtime:", error);
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startRuntime, { once: true });
} else {
  startRuntime();
}
