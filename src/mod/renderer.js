"use strict";

const RUNTIME_FLAG = "__discordTranslatorModStarted";
const SETTINGS_BUTTON_ID = "dtm-settings-button";
const FLOATING_BUTTON_ID = "dtm-floating-button";
const SETTINGS_PANEL_ID = "dtm-settings-panel";
const SEND_BOX_ID = "dtm-send-box";

let nativeApi = null;
let settings = null;
let hasApiKey = false;
let translationCache = new Map();

function start(api) {
  if (window[RUNTIME_FLAG]) return;
  window[RUNTIME_FLAG] = true;
  nativeApi = api;

  injectBaseStyles();

  loadSettings().then(() => {
    document.addEventListener("dblclick", onMessageDoubleClick, true);
    const observer = new MutationObserver(() => {
      ensureSettingsEntry();
      ensureFloatingSettingsButton();
      ensureSendBox();
      restoreVisibleTranslations();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    setInterval(() => {
      ensureSettingsEntry();
      ensureFloatingSettingsButton();
      ensureSendBox();
    }, 1500);
  });
}

async function loadSettings() {
  settings = await nativeApi.getSettings();
  hasApiKey = await nativeApi.hasApiKey();
}

function injectBaseStyles() {
  if (document.getElementById("dtm-style")) return;
  const style = document.createElement("style");
  style.id = "dtm-style";
  style.textContent = `
    .dtm-button {
      border: 0;
      border-radius: 6px;
      color: #dbdee1;
      background: #5865f2;
      font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 8px 11px;
      cursor: pointer;
    }
    .dtm-button.secondary { background: #3f4147; }
    .dtm-button.danger { background: #da373c; }
    .dtm-button:disabled { opacity: .55; cursor: not-allowed; }
    #${SETTINGS_BUTTON_ID} {
      width: 100%;
      border: 0;
      border-radius: 4px;
      padding: 7px 10px;
      color: #b5bac1;
      background: transparent;
      text-align: left;
      cursor: pointer;
      font: 500 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #${SETTINGS_BUTTON_ID}:hover { color: #fff; background: #35373c; }
    #${FLOATING_BUTTON_ID} {
      position: fixed;
      right: 18px;
      bottom: 88px;
      z-index: 9999;
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 8px;
      color: #fff;
      background: #5865f2;
      box-shadow: 0 8px 20px rgba(0,0,0,.28);
      cursor: pointer;
      font: 700 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #${SETTINGS_PANEL_ID} {
      position: fixed;
      z-index: 10000;
      top: 72px;
      right: 28px;
      bottom: 28px;
      width: min(760px, calc(100vw - 56px));
      color: #dbdee1;
      background: #1e1f22;
      border: 1px solid #3f4147;
      border-radius: 8px;
      box-shadow: 0 18px 60px rgba(0,0,0,.45);
      overflow: hidden;
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .dtm-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid #3f4147;
      background: #2b2d31;
    }
    .dtm-panel-title {
      margin: 0;
      color: #f2f3f5;
      font-size: 18px;
      font-weight: 700;
    }
    .dtm-panel-body {
      height: calc(100% - 66px);
      overflow: auto;
      padding: 18px;
    }
    .dtm-section {
      border-top: 1px solid #3f4147;
      padding-top: 18px;
      margin-top: 18px;
    }
    .dtm-section:first-child {
      border-top: 0;
      margin-top: 0;
      padding-top: 0;
    }
    .dtm-section-title {
      margin: 0 0 10px;
      color: #f2f3f5;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .dtm-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .dtm-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .dtm-field.full { grid-column: 1 / -1; }
    .dtm-label {
      color: #b5bac1;
      font-size: 12px;
      font-weight: 600;
    }
    .dtm-input, .dtm-select, .dtm-textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #3f4147;
      border-radius: 6px;
      color: #f2f3f5;
      background: #111214;
      padding: 9px 10px;
      outline: none;
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .dtm-textarea { min-height: 94px; resize: vertical; }
    .dtm-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 0;
    }
    .dtm-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 16px;
    }
    .dtm-status {
      color: #b5bac1;
      font-size: 12px;
      min-height: 18px;
    }
    .dtm-translation-block {
      box-sizing: border-box;
      width: fit-content;
      max-width: min(760px, 100%);
      margin-top: 6px;
      padding: 7px 9px;
      white-space: pre-wrap;
      user-select: text;
      border: 1px solid rgba(255,255,255,.08);
    }
    #${SEND_BOX_ID} {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0 0;
      padding: 7px;
      border: 1px solid #3f4147;
      border-radius: 8px;
      background: #1e1f22;
    }
    #${SEND_BOX_ID} input {
      flex: 1;
      min-width: 120px;
      border: 0;
      outline: none;
      color: #f2f3f5;
      background: transparent;
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #${SEND_BOX_ID} span {
      color: #949ba4;
      font-size: 12px;
      white-space: nowrap;
    }
    @media (max-width: 720px) {
      #${SETTINGS_PANEL_ID} {
        inset: 48px 10px 10px;
        width: auto;
      }
      .dtm-grid { grid-template-columns: 1fr; }
    }
  `;
  document.documentElement.appendChild(style);
}

function ensureSettingsEntry() {
  if (document.getElementById(SETTINGS_BUTTON_ID)) return;

  const sidebar = findSettingsSidebar();
  if (!sidebar) return;

  const button = document.createElement("button");
  button.id = SETTINGS_BUTTON_ID;
  button.type = "button";
  button.textContent = "Translator";
  button.addEventListener("click", openSettingsPanel);

  sidebar.appendChild(button);
}

function findSettingsSidebar() {
  const candidates = Array.from(document.querySelectorAll("nav, [role='navigation'], [role='tablist'], [class*='sidebar'], [class*='side']"));
  return candidates.find(node => {
    const box = node.getBoundingClientRect();
    if (box.width < 120 || box.width > 420 || box.height < 260) return false;
    const text = node.textContent || "";
    return /My Account|Profiles|Privacy|Appearance|Voice|Keybinds|Notifications|账户|账号|个人资料|隐私|外观|语音|通知/.test(text);
  }) || null;
}

function ensureFloatingSettingsButton() {
  if (document.getElementById(FLOATING_BUTTON_ID)) return;
  const button = document.createElement("button");
  button.id = FLOATING_BUTTON_ID;
  button.type = "button";
  button.title = "Translator settings";
  button.textContent = "译";
  button.addEventListener("click", openSettingsPanel);
  document.body.appendChild(button);
}

async function openSettingsPanel() {
  await loadSettings();

  const existing = document.getElementById(SETTINGS_PANEL_ID);
  if (existing) existing.remove();

  const panel = document.createElement("section");
  panel.id = SETTINGS_PANEL_ID;

  const header = div("dtm-panel-header");
  const title = document.createElement("h2");
  title.className = "dtm-panel-title";
  title.textContent = "Translator";
  const close = button("Close", "secondary");
  close.addEventListener("click", () => panel.remove());
  header.append(title, close);

  const body = div("dtm-panel-body");
  const formState = JSON.parse(JSON.stringify(settings));

  const status = div("dtm-status");
  status.textContent = hasApiKey ? "API key is saved in macOS Keychain." : "API key is not saved yet.";

  body.append(
    section("Model", [
      grid([
        textField("Base URL", formState.model.baseUrl, value => { formState.model.baseUrl = value; }),
        textField("Model ID", formState.model.modelId, value => { formState.model.modelId = value; }),
        passwordField("API Key", "", value => { formState.__apiKey = value; }, hasApiKey ? "Leave blank to keep current key" : "Paste API key"),
        textField("Read target language", formState.model.targetLanguage, value => { formState.model.targetLanguage = value; }),
        textField("Send target language", formState.model.sendLanguage, value => { formState.model.sendLanguage = value; })
      ])
    ]),
    section("Features", [
      toggleRow("Enable translator", formState.enabled, value => { formState.enabled = value; }),
      toggleRow("Double-click message translation", formState.readTranslation.enabled, value => { formState.readTranslation.enabled = value; }),
      toggleRow("Translated send box", formState.sendTranslation.enabled, value => { formState.sendTranslation.enabled = value; })
    ]),
    section("Prompts", [
      grid([
        textareaField("Read translation prompt", formState.model.customReadPrompt, value => { formState.model.customReadPrompt = value; }),
        textareaField("Send translation prompt", formState.model.customSendPrompt, value => { formState.model.customSendPrompt = value; })
      ])
    ]),
    section("Style", [
      grid([
        selectField("Decoration", formState.style.textDecoration, ["none", "underline", "wavy"], value => { formState.style.textDecoration = value; }),
        textField("Background color", formState.style.backgroundColor, value => { formState.style.backgroundColor = value; }),
        textField("Text color", formState.style.textColor, value => { formState.style.textColor = value; }),
        numberField("Border radius", formState.style.borderRadius, value => { formState.style.borderRadius = value; }, 0, 24),
        textField("Font family", formState.style.fontFamily, value => { formState.style.fontFamily = value; }),
        numberField("Font size", formState.style.fontSize, value => { formState.style.fontSize = value; }, 10, 24)
      ])
    ])
  );

  const actions = div("dtm-actions");
  const save = button("Save");
  save.addEventListener("click", async () => {
    save.disabled = true;
    status.textContent = "Saving...";
    try {
      const apiKey = String(formState.__apiKey || "").trim();
      delete formState.__apiKey;
      settings = await nativeApi.saveSettings(formState);
      if (apiKey) await nativeApi.setApiKey(apiKey);
      hasApiKey = await nativeApi.hasApiKey();
      status.textContent = "Saved.";
      ensureSendBox();
      refreshTranslationStyles();
    } catch (error) {
      status.textContent = publicError(error);
    } finally {
      save.disabled = false;
    }
  });

  const testRead = button("Test Translation", "secondary");
  testRead.addEventListener("click", async () => {
    testRead.disabled = true;
    status.textContent = "Testing model request...";
    try {
      await nativeApi.saveSettings(formState);
      const result = await nativeApi.translate({ direction: "read", text: "Hello, this is a translator test." });
      status.textContent = result.text;
    } catch (error) {
      status.textContent = publicError(error);
    } finally {
      testRead.disabled = false;
    }
  });

  actions.append(save, testRead, status);
  body.append(actions);
  panel.append(header, body);
  document.body.appendChild(panel);
}

function onMessageDoubleClick(event) {
  if (!settings || !settings.enabled || !settings.readTranslation.enabled) return;
  if (event.target.closest(`#${SETTINGS_PANEL_ID}, #${SEND_BOX_ID}, .dtm-translation-block`)) return;

  const message = findMessage(event.target);
  if (!message) return;

  const text = extractMessageText(message);
  if (!text) return;

  event.preventDefault();
  event.stopPropagation();

  translateMessage(message, text).catch(error => {
    renderTranslation(message, publicError(error), true);
  });
}

async function translateMessage(message, text) {
  const key = getMessageCacheKey(message, text);
  if (settings.readTranslation.cache && translationCache.has(key)) {
    renderTranslation(message, translationCache.get(key), false);
    return;
  }

  renderTranslation(message, "Translating...", false);
  const result = await nativeApi.translate({ direction: "read", text });
  translationCache.set(key, result.text);
  renderTranslation(message, result.text, false);
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

function extractMessageText(message) {
  const content = message.querySelector("[id^='message-content-'], [class*='messageContent'], [class*='markup']");
  return (content || message).textContent.trim();
}

function getMessageCacheKey(message, text) {
  const id = message.getAttribute("id") || message.getAttribute("data-list-item-id") || "";
  return `${id}:${settings.model.targetLanguage}:${hashText(text)}`;
}

function renderTranslation(message, text, isError) {
  const existing = message.querySelector(":scope > .dtm-translation-block");
  const block = existing || document.createElement("div");
  block.className = "dtm-translation-block";
  block.dataset.dtmError = isError ? "true" : "false";
  block.textContent = text;
  applyTranslationStyle(block);

  if (!existing) message.appendChild(block);
}

function restoreVisibleTranslations() {
  if (!settings || !settings.readTranslation.cache || translationCache.size === 0) return;
  const messages = Array.from(document.querySelectorAll("[id^='chat-messages-'], [data-list-item-id*='chat-messages']"));
  for (const message of messages) {
    if (message.querySelector(":scope > .dtm-translation-block")) continue;
    const text = extractMessageText(message);
    const key = getMessageCacheKey(message, text);
    if (translationCache.has(key)) renderTranslation(message, translationCache.get(key), false);
  }
}

function refreshTranslationStyles() {
  for (const block of document.querySelectorAll(".dtm-translation-block")) {
    applyTranslationStyle(block);
  }
}

function applyTranslationStyle(block) {
  const style = settings.style;
  block.style.background = style.backgroundColor;
  block.style.color = block.dataset.dtmError === "true" ? "#ffb3b8" : style.textColor;
  block.style.borderRadius = `${style.borderRadius}px`;
  block.style.fontFamily = style.fontFamily;
  block.style.fontSize = `${style.fontSize}px`;
  block.style.textDecorationLine = style.textDecoration === "none" ? "none" : "underline";
  block.style.textDecorationStyle = style.textDecoration === "wavy" ? "wavy" : "solid";
}

function ensureSendBox() {
  if (!settings || !settings.enabled || !settings.sendTranslation.enabled) {
    const existing = document.getElementById(SEND_BOX_ID);
    if (existing) existing.remove();
    return;
  }

  if (document.getElementById(SEND_BOX_ID)) return;

  const editor = findDiscordEditor();
  if (!editor) return;

  const mount = editor.closest("form") || editor.parentElement;
  if (!mount || !mount.parentElement) return;

  const box = document.createElement("div");
  box.id = SEND_BOX_ID;

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = `Translate to ${settings.model.sendLanguage} and send`;
  input.setAttribute("aria-label", "Translator send box");

  const status = document.createElement("span");
  status.textContent = "Enter to send";

  input.addEventListener("keydown", async event => {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;

    input.disabled = true;
    status.textContent = "Translating...";

    try {
      const result = await nativeApi.translate({ direction: "send", text });
      input.value = "";
      const currentEditor = findDiscordEditor();
      if (!currentEditor) throw new Error("Discord input box was not found.");
      currentEditor.focus();
      await wait(60);
      await nativeApi.insertAndSend(result.text);
      status.textContent = "Sent";
      setTimeout(() => { status.textContent = "Enter to send"; }, 1200);
    } catch (error) {
      status.textContent = publicError(error);
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  box.append(input, status);
  mount.parentElement.insertBefore(box, mount.nextSibling);
}

function findDiscordEditor() {
  return document.querySelector("[role='textbox'][contenteditable='true']");
}

function div(className) {
  const node = document.createElement("div");
  if (className) node.className = className;
  return node;
}

function button(label, variant) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = variant ? `dtm-button ${variant}` : "dtm-button";
  node.textContent = label;
  return node;
}

function section(title, children) {
  const wrapper = div("dtm-section");
  const heading = document.createElement("h3");
  heading.className = "dtm-section-title";
  heading.textContent = title;
  wrapper.appendChild(heading);
  for (const child of children) wrapper.appendChild(child);
  return wrapper;
}

function grid(children) {
  const wrapper = div("dtm-grid");
  for (const child of children) wrapper.appendChild(child);
  return wrapper;
}

function label(text) {
  const node = document.createElement("label");
  node.className = "dtm-label";
  node.textContent = text;
  return node;
}

function textField(name, value, onChange) {
  const wrapper = div("dtm-field");
  const input = document.createElement("input");
  input.className = "dtm-input";
  input.type = "text";
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  wrapper.append(label(name), input);
  return wrapper;
}

function passwordField(name, value, onChange, placeholder) {
  const wrapper = div("dtm-field");
  const input = document.createElement("input");
  input.className = "dtm-input";
  input.type = "password";
  input.value = value;
  input.placeholder = placeholder || "";
  input.addEventListener("input", () => onChange(input.value));
  wrapper.append(label(name), input);
  return wrapper;
}

function numberField(name, value, onChange, min, max) {
  const wrapper = div("dtm-field");
  const input = document.createElement("input");
  input.className = "dtm-input";
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener("input", () => onChange(Number(input.value)));
  wrapper.append(label(name), input);
  return wrapper;
}

function textareaField(name, value, onChange) {
  const wrapper = div("dtm-field full");
  const input = document.createElement("textarea");
  input.className = "dtm-textarea";
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  wrapper.append(label(name), input);
  return wrapper;
}

function selectField(name, value, options, onChange) {
  const wrapper = div("dtm-field");
  const input = document.createElement("select");
  input.className = "dtm-select";
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option;
    node.textContent = option;
    input.appendChild(node);
  }
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  wrapper.append(label(name), input);
  return wrapper;
}

function toggleRow(name, checked, onChange) {
  const wrapper = div("dtm-toggle-row");
  const title = document.createElement("span");
  title.textContent = name;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.append(title, input);
  return wrapper;
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function publicError(error) {
  const message = error && error.message ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  start
};
