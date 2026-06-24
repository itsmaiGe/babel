"use strict";

const { MODEL_PROVIDERS, TRANSLATION_STYLE_PRESETS } = requireShared("defaults");
const { normalizeSettings } = requireShared("settings");

const RUNTIME_FLAG = "__discordTranslatorModStarted";
const SETTINGS_BUTTON_ID = "dtm-settings-button";
const SETTINGS_PANEL_ID = "dtm-settings-panel";
const SEND_BOX_ID = "dtm-send-box";
const SETTINGS_LABEL = "Babel";
const SETTINGS_SECTION_ID_PREFIX = "dtm-settings-section-";
const API_KEY_MASK = "************";
const SETTINGS_SECTION_NAV = Object.freeze([
  { key: "model", label: "模型" },
  { key: "translation", label: "翻译设置" },
  { key: "style", label: "译文设置" }
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
  accountPanel: "panel__6131a",
  accountCategories: "categories__6131a",
  settingCard: "container__75920",
  stack: "stack_dbd263",
  settingStack: "stack_dbd263 baseSettingWrapper__32428",
  sectionHeading: "heading-xl/normal_cf4812 defaultColor__5345c",
  divider: "divider__1de9c divider__6131a"
});
const DISCORD_STACK_LAYOUTS = Object.freeze({
  headingOuter: {
    align: "center",
    justify: "start",
    direction: "horizontal",
    wrap: "false",
    fullWidth: "true",
    style: "gap: var(--space-24); padding-bottom: var(--space-lg);"
  },
  headingInner: {
    align: "stretch",
    justify: "start",
    direction: "vertical",
    wrap: "false",
    fullWidth: "true",
    style: "gap: var(--space-4); padding: var(--space-0);"
  },
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
let dismissedTranslations = new Set();
let domHooksInstalled = false;
let maintenanceScheduled = false;
let subnavScrollLock = 0;
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
  installDomHooks();
  loadSettingsSafe().then(runDomMaintenance);
}

function installDomHooks() {
  if (domHooksInstalled) return;
  domHooksInstalled = true;

  document.addEventListener("dblclick", onMessageDoubleClick, true);
  document.addEventListener("click", onDocumentClick, true);
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
  if (isSettingsViewOpen()) {
    ensureSettingsEntry();
  } else {
    restoreSettingsContent();
  }

  ensureSendBox();
  restoreVisibleTranslations();
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
    .dtm-translation-block {
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
      grid-template-columns: repeat(8, 28px);
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
  `;
  document.documentElement.appendChild(style);
}

function ensureSettingsEntry() {
  const sidebar = findSettingsSidebar();
  if (!sidebar) return;

  const languageItem = findSettingsSidebarItem(sidebar, [/^语言和时间$/, /^Language & Time$/i]);
  const template = languageItem || findSettingsSidebarItem(sidebar, [
    /^快捷键$/,
    /^Keybinds$/i,
    /^外观$/,
    /^Appearance$/i,
    /^语音和视频$/,
    /^Voice & Video$/i
  ]);
  const existing = document.getElementById(SETTINGS_BUTTON_ID);

  if (existing) {
    if (languageItem && existing.previousElementSibling === languageItem) {
      ensureSettingsSubnav(existing, sidebar);
      return;
    }
    removeSettingsEntrySubnav(existing);
    existing.remove();
  }

  if (!template) return;
  const entry = cloneSettingsSidebarItem(template);

  if (languageItem) {
    languageItem.insertAdjacentElement("afterend", entry);
    ensureSettingsSubnav(entry, sidebar);
    return;
  }

  const experienceHeader = findSettingsHeader(sidebar, [/^体验$/, /^Experience$/i, /^App Settings$/i]);
  if (experienceHeader) {
    experienceHeader.insertAdjacentElement("afterend", entry);
    ensureSettingsSubnav(entry, sidebar);
    return;
  }

  sidebar.appendChild(entry);
  ensureSettingsSubnav(entry, sidebar);
}

function cloneSettingsSidebarItem(template) {
  const entry = template.cloneNode(true);
  for (const node of entry.querySelectorAll("[id]")) node.removeAttribute("id");
  entry.id = SETTINGS_BUTTON_ID;
  entry.setAttribute("aria-label", `${SETTINGS_LABEL} 设置`);
  entry.setAttribute("data-dtm-settings-entry", "true");
  entry.removeAttribute("aria-current");
  entry.removeAttribute("aria-selected");
  entry.removeAttribute("href");
  if (entry.tagName === "BUTTON") entry.type = "button";
  if (entry.tagName !== "BUTTON") entry.setAttribute("role", "button");
  if (entry.tabIndex < 0) entry.tabIndex = 0;
  replaceSidebarItemText(entry, SETTINGS_LABEL);
  replaceSidebarItemIcon(entry);
  installSettingsEntryHandlers(entry);
  return entry;
}

function replaceSidebarItemIcon(entry) {
  // The entry is cloned from a native Discord row, so it carries that row's icon.
  // Swap the glyph for the Babel tower while keeping Discord's icon sizing/classes.
  const icon = entry.querySelector("svg");
  if (!icon) return;
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.5");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.innerHTML = BABEL_ICON_PATHS;
}

function ensureSettingsSubnav(entry, sidebar) {
  if (!entry || !sidebar) return;
  const existing = findSettingsEntrySubnav(entry);
  if (existing && existing.querySelector("[data-dtm-settings-subnav-list='true']")) {
    syncSettingsSubnavVisibility(entry);
    return;
  }
  if (existing) existing.remove();

  removeNestedSettingsSubnav(entry);
  const template = findSettingsSubnavTemplate(sidebar);
  if (!template) return;

  const subnav = template.cloneNode(true);
  subnav.dataset.dtmSettingsSubnav = "true";
  for (const node of [subnav, ...Array.from(subnav.querySelectorAll("[id]"))]) node.removeAttribute("id");

  const nativeParts = findSettingsSubnavParts(subnav);
  if (!nativeParts) return;

  const { list, items, allItems, stateSpecs } = nativeParts;
  list.dataset.dtmSettingsSubnavList = "true";
  configureSettingsSubnavItems(list, items, allItems, entry, stateSpecs);

  if (!entry.parentElement) return;
  entry.insertAdjacentElement("afterend", subnav);
  syncSettingsSubnavVisibility(entry);
}

function findSettingsSubnavParts(subnav) {
  const lists = Array.from(subnav.querySelectorAll("[role='list'], [class*='subnav'], [class*='list']"));
  for (const list of lists) {
    const items = Array.from(list.children).filter(isSettingsSubnavItem);
    if (items.length === 0) continue;
    return { list, items, allItems: items, stateSpecs: collectSettingsSubnavStateSpecs(items) };
  }
  return null;
}

function isSettingsSubnavItem(node) {
  if (!normalizeText(node.textContent)) return false;
  const role = node.getAttribute("role");
  return node.tagName === "A" ||
    node.tagName === "BUTTON" ||
    role === "listitem" ||
    role === "button" ||
    role === "link" ||
    node.tabIndex >= 0 ||
    String(node.className || "").split(/\s+/).some(name => /item/i.test(name));
}

function collectSettingsSubnavStateSpecs(items) {
  for (const item of items) {
    const specs = collectNodeStateSpecs(item);
    if (specs.length > 0) return specs;
  }
  return [];
}

function collectNodeStateSpecs(root) {
  const specs = [];
  const nodes = [root, ...Array.from(root.querySelectorAll("[class*='active'], [class*='selected'], [aria-current], [aria-selected]"))];
  for (const node of nodes) {
    const tokens = [];
    for (const name of String(node.className || "").split(/\s+/)) {
      if (/active|selected/i.test(name) && !tokens.includes(name)) tokens.push(name);
    }
    const attributes = {};
    for (const name of ["aria-current", "aria-selected"]) {
      const value = node.getAttribute(name);
      if (value != null) attributes[name] = value;
    }
    if (tokens.length === 0 && Object.keys(attributes).length === 0) continue;
    const path = getChildPath(root, node);
    if (path) specs.push({ path, tokens, attributes });
  }
  return specs;
}

function getChildPath(root, node) {
  const path = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) return null;
    const index = Array.from(parent.children).indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function findChildByPath(root, path) {
  let current = root;
  for (const index of path) {
    current = current && current.children ? current.children[index] : null;
    if (!current) return null;
  }
  return current;
}

function applySettingsSubnavState(item, stateSpecs) {
  for (const spec of stateSpecs || []) {
    const target = findChildByPath(item, spec.path);
    if (!target) continue;
    if (spec.tokens && spec.tokens.length > 0) target.classList.add(...spec.tokens);
    for (const [name, value] of Object.entries(spec.attributes || {})) target.setAttribute(name, value);
  }
}

function clearSettingsSubnavState(item) {
  removeStateClassTokens(item);
  item.removeAttribute("aria-current");
  item.removeAttribute("aria-selected");
  for (const node of item.querySelectorAll("[class*='active'], [class*='selected']")) {
    removeStateClassTokens(node);
  }
  for (const node of item.querySelectorAll("[aria-current], [aria-selected]")) {
    node.removeAttribute("aria-current");
    node.removeAttribute("aria-selected");
  }
}

function configureSettingsSubnavItems(list, nativeItems, allNativeItems, entry, stateSpecs) {
  const sections = SETTINGS_SECTION_NAV;
  const items = nativeItems.slice(0, sections.length);
  const template = items[0] || nativeItems[0];

  while (items.length < sections.length && template) {
    const clone = template.cloneNode(true);
    list.appendChild(clone);
    items.push(clone);
  }

  for (const item of allNativeItems) {
    if (!items.includes(item)) item.remove();
  }

  items.forEach((item, index) => configureSettingsSubnavItem(item, sections[index], entry, stateSpecs, index === 0));
  syncSettingsSubnavTrackLength(list, items);
}

function configureSettingsSubnavItem(item, section, entry, stateSpecs, selected) {
  removeSettingsSubnavItemState(item, entry);
  const action = findSettingsSubnavActionNode(item);
  item.dataset.dtmSubnavTarget = section.key;
  item.__dtmSubnavStateSpecs = stateSpecs;
  if (item.getAttribute("role") !== "listitem") item.setAttribute("role", "button");
  action.setAttribute("role", "button");
  item.removeAttribute("aria-expanded");
  item.removeAttribute("aria-current");
  item.removeAttribute("aria-selected");
  action.removeAttribute("aria-expanded");
  action.removeAttribute("aria-current");
  action.removeAttribute("aria-selected");
  action.removeAttribute("href");
  if (action.tagName === "BUTTON") action.type = "button";
  if (action.tabIndex < 0) action.tabIndex = 0;
  replaceSidebarItemText(item, section.label);
  installSettingsSubnavHandlers(item, section.key, entry);
  if (selected) markSettingsSubnavItemSelected(item, stateSpecs);
  return item;
}

function findSettingsSubnavActionNode(item) {
  if (item.getAttribute("role") === "listitem") {
    return item.querySelector("a, button, [role='button'], [role='link'], [tabindex], [class*='item']") || item;
  }
  return item;
}

function removeSettingsSubnavItemState(item, entry) {
  item.removeAttribute("id");
  item.removeAttribute("data-dtm-settings-entry");
  delete item.dataset.dtmSettingsEntry;
  delete item.dataset.dtmActiveTokens;
  const activeTokens = String(entry.dataset.dtmActiveTokens || "").split(/\s+/).filter(Boolean);
  item.classList.remove("dtm-settings-entry-active", ...activeTokens);
  removeStateClassTokens(item);
  for (const node of item.querySelectorAll("[id]")) node.removeAttribute("id");
  for (const node of item.querySelectorAll("[class*='active']")) {
    node.classList.remove("dtm-settings-entry-active", ...activeTokens);
    removeStateClassTokens(node);
  }
  for (const node of item.querySelectorAll("[class*='selected']")) {
    removeStateClassTokens(node);
  }
}

function removeStateClassTokens(node) {
  const kept = String(node.className || "").split(/\s+/).filter(name => {
    return name && !/active|selected/i.test(name);
  });
  node.className = kept.join(" ");
}

function findSettingsEntrySubnav(entry) {
  const sibling = entry && entry.nextElementSibling;
  return sibling && sibling.dataset.dtmSettingsSubnav === "true" ? sibling : null;
}

function removeNestedSettingsSubnav(entry) {
  if (!entry) return;
  for (const node of entry.querySelectorAll("[data-dtm-settings-subnav='true']")) node.remove();
}

function removeSettingsEntrySubnav(entry) {
  const subnav = findSettingsEntrySubnav(entry);
  if (subnav) subnav.remove();
  removeNestedSettingsSubnav(entry);
}

function syncSettingsSubnavVisibility(entry) {
  const open = Boolean(document.getElementById(SETTINGS_PANEL_ID) || entry.classList.contains("dtm-settings-entry-active"));
  setSettingsSubnavOpen(entry, open);
}

function setSettingsSubnavOpen(entry, open) {
  const subnav = findSettingsEntrySubnav(entry);
  if (!subnav) {
    entry.removeAttribute("aria-expanded");
    return;
  }

  entry.setAttribute("aria-expanded", open ? "true" : "false");
  subnav.hidden = !open;
  if (open) subnav.removeAttribute("aria-hidden");
  else subnav.setAttribute("aria-hidden", "true");
}

function findSettingsSubnavTemplate(sidebar) {
  if (!sidebar) return null;
  return Array.from(sidebar.querySelectorAll("[class*='subnavContainer']")).find(node => {
    return node.dataset.dtmSettingsSubnav !== "true" && !node.closest(`#${SETTINGS_BUTTON_ID}`) && normalizeText(node.textContent);
  }) || null;
}

function installSettingsSubnavHandlers(item, sectionKey, entry) {
  const activate = event => {
    event.preventDefault();
    event.stopPropagation();
    markSettingsEntryActive(entry);
    // Move the indicator straight to the clicked item (one native spring), and
    // hold off scroll-spy so it doesn't re-target the spring as the smooth scroll
    // passes the intermediate sections (that re-targeting is the stutter).
    setSettingsSubnavItemSelected(item);
    subnavScrollLock = Date.now() + 700;
    const scroll = () => scrollToSettingsSection(sectionKey, "smooth");
    if (document.getElementById(SETTINGS_PANEL_ID)) {
      scroll();
      return;
    }
    Promise.resolve(openSettingsPanel({ skipInitialScroll: true })).then(scroll);
  };

  item.addEventListener("click", activate);
  item.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    activate(event);
  });
}

function markSettingsSubnavItemSelected(item, stateSpecs = item.__dtmSubnavStateSpecs || []) {
  const action = findSettingsSubnavActionNode(item);
  applySettingsSubnavState(item, stateSpecs);
  action.setAttribute("aria-selected", "true");
  action.setAttribute("aria-current", "page");
  syncSettingsSubnavIndicator(item);
}

function clearSettingsSubnavItemSelected(item) {
  const action = findSettingsSubnavActionNode(item);
  clearSettingsSubnavState(item);
  item.removeAttribute("aria-selected");
  item.removeAttribute("aria-current");
  action.removeAttribute("aria-selected");
  action.removeAttribute("aria-current");
}

function setSettingsSubnavItemSelected(item, stateSpecs = item.__dtmSubnavStateSpecs || []) {
  const list = item.parentElement;
  if (list) {
    for (const sibling of Array.from(list.children)) clearSettingsSubnavItemSelected(sibling);
  }
  markSettingsSubnavItemSelected(item, stateSpecs);
}

function syncSettingsSubnavIndicator(item) {
  const list = item && item.parentElement;
  if (!list) return;
  const children = Array.from(list.children);
  const thumbAnchor = children.find(child => String(child.className || "").includes("thumbAnchor"));
  const track = children.find(child => String(child.className || "").includes("track"));
  const trackThumb = track && Array.from(track.children).find(child => String(child.className || "").includes("thumb"));
  const menuItems = Array.from(list.children).filter(child => child.dataset && child.dataset.dtmSubnavTarget);
  const index = menuItems.indexOf(item);
  if (index < 0) return;
  if (thumbAnchor && thumbAnchor.style) thumbAnchor.style.gridRow = String(index + 1);
  syncSettingsSubnavTrackThumb(trackThumb, thumbAnchor, item, menuItems[0]);
}

function syncSettingsSubnavTrackLength(list, menuItems) {
  const track = Array.from(list.children).find(child => String(child.className || "").includes("track"));
  if (!track || !track.style || menuItems.length === 0) return;
  track.style.gridRow = `1 / span ${menuItems.length}`;

  const firstRect = menuItems[0].getBoundingClientRect();
  const lastRect = menuItems[menuItems.length - 1].getBoundingClientRect();
  const top = Number.isFinite(firstRect.top) ? firstRect.top : firstRect.y;
  const lastTop = Number.isFinite(lastRect.top) ? lastRect.top : lastRect.y;
  const bottom = lastTop + lastRect.height;
  const height = bottom - top;
  if (Number.isFinite(height) && height > 0) track.style.height = formatCssPixel(height);
}

function syncSettingsSubnavToScroll(panel = document.getElementById(SETTINGS_PANEL_ID)) {
  if (!panel) return;
  // While a click-driven smooth scroll is in flight the indicator is already
  // springing to its target; don't re-target it from intermediate scroll positions.
  if (Date.now() < subnavScrollLock) return;
  const entry = document.getElementById(SETTINGS_BUTTON_ID);
  const subnav = entry && findSettingsEntrySubnav(entry);
  if (!subnav || subnav.hidden) return;
  const sectionKey = currentSettingsSectionKey(panel);
  if (!sectionKey) return;
  const item = Array.from(subnav.querySelectorAll("[role='listitem']"))
    .find(node => node.dataset.dtmSubnavTarget === sectionKey);
  if (!item) return;
  setSettingsSubnavItemSelected(item);
}

function currentSettingsSectionKey(panel) {
  const sections = SETTINGS_SECTION_NAV
    .map(spec => ({ key: spec.key, node: document.getElementById(settingsSectionId(spec.key)) }))
    .filter(section => section.node && typeof section.node.getBoundingClientRect === "function");
  if (sections.length === 0) return "";

  const mount = panel && panel.parentElement;

  // When the scroller is at (or near) the bottom, the last section is active even
  // though it can't push its top up to the reference line. Without this the
  // indicator never reaches the final item (译文设置).
  if (mount && Number.isFinite(mount.scrollTop) && Number.isFinite(mount.clientHeight) && Number.isFinite(mount.scrollHeight)
    && mount.scrollHeight > mount.clientHeight
    && mount.scrollTop + mount.clientHeight >= mount.scrollHeight - 4) {
    return sections[sections.length - 1].key;
  }

  const mountRect = mount && typeof mount.getBoundingClientRect === "function" ? mount.getBoundingClientRect() : null;
  const referenceY = mountRect && Number.isFinite(mountRect.y) && mountRect.height > 0
    ? mountRect.y + Math.min(180, mountRect.height * 0.35)
    : 180;

  let active = sections[0];
  for (const section of sections) {
    const rect = section.node.getBoundingClientRect();
    const top = Number.isFinite(rect.top) ? rect.top : rect.y;
    if (top <= referenceY) active = section;
    else break;
  }
  return active.key;
}

function syncSettingsSubnavTrackThumb(trackThumb, thumbAnchor, item, firstItem) {
  if (!trackThumb || !trackThumb.style || !thumbAnchor) return;
  if (requestMainWorldSubnavThumbSync(trackThumb)) return;
  const track = trackThumb.parentElement;
  if (!track || typeof track.getBoundingClientRect !== "function" || typeof thumbAnchor.getBoundingClientRect !== "function") return;
  let offset = thumbAnchor.getBoundingClientRect().y - track.getBoundingClientRect().y;
  if (Math.abs(offset) < 0.5 && item !== firstItem && item && firstItem) {
    offset = item.getBoundingClientRect().y - firstItem.getBoundingClientRect().y;
  }
  if (!Number.isFinite(offset)) return;
  trackThumb.style.transform = Math.abs(offset) < 0.5 ? "none" : `translate3d(0px, ${formatCssPixel(offset)}, 0px)`;
}

function formatCssPixel(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function requestMainWorldSubnavThumbSync(trackThumb) {
  let id = trackThumb.dataset.dtmSubnavThumbId;
  if (!id) {
    nativeControlId += 1;
    id = `dtm-subnav-thumb-${nativeControlId}`;
    trackThumb.dataset.dtmSubnavThumbId = id;
  }

  const detail = { id };
  return sendMainWorldMessage("dtm:sync-subnav-thumb", detail);
}

function installSettingsEntryHandlers(entry) {
  entry.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    markSettingsEntryActive(entry);
    openSettingsPanel();
  });

  entry.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    markSettingsEntryActive(entry);
    openSettingsPanel();
  });
}

function markSettingsEntryActive(entry) {
  subnavScrollLock = 0;
  const sidebar = findSettingsSidebar();
  const activeTokens = sidebar ? findActiveSidebarClassTokens(sidebar) : [];

  if (sidebar && activeTokens.length > 0) {
    for (const node of sidebar.querySelectorAll("[class*='active']")) {
      if (!entry.contains(node)) node.classList.remove(...activeTokens);
    }
  }

  entry.classList.add("dtm-settings-entry-active");
  const innerItem = entry.querySelector("[class*='item_'], [class*='item-']") || entry;
  if (activeTokens.length > 0) {
    innerItem.classList.add(...activeTokens);
    entry.dataset.dtmActiveTokens = activeTokens.join(" ");
  }
  syncSettingsSubnavVisibility(entry);
}

function clearSettingsEntryActive() {
  const entry = document.getElementById(SETTINGS_BUTTON_ID);
  if (!entry) return;

  entry.classList.remove("dtm-settings-entry-active");
  const activeTokens = String(entry.dataset.dtmActiveTokens || "").split(/\s+/).filter(Boolean);

  if (activeTokens.length > 0) {
    entry.classList.remove(...activeTokens);
    for (const node of entry.querySelectorAll("[class*='active']")) {
      node.classList.remove(...activeTokens);
    }
    delete entry.dataset.dtmActiveTokens;
  }
  syncSettingsSubnavVisibility(entry);
}

function findActiveSidebarClassTokens(sidebar) {
  const active = Array.from(sidebar.querySelectorAll("[class*='active']")).find(node => {
    const box = node.getBoundingClientRect();
    return box.width >= 80 && box.height >= 18 && box.height <= 72;
  });
  return active ? Array.from(active.classList).filter(name => name.includes("active")) : [];
}

function replaceSidebarItemText(entry, text) {
  const textTarget = Array.from(entry.querySelectorAll("span, div")).find(node => {
    return normalizeText(node.textContent) && node.children.length === 0;
  });

  if (textTarget) textTarget.textContent = text;
  else entry.textContent = text;
}

function findSettingsSidebar() {
  const rootSidebar = findSettingsSidebarRoot();
  if (rootSidebar) return rootSidebar;

  const candidates = Array.from(document.querySelectorAll("nav, [role='navigation'], [role='tablist'], [class*='sidebar'], [class*='side']"));
  return candidates.find(node => {
    const box = node.getBoundingClientRect();
    if (box.width < 120 || box.width > 420 || box.height < 260) return false;
    const text = node.textContent || "";
    return /My Account|Profiles|Privacy|Appearance|Voice|Keybinds|Notifications|账户|账号|个人资料|隐私|外观|语音|通知/.test(text);
  }) || null;
}

function findSettingsSidebarRoot() {
  const candidates = Array.from(document.querySelectorAll("aside[class*='sidebar'], [class*='standardSidebarView'] aside, [class*='layer'] aside[class*='sidebar']"));

  return candidates.find(node => {
    const box = node.getBoundingClientRect();
    if (box.width < 120 || box.width > 420 || box.height < 260) return false;

    const hiddenLabel = normalizeText(node.querySelector("[class*='hiddenVisually']")?.textContent);
    if (/^Settings sidebar$/i.test(hiddenLabel)) return true;

    const text = node.textContent || "";
    return /My Account|Profiles|Privacy|Appearance|Voice|Keybinds|Notifications|账户|账号|个人资料|隐私|外观|语音|通知/.test(text);
  }) || null;
}

function findSettingsSidebarItem(sidebar, patterns) {
  const sidebarBox = sidebar.getBoundingClientRect();
  const candidates = Array.from(sidebar.querySelectorAll("button, [role='button'], [role='tab'], [tabindex], a, [class*='item']"));

  return candidates.find(node => {
    const box = node.getBoundingClientRect();
    if (box.width < 80 || box.height < 18 || box.height > 72) return false;
    if (box.x < sidebarBox.x - 8 || box.right > sidebarBox.right + 8) return false;
    const text = normalizeText(node.textContent);
    return patterns.some(pattern => pattern.test(text));
  }) || null;
}

function findSettingsHeader(sidebar, patterns) {
  const sidebarBox = sidebar.getBoundingClientRect();
  const candidates = Array.from(sidebar.querySelectorAll("*"));

  return candidates.find(node => {
    const box = node.getBoundingClientRect();
    if (box.width < 40 || box.height < 10 || box.height > 52) return false;
    if (box.x < sidebarBox.x - 8 || box.right > sidebarBox.right + 8) return false;
    const text = normalizeText(node.textContent);
    return patterns.some(pattern => pattern.test(text));
  }) || null;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function settingsSectionId(sectionKey) {
  return `${SETTINGS_SECTION_ID_PREFIX}${sectionKey}`;
}

function scrollToSettingsSection(sectionKey, behavior = "auto") {
  const target = document.getElementById(settingsSectionId(sectionKey));
  if (target) target.scrollIntoView({ block: "start", behavior });
}

function isSettingsViewOpen() {
  if (document.getElementById(SETTINGS_BUTTON_ID) || document.getElementById(SETTINGS_PANEL_ID)) return true;
  return Boolean(findSettingsSidebarRoot());
}

function onDocumentClick(event) {
  const panel = document.getElementById(SETTINGS_PANEL_ID);
  if (!panel) return;

  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(`#${SETTINGS_PANEL_ID}, #${SETTINGS_BUTTON_ID}, [data-dtm-settings-subnav='true']`)) return;
  const sidebar = findSettingsSidebar();
  if (sidebar && sidebar.contains(target)) {
    closeSettingsPanel();
    return;
  }
  if (target.closest("button, [role='button'], [role='tab'], a")) closeSettingsPanel();
}

async function openSettingsPanel(options = {}) {
  await loadSettingsSafe();

  const existing = document.getElementById(SETTINGS_PANEL_ID);
  if (existing) existing.remove();
  restoreSettingsContent();

  const panel = document.createElement("section");
  panel.id = SETTINGS_PANEL_ID;
  panel.className = DISCORD_UI.accountPanel;

  const body = div(DISCORD_UI.accountCategories);
  const formState = JSON.parse(JSON.stringify(settings));
  const preview = translationStylePreview(formState.style);
  const updateStylePreview = () => refreshStylePreview(preview, formState.style);
  const fetchedModelOptions = new Map();
  const providerSelectHost = div();
  const baseUrlFieldHost = div();
  const modelFieldHost = div();
  const apiKeyFieldHost = div();
  let modelComboBoxHost = null;

  const save = button("保存", "primary");
  const openConfig = button("打开配置文件夹", "secondary");
  const refreshModels = button("刷新模型", "secondary");
  const testConnection = button("测试连接", "secondary");
  let refreshModelsInFlight = false;
  let testConnectionInFlight = false;
  if (nativeError) showNativeToast(nativeError, "failure");

  function currentSettingsRequest() {
    const request = { settings: formState };
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
    try {
      const result = await nativeApi.listModels(currentSettingsRequest());
      const models = Array.isArray(result && result.models) ? result.models : [];
      if (models.length === 0) throw new Error("没有可用模型。");
      const provider = providerById(formState.model.provider);
      fetchedModelOptions.set(modelCacheKey(provider), models);
      if (!models.some(model => model.value === formState.model.modelId)) {
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

  body.append(
    section("模型", [
      providerSelectHost,
      baseUrlFieldHost,
      modelFieldHost,
      apiKeyFieldHost,
      buttonRow([refreshModels, testConnection])
    ], "model"),
    section("翻译设置", [
      toggleRow("启用插件", formState.enabled, value => { formState.enabled = value; }),
      toggleRow("启用发送翻译输入框", formState.sendTranslation.enabled, value => { formState.sendTranslation.enabled = value; }),
      languageSelectField("阅读目标语言", formState.model.targetLanguage, value => { formState.model.targetLanguage = value; }),
      languageSelectField("发送目标语言", formState.model.sendLanguage, value => { formState.model.sendLanguage = value; }),
      selectField("翻译风格", formState.translationStyle, TRANSLATION_STYLE_OPTIONS, value => { formState.translationStyle = value; })
    ], "translation")
  );

  body.append(section("译文设置", [
    preview,
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

  openConfig.addEventListener("click", async () => {
    try {
      await nativeApi.openSettingsFile();
    } catch (error) {
      console.error("[Babel] Failed to open settings directory:", error);
    }
  });

  save.addEventListener("click", async () => {
    if (save.disabled) return;
    // Saving is instant local I/O: no spinner, no progress/success toast. Only a
    // double-submit guard, and a toast if it actually fails.
    save.disabled = true;
    try {
      const apiKey = apiKeyValueForRequest(formState.__apiKey);
      delete formState.__apiKey;
      settings = await nativeApi.saveSettings(formState);
      if (apiKey) await nativeApi.setApiKey({ provider: formState.model.provider, apiKey });
      providerApiKeyStatus = typeof nativeApi.getApiKeyStatus === "function"
        ? await nativeApi.getApiKeyStatus()
        : providerApiKeyStatus;
      renderProviderSelect();
      renderApiKeyField();
      ensureSendBox();
      refreshTranslationStyles();
      save.flashLabel("已保存");
    } catch (error) {
      showNativeToast(publicError(error), "failure");
    } finally {
      save.disabled = false;
    }
  });

  const saveRow = settingRow(buttonRow([openConfig, save]));
  saveRow.id = settingsSectionId("save");
  body.append(saveRow, aboutFooter());
  panel.append(body);
  mountSettingsPanel(panel, { skipInitialScroll: Boolean(options.skipInitialScroll) });
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
  meta.appendChild(document.createTextNode("作者 麦格 · "));
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
  return wrap;
}

function closeSettingsPanel() {
  const existing = document.getElementById(SETTINGS_PANEL_ID);
  if (existing) existing.remove();
  clearSettingsEntryActive();
  restoreSettingsContent();
}

function mountSettingsPanel(panel, options = {}) {
  const settingsContent = findSettingsContent();
  if (settingsContent) {
    const mount = findSettingsPanelMount(settingsContent);
    updateSettingsHeaderTitle(settingsContent);
    // Hide the native settings content before inserting our panel so the two are
    // never both visible for a frame (that swap is the flicker on open).
    hideSettingsContentSiblings(mount, panel);
    mount.prepend(panel);
    installSettingsSectionScrollSpy(panel, mount);
    if (!options.skipInitialScroll) panel.scrollIntoView({ block: "start", behavior: "auto" });
  } else {
    document.body.appendChild(panel);
    installSettingsSectionScrollSpy(panel, null);
  }
}

function installSettingsSectionScrollSpy(panel, scrollRoot) {
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    if (!document.getElementById(SETTINGS_PANEL_ID)) return;
    syncSettingsSubnavToScroll(panel);
  };
  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    const schedule = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : callback => callback();
    schedule(sync);
  };
  const target = scrollRoot && typeof scrollRoot.addEventListener === "function"
    ? scrollRoot
    : typeof window !== "undefined" ? window : null;
  if (target && typeof target.addEventListener === "function") target.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function findSettingsPanelMount(settingsContent) {
  const contentBody = hasClassPart(settingsContent, "contentBody")
    ? settingsContent
    : settingsContent.querySelector("[class*='contentBody']");
  const root = contentBody || settingsContent;
  const scrollers = Array.from(root.querySelectorAll("[class*='scroller']"));

  return scrollers.find(node => {
    const box = node.getBoundingClientRect();
    return box.width >= 320 && box.height >= 260;
  }) || root;
}

function hideSettingsContentSiblings(container, panel) {
  for (const child of Array.from(container.children)) {
    if (child === panel) continue;
    if (child.dataset.dtmHidden === "true") continue;
    child.dataset.dtmHidden = "true";
    child.dataset.dtmPreviousDisplay = child.style.display || "";
    child.setAttribute("aria-hidden", "true");
    child.style.display = "none";
  }
}

function restoreSettingsContent() {
  restoreSettingsHeaderTitle();

  for (const node of document.querySelectorAll("[data-dtm-hidden='true']")) {
    node.style.display = node.dataset.dtmPreviousDisplay || "";
    delete node.dataset.dtmHidden;
    delete node.dataset.dtmPreviousDisplay;
    node.removeAttribute("aria-hidden");
  }
}

function updateSettingsHeaderTitle(settingsContent) {
  const header = settingsContent.querySelector("[class*='contentHeader']");
  if (!header) return;

  const title = Array.from(header.querySelectorAll("h1, h2, h3, div, span")).find(node => {
    if (node.closest("button, [role='button'], a")) return false;
    if (node.children.length > 0) return false;
    return Boolean(normalizeText(node.textContent));
  });
  if (!title) return;

  if (title.dataset.dtmPreviousText === undefined) {
    title.dataset.dtmPreviousText = title.textContent;
  }
  title.dataset.dtmHeaderTitle = "true";
  title.textContent = SETTINGS_LABEL;
}

function restoreSettingsHeaderTitle() {
  for (const node of document.querySelectorAll("[data-dtm-header-title='true']")) {
    node.textContent = node.dataset.dtmPreviousText || "";
    delete node.dataset.dtmHeaderTitle;
    delete node.dataset.dtmPreviousText;
  }
}

function findSettingsContent() {
  const sidebar = findSettingsSidebar();
  if (!sidebar) return null;

  const sidebarBox = sidebar.getBoundingClientRect();
  const root = sidebar.closest("[role='dialog'], [class*='modalContent'], [class*='standardSidebarView'], [class*='layer']") || document.body;
  const candidates = Array.from(root.querySelectorAll("main, section, div, [role='main'], [role='tabpanel']"));
  const matches = candidates.filter(node => {
    if (node === sidebar || node.contains(sidebar)) return false;
    const box = node.getBoundingClientRect();
    return box.x >= sidebarBox.right - 2 && box.width >= 320 && box.height >= 260;
  });

  matches.sort((a, b) => {
    const aBox = a.getBoundingClientRect();
    const bBox = b.getBoundingClientRect();
    const aGap = Math.abs(aBox.x - sidebarBox.right);
    const bGap = Math.abs(bBox.x - sidebarBox.right);
    if (aGap !== bGap) return aGap - bGap;
    return bBox.height - aBox.height;
  });

  return matches[0] || null;
}

function hasClassPart(node, part) {
  return String(node?.className || "").includes(part);
}

function onMessageDoubleClick(event) {
  if (!settings || !settings.enabled) return;
  if (event.target.closest(`#${SETTINGS_PANEL_ID}, #${SEND_BOX_ID}, .dtm-translation-block`)) return;

  const message = findMessage(event.target);
  if (!message) return;

  const existingTranslation = findTranslationBlock(message);
  if (existingTranslation) {
    event.preventDefault();
    event.stopPropagation();
    existingTranslation.remove();
    // Remember the dismissal so periodic restore from cache doesn't bring it back.
    dismissedTranslations.add(getMessageId(message));
    return;
  }

  const text = extractMessageText(message);
  if (!text) return;

  event.preventDefault();
  event.stopPropagation();

  dismissedTranslations.delete(getMessageId(message));
  translateMessage(message, text).catch(error => {
    renderTranslation(message, publicError(error), true);
  });
}

async function translateMessage(message, text) {
  const key = getMessageCacheKey(message, text);
  if (settings.readTranslation.cache && translationCache.has(key)) {
    renderTranslation(message, translationCache.get(key), { cacheHit: true });
    return;
  }

  const placeholder = renderTranslation(message, "正在翻译...", { cacheHit: false });
  const result = await nativeApi.translate({ direction: "read", text });
  cacheTranslation(key, result.text);
  // If the user dismissed the in-progress block while we waited, don't resurrect it.
  if (placeholder && !placeholder.parentElement) return;
  renderTranslation(message, result.text, { cacheHit: false });
}

function cacheTranslation(key, text) {
  translationCache.delete(key);
  translationCache.set(key, text);
  while (translationCache.size > MAX_TRANSLATION_CACHE) {
    const oldest = translationCache.keys().next().value;
    if (oldest === undefined) break;
    translationCache.delete(oldest);
  }
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

function getMessageId(message) {
  return message.getAttribute("id") || message.getAttribute("data-list-item-id") || "";
}

function getMessageCacheKey(message, text) {
  return `${getMessageId(message)}:${settings.model.provider}:${settings.model.modelId}:${settings.model.targetLanguage}:${settings.translationStyle}:${hashText(text)}`;
}

function findTranslationBlock(message) {
  if (!message) return null;
  for (const child of Array.from(message.children || [])) {
    if (child.classList && child.classList.contains("dtm-translation-block")) return child;
    if (String(child.className || "").split(/\s+/).includes("dtm-translation-block")) return child;
  }
  return null;
}

function renderTranslation(message, text, options = {}) {
  const isError = Boolean(options === true || options.isError);
  const existing = findTranslationBlock(message);
  const block = existing || document.createElement("div");
  block.className = "dtm-translation-block";
  block.dataset.dtmError = isError ? "true" : "false";
  block.dataset.dtmCacheHit = options.cacheHit ? "true" : "false";
  block.textContent = text;
  applyTranslationStyle(block);

  if (!existing) message.appendChild(block);
  return block;
}

function restoreVisibleTranslations() {
  if (!settings || !settings.readTranslation.cache || translationCache.size === 0) return;
  const messages = Array.from(document.querySelectorAll("[id^='chat-messages-'], [data-list-item-id*='chat-messages']"));
  for (const message of messages) {
    if (findTranslationBlock(message)) continue;
    if (dismissedTranslations.has(getMessageId(message))) continue;
    const text = extractMessageText(message);
    const key = getMessageCacheKey(message, text);
    if (translationCache.has(key)) renderTranslation(message, translationCache.get(key), { cacheHit: true });
  }
}

function refreshTranslationStyles() {
  for (const block of document.querySelectorAll(".dtm-translation-block")) {
    applyTranslationStyle(block);
  }
}

function applyTranslationStyle(block) {
  applyTranslationStyleObject(block, settings.style, block.dataset.dtmError === "true");
}

function applyTranslationStyleObject(block, style, isError) {
  Object.assign(block.style, translationPreviewStyle(style, isError));
}

const STYLE_MARKER_BAND = "linear-gradient(transparent 54%, color-mix(in srgb, currentColor 24%, transparent) 54%, color-mix(in srgb, currentColor 24%, transparent) 92%, transparent 92%)";

function translationPreviewStyle(style, isError) {
  const emphasis = style.emphasis || "none";
  const backgroundOn = style.background !== false;
  return {
    backgroundColor: backgroundOn ? style.backgroundColor : "transparent",
    backgroundImage: emphasis === "marker" ? STYLE_MARKER_BAND : "none",
    color: isError ? "#ffb3b8" : style.textColor,
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
  // the composer to detect the active view and compute the default position.
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
  input.placeholder = `翻译成${settings.model.sendLanguage}并发送`;
  input.setAttribute("aria-label", "翻译发送输入框");

  const status = document.createElement("span");
  status.textContent = enterHint();

  input.addEventListener("keydown", async event => {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;

    input.disabled = true;
    status.textContent = "正在翻译...";

    try {
      const result = await nativeApi.translate({ direction: "send", text });
      input.value = "";
      const currentEditor = findDiscordEditor();
      if (!currentEditor) throw new Error("Discord input box was not found.");
      currentEditor.focus();
      await wait(60);
      const outcome = await nativeApi.insertAndSend(result.text);
      status.textContent = outcome && outcome.sent === false ? "已填入输入框" : "已发送";
      setTimeout(() => { status.textContent = enterHint(); }, 1200);
    } catch (error) {
      status.textContent = publicError(error);
    } finally {
      input.disabled = false;
      input.focus();
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

function clearChildren(node) {
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
      style: currentStyle
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

function section(title, children, sectionKey) {
  const wrapper = div(DISCORD_UI.settingCard);
  wrapper.dataset.dtmNativeSection = "true";
  if (sectionKey) {
    wrapper.id = settingsSectionId(sectionKey);
    wrapper.dataset.dtmSectionKey = sectionKey;
  }

  const headingOuter = stack("headingOuter");
  const headingInner = stack("headingInner");
  const heading = document.createElement("h2");
  heading.className = DISCORD_UI.sectionHeading;
  heading.textContent = title;
  headingInner.appendChild(heading);
  headingOuter.appendChild(headingInner);

  const divider = div(DISCORD_UI.divider);
  const rows = stack("rows");
  for (const child of children) rows.appendChild(settingRow(child));

  wrapper.append(headingOuter, rows, divider);
  return wrapper;
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
    buttonNode.style.background = option.value;
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

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return String(hash);
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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  translationCache = new Map();
  dismissedTranslations = new Set();
}

function resetRuntimeForTests() {
  if (!originalTestRuntime) return;
  nativeApi = originalTestRuntime.nativeApi;
  settings = originalTestRuntime.settings;
  providerApiKeyStatus = originalTestRuntime.providerApiKeyStatus;
  nativeError = originalTestRuntime.nativeError;
  translationCache = originalTestRuntime.translationCache;
  originalTestRuntime = null;
}

module.exports.__test = {
  SETTINGS_BUTTON_ID,
  SETTINGS_PANEL_ID,
  SETTINGS_LABEL,
  apiKeyPlaceholder,
  apiKeyValueForRequest,
  button,
  ensureSendBox,
  ensureSettingsEntry,
  inputField,
  injectBaseStyles,
  languageSelectField,
  markSettingsEntryActive,
  modelComboBoxHostFor,
  mountSettingsPanel,
  onDocumentClick,
  onMessageDoubleClick,
  publicError,
  providerOptionsWithStatus,
  clearSettingsEntryActive,
  restoreSettingsContent,
  resetRuntimeForTests,
  runDomMaintenance,
  section,
  setRuntimeForTests,
  showNativeToast,
  syncSettingsSubnavToScroll,
  translateMessage,
  translationPreviewStyle,
  toggleRow
};
/* @dtm-test-only:end */
