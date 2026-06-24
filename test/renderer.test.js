"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { __test } = require("../src/mod/renderer");

test("clicking another Discord settings item closes the mod panel and restores Discord content", () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  const sidebar = new FakeElement("aside", "", rect(0, 0, 260, 800));
  sidebar.className = "sidebar__409aa";
  const otherItem = settingsRow("外观", 420);
  const modEntry = settingsRow(__test.SETTINGS_LABEL, 462);
  modEntry.id = __test.SETTINGS_BUTTON_ID;
  sidebar.append(otherItem, modEntry);

  const panel = new FakeElement("section", "", rect(300, 40, 700, 700));
  panel.id = "dtm-settings-panel";
  const discordContent = new FakeElement("div", "Discord original settings", rect(300, 40, 700, 700));
  discordContent.dataset.dtmHidden = "true";
  discordContent.dataset.dtmPreviousDisplay = "";
  discordContent.style.display = "none";

  document.append(sidebar, panel, discordContent);

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.onDocumentClick({ target: otherItem });

    assert.equal(document.getElementById("dtm-settings-panel"), null);
    assert.equal(discordContent.dataset.dtmHidden, undefined);
    assert.equal(discordContent.style.display, "");
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("runDomMaintenance skips settings sidebar scans outside Discord settings", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();
  const channelSidebar = new FakeElement("aside", "general random channel", rect(0, 0, 260, 800));
  channelSidebar.className = "sidebar__channel";
  document.appendChild(channelSidebar);

  try {
    global.document = document;
    __test.runDomMaintenance();

    assert.equal(document.getElementById(__test.SETTINGS_BUTTON_ID), null);
    assert.equal(document.querySelectorAllCalls.includes("nav, [role='navigation'], [role='tablist'], [class*='sidebar'], [class*='side']"), false);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("ensureSettingsEntry inserts the settings item inside Discord's Experience section", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();
  const sidebar = new FakeElement("aside", "", rect(0, 0, 260, 800));
  sidebar.className = "sidebar__409aa";

  const voice = settingsRow("语音和视频", 420);
  const appearance = settingsRow("外观", 462);
  const accessibility = settingsRow("可访问性", 504);
  const keybinds = settingsRow("快捷键", 546);
  const language = settingsRow("语言和时间", 588);
  const activity = settingsRow("动态", 630);
  const status = settingsRow("当前状态", 672);

  sidebar.append(
    settingsHeader("体验", 380),
    voice,
    appearance,
    accessibility,
    keybinds,
    language,
    activity,
    status
  );
  document.appendChild(sidebar);

  try {
    global.document = document;
    __test.ensureSettingsEntry();

    const entry = document.getElementById(__test.SETTINGS_BUTTON_ID);
    assert.ok(entry);
    assert.equal(entry.textContent, __test.SETTINGS_LABEL);
    assert.equal(entry.className, language.className);
    assert.equal(entry.previousElementSibling, language);
    assert.equal(entry.nextElementSibling, activity);
    assert.notEqual(sidebar.children[sidebar.children.length - 1], entry);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings subnav stays hidden as a sibling until the mod settings entry is active", () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  const sidebar = new FakeElement("aside", "", rect(0, 0, 260, 800));
  sidebar.className = "sidebar__409aa";

  const appearance = settingsRow("外观", 420);
  const language = settingsRow("语言和时间", 462);
  const nativeSubnav = settingsSubnavTemplate("原生二级菜单", 504);
  const activity = settingsRow("动态", 630);

  sidebar.append(settingsHeader("体验", 380), appearance, language, nativeSubnav, activity);
  document.appendChild(sidebar);

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.ensureSettingsEntry();

    const entry = document.getElementById(__test.SETTINGS_BUTTON_ID);
    const subnav = entry.nextElementSibling;

    assert.ok(subnav);
    assert.equal(subnav.dataset.dtmSettingsSubnav, "true");
    assert.equal(entry.children.includes(subnav), false);
    assert.equal(subnav.hidden, true);
    assert.equal(subnav.getAttribute("aria-hidden"), "true");
    assert.equal(entry.getAttribute("aria-expanded"), "false");

    const list = subnav.querySelector("[data-dtm-settings-subnav-list='true']");
    assert.ok(list);
    assert.equal(list.getAttribute("role"), "list");
    const thumb = list.children.find(item => String(item.className).includes("thumbAnchor"));
    const track = list.children.find(item => String(item.className).includes("track"));
    const trackThumb = track.querySelector("[class*='thumb']");
    const menuItems = list.children.filter(item => item.dataset.dtmSubnavTarget);
    assert.ok(thumb);
    assert.ok(trackThumb);
    assert.deepEqual(menuItems.map(item => item.dataset.dtmSubnavTarget), ["model", "translation", "style"]);
    assert.deepEqual(menuItems.map(item => item.textContent), ["模型", "翻译设置", "译文设置"]);
    assert.equal(track.style.gridRow, "1 / span 3");
    assert.equal(track.style.height, "92px");
    assert.equal(subnav.textContent.includes("原生二级菜单"), false);
    assert.equal(subnav.textContent.includes("密码和安全中心"), false);
    assert.ok(menuItems.every(item => item.getAttribute("role") === "listitem"));
    assert.ok(menuItems.every(item => item.children.length > 0));
    assert.ok(menuItems.every(item => item.getBoundingClientRect().height >= 18));
    assert.ok(menuItems[1].getBoundingClientRect().y - menuItems[0].getBoundingClientRect().y >= 30);
    assert.ok(menuItems.every(item => !item.querySelector("[class*='icon']")));
    assert.ok(menuItems[0].querySelector("[class*='item']"));
    assert.equal(menuItems[0].querySelector("[class*='item']").getAttribute("role"), "button");
    assert.ok(menuItems[0].querySelector("[class*='active']"));
    assert.equal(menuItems[0].querySelector("[class*='item']").getAttribute("aria-current"), "page");
    assert.equal(menuItems[1].querySelector("[class*='active']"), null);
    assert.equal(thumb.style.gridRow, "1");
    assert.equal(trackThumb.style.transform, "none");

    __test.markSettingsEntryActive(entry);
    assert.equal(subnav.hidden, false);
    assert.equal(subnav.getAttribute("aria-hidden"), null);
    assert.equal(entry.getAttribute("aria-expanded"), "true");

    const panel = new FakeElement("section");
    panel.id = __test.SETTINGS_PANEL_ID;
    const styleSection = new FakeElement("section");
    styleSection.id = "dtm-settings-section-style";
    document.append(panel, styleSection);
    __test.onDocumentClick({ target: menuItems[2] });
    assert.equal(document.getElementById(__test.SETTINGS_PANEL_ID), panel);
    menuItems[2].listeners.get("click")({ preventDefault() {}, stopPropagation() {} });
    // Clicking moves the indicator straight to the target (no scroll-spy stutter).
    assert.equal(menuItems[0].querySelector("[class*='active']"), null);
    assert.ok(menuItems[2].querySelector("[class*='active']"));
    assert.equal(thumb.style.gridRow, "3");
    assert.equal(trackThumb.style.transform, "translate3d(0px, 72px, 0px)");
    assert.equal(styleSection.scrollIntoViewOptions.behavior, "smooth");
    panel.remove();
    styleSection.remove();

    __test.clearSettingsEntryActive();
    assert.equal(subnav.hidden, true);
    assert.equal(subnav.getAttribute("aria-hidden"), "true");
    assert.equal(entry.getAttribute("aria-expanded"), "false");
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("settings subnav indicator follows the visible settings section while scrolling", () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  const sidebar = new FakeElement("aside", "", rect(0, 0, 260, 800));
  sidebar.className = "sidebar__409aa";

  const appearance = settingsRow("外观", 420);
  const language = settingsRow("语言和时间", 462);
  const nativeSubnav = settingsSubnavTemplate("原生二级菜单", 504);
  const activity = settingsRow("动态", 630);
  sidebar.append(settingsHeader("体验", 380), appearance, language, nativeSubnav, activity);

  const panel = new FakeElement("section", "", rect(280, 80, 760, 700));
  panel.id = __test.SETTINGS_PANEL_ID;
  const model = new FakeElement("section", "", rect(280, -120, 760, 220));
  model.id = "dtm-settings-section-model";
  const translation = new FakeElement("section", "", rect(280, 80, 760, 220));
  translation.id = "dtm-settings-section-translation";
  const style = new FakeElement("section", "", rect(280, 260, 760, 220));
  style.id = "dtm-settings-section-style";
  panel.append(model, translation, style);
  document.append(sidebar, panel);

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.ensureSettingsEntry();

    const entry = document.getElementById(__test.SETTINGS_BUTTON_ID);
    __test.markSettingsEntryActive(entry);
    const subnav = entry.nextElementSibling;
    const list = subnav.querySelector("[data-dtm-settings-subnav-list='true']");
    const thumb = list.children.find(item => String(item.className).includes("thumbAnchor"));
    const track = list.children.find(item => String(item.className).includes("track"));
    const trackThumb = track.querySelector("[class*='thumb']");
    const menuItems = list.children.filter(item => item.dataset.dtmSubnavTarget);

    __test.syncSettingsSubnavToScroll(panel);
    assert.ok(menuItems[1].querySelector("[class*='active']"));
    assert.equal(thumb.style.gridRow, "2");
    assert.equal(trackThumb.style.transform, "translate3d(0px, 36px, 0px)");

    style.box.y = 100;
    __test.syncSettingsSubnavToScroll(panel);
    assert.equal(menuItems[1].querySelector("[class*='active']"), null);
    assert.ok(menuItems[2].querySelector("[class*='active']"));
    assert.equal(thumb.style.gridRow, "3");
    assert.equal(trackThumb.style.transform, "translate3d(0px, 72px, 0px)");
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("mountSettingsPanel keeps Discord settings chrome and replaces only the scroll body content", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();

  const root = new FakeElement("div", "", rect(0, 0, 1200, 800));
  root.className = "standardSidebarView";
  const sidebar = new FakeElement("aside", "", rect(0, 0, 260, 800));
  sidebar.className = "sidebar__409aa";
  sidebar.append(settingsRow("外观", 300), settingsRow("语言和时间", 340));

  const content = new FakeElement("div", "", rect(260, 0, 940, 800));
  content.className = "content_e9e3ed";
  const header = new FakeElement("div", "", rect(260, 0, 940, 50));
  header.className = "contentHeader_e9e3ed";
  const title = new FakeElement("div", "账户", rect(280, 12, 80, 24));
  title.className = "contentTitle_e9e3ed";
  const close = new FakeElement("button", "", rect(1160, 8, 32, 32));
  close.setAttribute("aria-label", "关闭");
  header.append(title, close);

  const body = new FakeElement("div", "", rect(260, 50, 940, 750));
  body.className = "contentBody_e9e3ed";
  const scroller = new FakeElement("div", "", rect(260, 50, 940, 750));
  scroller.className = "scroller__6131a auto_d125d2 scrollerBase_d125d2";
  const nativePanel = new FakeElement("div", "Discord native settings", rect(360, 100, 720, 640));
  nativePanel.className = "panel__6131a";
  scroller.appendChild(nativePanel);
  body.appendChild(scroller);
  content.append(header, body);
  root.append(sidebar, content);
  document.appendChild(root);

  const panel = new FakeElement("section", "", rect(360, 100, 720, 900));
  panel.id = __test.SETTINGS_PANEL_ID;

  try {
    global.document = document;
    __test.mountSettingsPanel(panel);

    assert.equal(panel.parentElement, scroller);
    assert.equal(header.dataset.dtmHidden, undefined);
    assert.equal(body.dataset.dtmHidden, undefined);
    assert.equal(scroller.dataset.dtmHidden, undefined);
    assert.equal(nativePanel.dataset.dtmHidden, "true");
    assert.equal(nativePanel.style.display, "none");
    assert.equal(title.textContent, __test.SETTINGS_LABEL);

    __test.restoreSettingsContent();
    assert.equal(title.textContent, "账户");
    assert.equal(nativePanel.dataset.dtmHidden, undefined);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings sections reuse Discord account page row structure", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();

  try {
    global.document = document;

    const first = document.createElement("div");
    first.textContent = "AI 平台";
    const second = document.createElement("div");
    second.textContent = "匹配模型";
    const section = __test.section("模型", [first, second]);

    assert.equal(section.className, "container__75920");
    assert.equal(section.children[0].className, "stack_dbd263");
    assert.equal(section.children[0].getAttribute("data-direction"), "horizontal");
    assert.equal(section.children[0].getAttribute("style"), "gap: var(--space-24); padding-bottom: var(--space-lg);");
    assert.equal(section.children[0].children[0].className, "stack_dbd263");
    assert.equal(section.children[0].children[0].getAttribute("data-direction"), "vertical");
    assert.equal(section.children[0].children[0].getAttribute("style"), "gap: var(--space-4); padding: var(--space-0);");
    assert.equal(section.children[0].children[0].children[0].tagName, "H2");
    assert.equal(section.children[0].children[0].children[0].className, "heading-xl/normal_cf4812 defaultColor__5345c");
    assert.equal(section.children[1].className, "stack_dbd263");
    assert.equal(section.children[1].getAttribute("data-direction"), "vertical");
    assert.equal(section.children[1].getAttribute("style"), "gap: var(--space-xs); padding: var(--space-0);");
    assert.equal(section.children[1].children.length, 2);
    assert.equal(section.children[1].children[0].className, "container__75920");
    assert.equal(section.children[1].children[0].children[0].className, "stack_dbd263 baseSettingWrapper__32428");
    assert.equal(section.children[1].children[0].children[0].getAttribute("data-direction"), "vertical");
    assert.equal(section.children[1].children[0].children[0].getAttribute("style"), "gap: var(--space-0); padding-top: var(--space-xs); padding-bottom: var(--space-xs);");
    assert.equal(section.children[1].children[0].children[0].children[0], first);
    assert.equal(section.children[2].className, "divider__1de9c divider__6131a");
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("languageSelectField renders a Discord React select host and keeps unknown custom language values", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();

  try {
    global.document = document;
    const field = __test.languageSelectField("阅读目标语言", "世界语", () => {});
    const host = walk(field).find(node => node.dataset.dtmNativeReactKind === "select");
    const fallback = walk(field).find(node => node.dataset.dtmFallbackControl === "select");

    assert.ok(host);
    assert.equal(field.querySelector("select"), null);
    assert.equal(host.dataset.dtmNativeReactMounted, "false");
    assert.equal(fallback, undefined);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings form controls use Discord component shells instead of dtm widget classes", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();

  try {
    global.document = document;

    const text = __test.inputField("模型地址", "text", "https://example.test", () => {});
    const inputHost = walk(text).find(node => node.dataset.dtmNativeReactKind === "text-input");
    assert.ok(inputHost);
    assert.equal(inputHost.dataset.dtmNativeReactMounted, "false");
    assert.equal(text.className.includes("dtm-input"), false);

    const selectField = __test.languageSelectField("阅读目标语言", "简体中文", () => {});
    const selectHost = walk(selectField).find(node => node.dataset.dtmNativeReactKind === "select");
    assert.ok(selectHost);
    assert.equal(selectField.querySelector("select"), null);

    const toggle = __test.toggleRow("启用插件", true, () => {});
    assert.equal(toggle.className.includes("dtm-toggle-row"), false);
    assert.ok(walk(toggle).find(node => node.dataset.dtmNativeReactKind === "switch"));

    const save = __test.button("保存");
    assert.equal(save.dataset.dtmNativeReactKind, "button");
    assert.equal(save.dataset.dtmNativeReactMounted, "false");
    assert.equal(save.className.includes("dtm-button"), false);
    assert.equal(walk(save).find(node => node.getAttribute("data-mana-component") === "button"), undefined);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings select is mounted through Discord React instead of a hidden browser picker", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();

  try {
    global.document = document;

    const field = __test.languageSelectField("阅读目标语言", "简体中文", () => {});
    const host = walk(field).find(node => node.dataset.dtmNativeReactKind === "select");
    const fallback = walk(field).find(node => node.dataset.dtmFallbackControl === "select");

    assert.ok(host);
    assert.equal(fallback, undefined);
    assert.equal(field.querySelector("select"), null);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings switch is mounted through Discord React instead of manually animated DOM", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();

  try {
    global.document = document;

    const field = __test.toggleRow("启用插件", true, () => {});
    const host = walk(field).find(node => node.dataset.dtmNativeReactKind === "switch");
    const fallback = walk(field).find(node => node.dataset.dtmFallbackControl === "switch");
    const thumb = walk(field).find(node => node.tagName === "SVG" && node.className.includes("thumb"));

    assert.ok(host);
    assert.equal(fallback, undefined);
    assert.equal(thumb, undefined);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings controls dispatch native mount requests without reading a main-world flag", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const document = new FakeDocument();
  const events = [];
  const messages = [];

  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  try {
    global.document = document;
    global.window = {
      CustomEvent: FakeCustomEvent,
      dispatchEvent: event => { events.push(event); },
      postMessage: message => { messages.push(message); },
      addEventListener() {}
    };

    const field = __test.languageSelectField("阅读目标语言", "简体中文", () => {});

    assert.equal(field.dataset.dtmNativeReactMounted, "pending");
    assert.match(field.dataset.dtmControlId, /^dtm-control-\d+$/);
    assert.equal(events[0].type, "dtm:mount-control");
    assert.equal(events[0].detail.kind, "select");
    assert.equal(events[0].detail.name, "阅读目标语言");
    assert.equal(messages[0].type, "dtm:mount-control");
    assert.equal(messages[0].detail.__dtmMessageId, events[0].detail.__dtmMessageId);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousWindow) global.window = previousWindow;
    else delete global.window;
  }
});

test("native button state updates do not clear the mounted Discord button tree", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const document = new FakeDocument();
  const events = [];
  const messages = [];

  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  try {
    global.document = document;
    global.window = {
      CustomEvent: FakeCustomEvent,
      dispatchEvent: event => { events.push(event); },
      postMessage: message => { messages.push(message); },
      addEventListener() {}
    };

    const control = __test.button("刷新模型", "secondary");
    const mountedTree = document.createElement("button");
    mountedTree.textContent = "刷新模型";
    control.appendChild(mountedTree);

    control.setLoading(true);

    assert.equal(control.children.includes(mountedTree), true);
    assert.equal(events.filter(event => event.type === "dtm:mount-control").length, 2);
    assert.equal(messages.filter(message => message.type === "dtm:mount-control").length, 2);
    assert.equal(events[1].detail.loading, true);
    assert.equal(messages[1].detail.__dtmMessageId, events[1].detail.__dtmMessageId);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousWindow) global.window = previousWindow;
    else delete global.window;
  }
});

test("native model combobox updates do not clear the mounted Discord field tree", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const document = new FakeDocument();
  const events = [];
  const messages = [];

  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  try {
    global.document = document;
    global.window = {
      CustomEvent: FakeCustomEvent,
      dispatchEvent: event => { events.push(event); },
      postMessage: message => { messages.push(message); },
      addEventListener() {}
    };

    const control = __test.modelComboBoxHostFor("匹配模型", "old-model", [{ value: "old-model", label: "old-model" }], () => {});
    const mountedTree = document.createElement("div");
    mountedTree.textContent = "Discord ComboBoxField";
    control.appendChild(mountedTree);

    control.updateOptions("new-model", [{ value: "new-model", label: "new-model" }]);

    assert.equal(control.children.includes(mountedTree), true);
    assert.equal(events.filter(event => event.type === "dtm:mount-control").length, 2);
    assert.equal(messages.filter(message => message.type === "dtm:mount-control").length, 2);
    assert.equal(events[1].detail.kind, "combobox");
    assert.equal(events[1].detail.value, "new-model");
    assert.deepEqual(events[1].detail.options, [{ value: "new-model", label: "new-model", id: "new-model" }]);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousWindow) global.window = previousWindow;
    else delete global.window;
  }
});

test("pending native controls retry their mount request until the bridge responds", () => {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const document = new FakeDocument();
  const events = [];
  const messages = [];
  const timers = [];

  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  try {
    global.document = document;
    global.window = {
      CustomEvent: FakeCustomEvent,
      dispatchEvent: event => { events.push(event); },
      postMessage: message => { messages.push(message); },
      addEventListener() {},
      setTimeout: callback => {
        timers.push(callback);
        return timers.length;
      }
    };

    const field = __test.languageSelectField("阅读目标语言", "简体中文", () => {});
    assert.equal(messages.filter(message => message.type === "dtm:mount-control").length, 1);

    timers.shift()();

    const mountMessages = messages.filter(message => message.type === "dtm:mount-control");
    assert.equal(field.dataset.dtmNativeReactMounted, "pending");
    assert.equal(mountMessages.length, 2);
    assert.notEqual(mountMessages[0].detail.__dtmMessageId, mountMessages[1].detail.__dtmMessageId);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousWindow) global.window = previousWindow;
    else delete global.window;
  }
});

test("settings page injects only scoped custom CSS for the allowed custom surfaces", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();

  try {
    global.document = document;
    const stale = document.createElement("style");
    stale.id = "dtm-style";
    stale.textContent = ".dtm-old { color: red; }";
    document.appendChild(stale);

    __test.injectBaseStyles();

    const style = document.getElementById("dtm-style");
    assert.ok(style);
    assert.ok(style.textContent.includes(".dtm-translation-block"));
    assert.equal(style.textContent.includes(".dtm-settings-toast"), false);
    assert.ok(style.textContent.includes("#dtm-send-box"));
    assert.ok(style.textContent.includes(".dtm-swatch-field"));
    assert.equal(style.textContent.includes(".dtm-slider-field"), false);
    assert.equal(style.textContent.includes(".dtm-panel-body"), false);
    assert.equal(style.textContent.includes(".dtm-button"), false);
    assert.equal(style.textContent.includes(".dtm-toggle-row"), false);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings source sends action feedback through panel-scoped toasts", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("const refreshModels = button(\"刷新模型\", \"secondary\")"));
  assert.ok(source.includes("const testConnection = button(\"测试连接\", \"secondary\")"));
  assert.ok(source.includes("let refreshModelsInFlight = false"));
  assert.ok(source.includes("let testConnectionInFlight = false"));
  assert.ok(source.includes("buttonRow([refreshModels, testConnection])"));
  assert.ok(source.includes("testConnection.setLoading(true)"));
  assert.ok(source.includes("refreshModels.setLoading(true)"));
  assert.equal(source.includes("showNativeToast(\"正在测试连接...\", \"message\")"), false);
  assert.ok(source.includes("showNativeToast(`连接成功：${result.text}`, \"success\")"));
  assert.equal(source.includes("showNativeToast(\"正在刷新模型...\", \"message\")"), false);
  assert.ok(source.includes("showNativeToast(`已刷新 ${models.length} 个模型`, \"success\")"));
  assert.equal(source.includes("showNativeToast(\"正在保存...\", \"message\")"), false);
  assert.equal(source.includes("showNativeToast(\"已保存。\", \"success\")"), false);
  assert.ok(source.includes("const openConfig = button(\"打开配置文件夹\", \"secondary\")"));
  assert.ok(source.includes("await nativeApi.openSettingsFile();"));
  assert.equal(source.includes("openConfig.setLoading"), false);
  assert.equal(source.includes("已打开配置文件"), false);
  assert.ok(source.includes("function showNativeToast"));
  // Feedback now flows through Discord's native toast so it follows the active theme.
  assert.equal(source.includes("function showSettingsToast"), false);
  assert.equal(source.includes("panel.appendChild(toast)"), false);
  assert.equal(source.includes("dtm-settings-toast"), false);
  assert.ok(source.includes("requestMainWorldToast"));
  assert.equal(source.includes("CreateToast"), false);
  assert.ok(preloadSource.includes("CreateToast"));
  assert.ok(preloadSource.includes("ShowToast"));
  assert.ok(preloadSource.includes("ToastTypes"));
  assert.equal(source.includes("dtmActionStatus"), false);
  assert.equal(source.includes("helperText: host.dataset"), false);
  assert.equal(source.includes("testConnection.setStatus"), false);
  assert.equal(source.includes("refreshControl.setLoading"), false);
  assert.equal(source.includes("modelListStatusText"), false);
  assert.equal(source.includes("function actionField"), false);
  assert.equal(source.includes("dtm:control-click"), false);
  assert.equal(source.includes("mainWorldControlClickCallbacks"), false);
  assert.equal(source.includes("actionField(\"模型列表\""), false);
  assert.equal(source.includes("dtmActionStatus"), false);
  assert.equal(source.includes("text-overflow: ellipsis"), false);
  assert.equal(source.includes("overflow-wrap: anywhere"), false);
  assert.equal(source.includes("status.textContent = `连接成功"), false);
  assert.equal(source.includes("使用当前表单配置发起一次测试请求"), false);
});

test("settings feedback is dispatched to Discord's native toast so it follows the theme", () => {
  const previousWindow = global.window;
  const messages = [];
  const events = [];
  global.window = {
    dispatchEvent: event => { events.push(event); return true; },
    postMessage: message => { messages.push(message); },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  };

  try {
    const handled = __test.showNativeToast("已保存。", "success");

    assert.equal(handled, true);
    const toastMessage = messages.find(message => message && message.type === "dtm:show-toast");
    assert.ok(toastMessage, "expected a native toast bridge message");
    assert.equal(toastMessage.detail.message, "已保存。");
    assert.equal(toastMessage.detail.tone, "success");
  } finally {
    if (previousWindow) global.window = previousWindow;
    else delete global.window;
  }
});

test("settings source renders model selection as one searchable Discord combo box", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("nativeApi.listModels"));
  assert.ok(source.includes("refreshModelList"));
  assert.ok(source.includes("renderModelField"));
  assert.ok(source.includes("modelComboBoxHost.updateOptions(formState.model.modelId, modelOptions);"));
  assert.ok(source.includes("renderModelField();\n      showNativeToast(`已刷新 ${models.length} 个模型`, \"success\")"));
  assert.ok(source.includes("modelComboBoxHostFor(\"匹配模型\""));
  assert.ok(source.includes("kind: \"combobox\""));
  assert.equal(source.includes("ComboBoxField"), false);
  assert.ok(preloadSource.includes("ComboBoxField"));
  assert.equal(source.includes("ComboboxProvider"), false);
  assert.equal(source.includes("ComboboxListbox"), false);
  assert.equal(source.includes("dtm-combobox-popout"), false);
  assert.equal(source.includes("dtm-model-row"), false);
  assert.equal(source.includes("textInputHost(\"匹配模型\""), false);
  assert.equal(source.includes("selectHostFor(\"匹配模型\""), false);
  assert.equal(source.includes("模型搜索 / 手动输入"), false);
  assert.equal(source.includes("textField(\"模型 ID\""), false);
});

test("settings source lets Discord render the model listbox without a custom popout", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.equal(source.includes("setFloating"), false);
  assert.equal(source.includes("showChevronButton"), false);
  assert.ok(preloadSource.includes("setFloating"));
  assert.ok(preloadSource.includes("showChevronButton"));
  assert.equal(source.includes(".dtm-combobox-popout"), false);
  assert.equal(source.includes(".dtm-combobox-popout {\n      background: var(--background-floating"), false);
  assert.equal(source.includes("[data-mana-component='listbox']"), false);
});

test("provider changes keep model row position stable by keeping the model address row", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.ok(source.includes("inputField(\"模型地址\", \"text\", formState.model.baseUrl"));
  assert.ok(source.includes("disabled: provider.value !== \"custom\""));
  assert.equal(source.includes("if (provider.value === \"custom\") {\n      providerFields.append(textField(\"模型地址\""), false);
});

test("API key field shows a masked preview and never stages the mask as a new key", () => {
  __test.setRuntimeForTests({
    providerApiKeyStatus: { openai: true, google: false, previews: { openai: "sk-a…wxyz" } }
  });
  try {
    assert.equal(__test.apiKeyPlaceholder("openai"), "已保存 sk-a…wxyz");
    assert.equal(__test.apiKeyPlaceholder("google"), "粘贴 API Key");
    assert.equal(__test.apiKeyValueForRequest("************"), "");
    assert.equal(__test.apiKeyValueForRequest(" sk-live "), "sk-live");
  } finally {
    __test.resetRuntimeForTests();
  }
});

test("provider options only mark providers that have saved API keys", () => {
  const options = __test.providerOptionsWithStatus({ openai: true, google: false });
  const openai = options.find(option => option.value === "openai");
  const google = options.find(option => option.value === "google");

  assert.equal(openai.label, "OpenAI");
  assert.equal(openai.apiKeySaved, true);
  assert.equal(google.label, "Google Gemini");
  assert.equal(google.apiKeySaved, false);
  assert.equal(options.some(option => /✓/.test(option.label)), false);
});

test("provider select keeps API key status separate from selected option labels", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.equal(source.includes("renderOptionLabel: item => renderSelectOptionLabel"), false);
  assert.equal(source.includes("formatOption: item => formatSelectOption"), false);
  assert.ok(preloadSource.includes("formatOption: item => formatSelectOption(ui, item)"));
  assert.ok(preloadSource.includes("LockIcon"));
  assert.equal(source.includes(".dtm-provider-select-field [class*='selectedIcon']"), false);
  assert.equal(source.includes("已保存 API Key\" }, \"✓\""), false);
});

test("settings source lays feature toggles out as regular Discord setting rows", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.equal(source.includes("featureToggleGrid(["), false);
  assert.equal(source.includes("function featureToggleGrid"), false);
  assert.equal(source.includes(".dtm-feature-grid"), false);
  assert.ok(source.includes("toggleRow(\"启用插件\""));
  assert.ok(source.includes("toggleRow(\"启用发送翻译输入框\""));
  assert.ok(source.includes("kind: \"switch\""));
  assert.equal(source.includes("findWebpackComponentAny"), false);
  assert.ok(preloadSource.includes("findComponentAny"));
  assert.ok(preloadSource.includes("\"switchIndicator\", \"thumb\", \"data-mana-component\""));
  assert.equal(source.includes("DISCORD_SWITCH_COLORS"), false);
  assert.equal(source.includes("syncNativeSwitchColors"), false);
  assert.equal(source.includes("bindNativeSwitchColorSync"), false);
  assert.equal(source.includes("pointerleave"), false);
  assert.equal(source.includes("checked: value,\n        value,"), false);
});

test("settings source uses Discord account page containers instead of plugin wrappers", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.ok(source.includes("accountPanel: \"panel__6131a\""));
  assert.ok(source.includes("accountCategories: \"categories__6131a\""));
  assert.ok(source.includes("DISCORD_STACK_LAYOUTS"));
  assert.ok(source.includes("data-direction"));
  assert.ok(source.includes("panel.className = DISCORD_UI.accountPanel"));
  assert.ok(source.includes("const body = div(DISCORD_UI.accountCategories)"));
  assert.ok(source.includes("divider: \"divider__1de9c divider__6131a\""));
  assert.ok(source.includes("SETTINGS_SECTION_NAV"));
  assert.ok(source.includes("ensureSettingsSubnav"));
  assert.ok(source.includes("scrollToSettingsSection"));
  assert.equal(source.includes("dtm-panel-body"), false);
  assert.equal(source.includes("dtm-provider-select-field"), false);
  assert.equal(source.includes("dtm-provider-fields"), false);
  assert.equal(source.includes("dtm-model-field"), false);
  assert.equal(source.includes("dtm-settings-page"), false);
  assert.equal(source.includes("dtm-settings-floating"), false);
  assert.equal(source.includes("section(\"功能\""), false);
  assert.equal(source.includes("section(\"操作\""), false);
  assert.equal(source.includes("保存设置"), false);
});

test("settings source delegates subnav thumb movement to Discord main-world spring", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.ok(source.includes("function requestMainWorldSubnavThumbSync"));
  assert.ok(source.includes("window.dispatchEvent(new window.CustomEvent(type"));
  assert.ok(source.includes('sendMainWorldMessage("dtm:sync-subnav-thumb", detail)'));
  assert.ok(source.includes("if (requestMainWorldSubnavThumbSync(trackThumb)) return;"));
  assert.equal(source.includes("transitionDuration"), false);
});

test("settings source shows translation style controls directly without advanced disclosure", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.ok(source.includes("section(\"译文设置\""));
  assert.ok(source.includes("section(\"翻译设置\""));
  assert.equal(source.includes("advancedSettings(["), false);
  assert.equal(source.includes("function advancedSettings"), false);
  assert.equal(source.includes("button(\"高级设置\""), false);
});

test("settings source only exposes color swatches and font selection for translation style", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.ok(source.includes("BACKGROUND_COLOR_OPTIONS"));
  assert.ok(source.includes("TEXT_COLOR_OPTIONS"));
  assert.ok(source.includes("colorSwatchField(\"背景色\""));
  assert.ok(source.includes("colorSwatchField(\"译文颜色\""));
  assert.ok(source.includes("selectField(\"字体\""));
  assert.equal(source.includes("selectField(\"文字装饰\""), false);
  assert.equal(source.includes("sliderField("), false);
  assert.equal(source.includes("colorPresetField("), false);
  assert.equal(source.includes("ColorPicker"), false);
  assert.equal(source.includes("DefaultColorButton"), false);
  assert.equal(source.includes("CustomColorButton"), false);
  assert.equal(source.includes("renderDefaultButton"), false);
  assert.equal(source.includes("renderCustomButton"), false);
  assert.equal(source.includes("CustomColorPicker"), false);
  assert.equal(source.includes("suggestedColors"), false);
  assert.equal(source.includes("showEyeDropper"), false);
  assert.equal(source.includes("onChangeComplete"), false);
  assert.equal(source.includes("saturation-white"), false);
  assert.equal(source.includes("CustomColorControl"), false);
  assert.equal(source.includes("type: \"color\""), false);
  assert.equal(source.includes("input.click()"), false);
  assert.equal(source.includes("[data-dtm-native-react-kind='color-picker'] [class*='customContainer']:empty"), false);
});

test("translation style uses selected colors without automatic contrast overrides", () => {
  const style = __test.translationPreviewStyle({
    backgroundColor: "#2b2d31",
    textColor: "#111827",
    borderRadius: 8,
    fontFamily: "inherit",
    fontSize: 14,
    background: true,
    emphasis: "none"
  }, false);

  assert.equal(style.backgroundColor, "#2b2d31");
  assert.equal(style.color, "#111827");
});

test("translation style supports turning off the background and custom emphasis", () => {
  const noBg = __test.translationPreviewStyle({ backgroundColor: "#2b2d31", textColor: "#fff", borderRadius: 8, fontFamily: "inherit", fontSize: 14, background: false, emphasis: "none" }, false);
  assert.equal(noBg.backgroundColor, "transparent");
  assert.equal(noBg.boxShadow, "none");

  const marker = __test.translationPreviewStyle({ background: true, emphasis: "marker", backgroundColor: "#2b2d31", textColor: "#fff", borderRadius: 8, fontFamily: "inherit", fontSize: 14 }, false);
  assert.ok(/linear-gradient/.test(marker.backgroundImage));

  const wavy = __test.translationPreviewStyle({ background: true, emphasis: "wavy", backgroundColor: "#2b2d31", textColor: "#fff", borderRadius: 8, fontFamily: "inherit", fontSize: 14 }, false);
  assert.equal(wavy.textDecorationLine, "underline");
  assert.equal(wavy.textDecorationStyle, "wavy");

  const bold = __test.translationPreviewStyle({ background: true, emphasis: "bold", backgroundColor: "#2b2d31", textColor: "#fff", borderRadius: 8, fontFamily: "inherit", fontSize: 14 }, false);
  assert.equal(bold.fontWeight, "700");
});

test("settings source avoids local fallback widgets for native Discord controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.equal(source.includes("function settingField"), false);
  assert.equal(source.includes("createSelectFallback"), false);
  assert.equal(source.includes("createToggleFallback"), false);
  assert.equal(source.includes("createColorFallback"), false);
  assert.equal(source.includes("nativeTextControl"), false);
  assert.equal(source.includes("nativeButton"), false);
  assert.equal(source.includes("DISCORD_UI.field"), false);
  assert.equal(source.includes("DISCORD_UI.button"), false);
});

test("settings source keeps custom stylesheet scoped away from the native settings page shell", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.ok(source.includes('document.createElement("style")'));
  assert.ok(source.includes("style.textContent"));
  assert.ok(source.includes(".dtm-translation-block"));
  assert.ok(source.includes("#${SEND_BOX_ID}"));
  assert.ok(source.includes(".dtm-swatch-field"));
  assert.equal(source.includes(".dtm-slider-field"), false);
  assert.equal(source.includes(".dtm-action-field-control"), false);
  assert.equal(source.includes(".dtm-style-preview-wrap"), false);
  assert.equal(source.includes(".dtm-provider-api-icon"), false);
  assert.equal(source.includes(".dtm-test-row"), false);
  assert.equal(source.includes(".dtm-color-swatch"), false);
  assert.equal(source.includes(".dtm-panel-body"), false);
  assert.equal(source.includes(".dtm-button"), false);
  assert.equal(source.includes(".dtm-toggle-row"), false);
});

test("settings source reports native mount failures for runtime diagnosis", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.ok(source.includes("function diagnosticLog"));
  assert.ok(source.includes("host.dataset.dtmNativeReactError"));
  assert.ok(source.includes("MAIN_WORLD_BRIDGE_ERROR"));
  assert.equal(source.includes("discordUiResolveReason"), false);
  assert.equal(source.includes("function resolveDiscordUi"), false);
});

test("settings source keeps cache enabled without exposing a cache toggle", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.equal(source.includes("启用 AI 缓存"), false);
  assert.equal(source.includes("section(\"缓存\""), false);
});

test("publicError removes Electron IPC prefixes and keeps user-facing text short", () => {
  assert.equal(
    __test.publicError(new Error("Error invoking remote method 'dtm:test-connection': Error: Model request failed (401): token expired or incorrect")),
    "模型请求失败 (401): token expired or incorrect"
  );
});

test("double clicking a translated message hides the existing translation block", () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  const message = new FakeElement("div", "", rect(0, 0, 600, 120));
  message.id = "chat-messages-1-2";
  const content = new FakeElement("div", "Hello", rect(0, 0, 400, 24));
  content.id = "message-content-1";
  const translation = new FakeElement("div", "你好", rect(0, 30, 400, 24));
  translation.className = "dtm-translation-block";
  message.append(content, translation);
  document.appendChild(message);

  let prevented = false;
  let stopped = false;

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        model: { targetLanguage: "简体中文" }
      },
      nativeApi: {
        translate: () => {
          throw new Error("translate should not be called when hiding an existing translation");
        }
      }
    });

    __test.onMessageDoubleClick({
      target: content,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; }
    });

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(message.children.includes(translation), false);
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("UI polish fixes are wired at their key nodes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  // Send box is a draggable body overlay (never injected into the React composer)
  // and stays theme-readable with a caret.
  assert.ok(source.includes("function positionSendBox"));
  assert.ok(source.includes("function installSendBoxDrag"));
  assert.ok(source.includes("function installSendBoxResize"));
  assert.ok(source.includes("function hasCustomSendBoxWidth"));
  assert.ok(source.includes("(document.body || document.documentElement).appendChild(box)"));
  assert.equal(source.includes("mount.parentElement.insertBefore(box, mount)"), false);
  assert.ok(source.includes("caret-color:"));
  assert.ok(source.includes("var(--text-default,"));
  // Overlay background samples the native composer so it follows the Discord theme,
  // never matching the (user-configurable) translation bubble background.
  assert.ok(source.includes("function applyComposerBackground"));

  // Double-click hide is remembered so cache-restore does not bring it back.
  assert.ok(source.includes("dismissedTranslations.add(getMessageId(message))"));
  assert.ok(source.includes("dismissedTranslations.delete(getMessageId(message))"));
  assert.ok(source.includes("if (dismissedTranslations.has(getMessageId(message))) continue;"));

  // Save shows a transient checkmark on the button, with no toast or spinner.
  assert.ok(source.includes("host.flashLabel"));
  assert.ok(source.includes("save.flashLabel(\"已保存\")"));
  assert.equal(source.includes("save.setLoading"), false);

  // Settings panel hides native content before revealing ours (no open flicker).
  assert.ok(source.includes("hideSettingsContentSiblings(mount, panel);\n    mount.prepend(panel);"));

  // Translation preview is a padded rounded box, not a thin strip.
  assert.ok(preloadSource.includes('"9px 13px"'));
});

test("translation cache hit reuses the previous AI result", async () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  const message = new FakeElement("div", "", rect(0, 0, 600, 120));
  message.id = "chat-messages-cache-1";
  document.appendChild(message);
  let requests = 0;

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        style: {
          textDecoration: "none",
          backgroundColor: "var(--background-secondary)",
          textColor: "var(--text-normal)",
          borderRadius: 6,
          fontFamily: "inherit",
          fontSize: 13
        },
        model: { targetLanguage: "简体中文" }
      },
      nativeApi: {
        translate: async () => {
          requests += 1;
          return { ok: true, text: "你好" };
        }
      }
    });

    await __test.translateMessage(message, "Hello");
    await __test.translateMessage(message, "Hello");

    const translation = message.children.find(node => node.className === "dtm-translation-block");
    assert.equal(requests, 1);
    assert.equal(translation.textContent, "你好");
    assert.equal(translation.dataset.dtmCacheHit, "true");
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("send translation box mounts above the Discord native composer", () => {
  const previousDocument = global.document;
  const document = new FakeDocument();
  const composerWrap = new FakeElement("div", "", rect(80, 680, 720, 120));
  const composer = new FakeElement("div", "", rect(80, 704, 720, 80));
  composer.className = "channelTextArea__74017";
  const form = new FakeElement("form", "", rect(80, 704, 720, 56));
  const editor = new FakeElement("div", "", rect(96, 716, 688, 28));
  editor.setAttribute("role", "textbox");
  editor.setAttribute("contenteditable", "true");
  form.appendChild(editor);
  composer.appendChild(form);
  composerWrap.appendChild(composer);
  document.appendChild(composerWrap);

  try {
    global.document = document;
    __test.setRuntimeForTests({
      settings: {
        enabled: true,
        sendTranslation: { enabled: true },
        model: { sendLanguage: "英语" }
      }
    });

    __test.ensureSendBox();

    const box = document.getElementById("dtm-send-box");
    assert.ok(box);
    // Never injected into Discord's React composer subtree.
    assert.equal(composerWrap.children.includes(box), false);
    // Mounted on the document root as a fixed overlay.
    assert.equal(box.parentElement, document);
    // Default position tracks the composer's left edge and width.
    assert.equal(box.style.width, "720px");
    assert.equal(box.style.left, "80px");
    // Has a drag grip handle.
    assert.ok(box.children.some(child => child.className === "dtm-send-grip"));
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings page source does not contain hand rolled select, switch animation, or details disclosure controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.equal(source.includes('document.createElement("select")'), false);
  assert.equal(source.includes(".showPicker("), false);
  assert.equal(source.includes('document.createElement("details")'), false);
  assert.equal(source.includes('document.createElement("summary")'), false);
  assert.equal(source.includes("syncSwitchVisual"), false);
  assert.equal(source.includes("data-dtm-native-select-control"), false);
  assert.equal(source.includes("thumb.style.left"), false);
  assert.equal(source.includes('textField("背景色"'), false);
  assert.equal(source.includes('textField("文字颜色"'), false);
  assert.equal(source.includes('textField("字体"'), false);
  assert.equal(source.includes('numberField("圆角"'), false);
  assert.equal(source.includes('numberField("字号"'), false);
  assert.equal(source.includes('toggleRow("双击消息显示译文"'), false);
  assert.equal(source.includes('textareaField("阅读翻译提示词"'), false);
  assert.equal(source.includes('textareaField("发送翻译提示词"'), false);
  assert.equal(source.includes("customReadPrompt"), false);
  assert.equal(source.includes("customSendPrompt"), false);
  assert.equal(source.includes("!settings.readTranslation.enabled"), false);
  assert.ok(source.includes("colorSwatchField(\"背景色\""));
  assert.ok(source.includes("colorSwatchField(\"译文颜色\""));
  assert.equal(source.includes("sliderField("), false);
  assert.equal(source.includes("selectField(\"文字装饰\""), false);
  assert.ok(source.includes("translationStylePreview"));
  assert.ok(source.includes("selectField(\"AI 平台\""));
  assert.ok(source.includes("selectField(\"翻译风格\""));
  assert.ok(source.includes("(document.body || document.documentElement).appendChild(box)"));
  assert.ok(source.includes("function findDiscordComposerMount"));
  assert.ok(source.includes("[class*='channelTextArea']"));
  assert.equal(source.includes("mount.parentElement.insertBefore(box, mount)"), false);
});

function settingsHeader(text, y) {
  const node = new FakeElement("div", text, rect(20, y, 220, 24));
  node.className = "header__409aa";
  return node;
}

function settingsRow(text, y) {
  const row = new FakeElement("div", "", rect(20, y, 220, 34));
  row.className = "item__409aa nativeItem__409aa";
  row.setAttribute("role", "button");

  const icon = new FakeElement("span", "", rect(28, y + 7, 20, 20));
  icon.className = "icon__409aa";

  const label = new FakeElement("div", text, rect(60, y + 6, 160, 22));
  label.className = "label__409aa";

  row.append(icon, label);
  return row;
}

function settingsSubnavTemplate(text, y) {
  const subnav = new FakeElement("div", "", rect(20, y, 220, 144));
  subnav.className = "subnavContainer__409aa";

  const list = new FakeElement("div", "", rect(37, y, 203, 144));
  list.className = "subnav__409aa";
  list.setAttribute("role", "list");
  const track = new FakeElement("div", "", rect(37, y + 8, 2, 128));
  track.className = "track__409aa";
  const trackThumb = new FakeElement("div", "", rect(37, y + 8, 2, 20));
  trackThumb.className = "thumb__409aa";
  track.appendChild(trackThumb);
  const thumb = new FakeElement("div", "", rect(37, y + 8, 2, 20));
  thumb.className = "thumbAnchor__409aa";
  list.append(
    track,
    thumb,
    settingsSubnavItem(text, y, true),
    settingsSubnavItem("密码和安全中心", y + 36),
    settingsSubnavItem("账户信誉", y + 72),
    settingsSubnavItem("家庭中心", y + 108)
  );

  subnav.appendChild(list);
  return subnav;
}

function settingsSubnavItem(text, y, selected = false) {
  const row = new FakeElement("div", "", rect(56, y + 8, 184, 20));
  row.setAttribute("role", "listitem");

  const label = new FakeElement("div", text, rect(56, y + 8, 184, 20));
  label.className = selected ? "item__409aa active__409aa" : "item__409aa";
  label.setAttribute("role", "link");
  if (selected) label.setAttribute("aria-current", "page");

  row.appendChild(label);
  return row;
}

function rect(x, y, width, height) {
  return { x, y, width, height };
}

class FakeDocument {
  constructor() {
    this.children = [];
    this.documentElement = this;
    this.querySelectorAllCalls = [];
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createElementNS(_namespace, tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return walk(this).find(node => node.id === id) || null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    this.querySelectorAllCalls.push(selector);
    return walk(this).slice(1).filter(node => node.matches(selector));
  }
}

class FakeElement {
  constructor(tagName, textContent = "", box = rect(0, 0, 0, 0)) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.className = "";
    this.id = "";
    this.tabIndex = -1;
    this.type = "";
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.box = box;
    this.ownTextContent = textContent;
    this.classList = {
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) classes.add(name);
        this.className = Array.from(classes).join(" ");
      },
      remove: (...names) => {
        const removeSet = new Set(names);
        this.className = this.className.split(/\s+/).filter(name => name && !removeSet.has(name)).join(" ");
      },
      contains: name => this.className.split(/\s+/).includes(name)
    };
  }

  get textContent() {
    if (this.children.length === 0) return this.ownTextContent;
    return this.children.map(child => child.textContent).join("");
  }

  set textContent(value) {
    this.children = [];
    this.ownTextContent = String(value);
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    const index = before ? this.children.indexOf(before) : -1;
    child.parentElement = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  prepend(child) {
    child.parentElement = this;
    this.children.unshift(child);
    return child;
  }

  insertAdjacentElement(position, element) {
    assert.equal(position, "afterend");
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    element.parentElement = this.parentElement;
    siblings.splice(index + 1, 0, element);
    return element;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    return siblings[siblings.indexOf(this) - 1] || null;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
    if (name === "tabindex") this.tabIndex = Number(value);
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "id") this.id = "";
    if (name === "class") this.className = "";
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child.contains(node));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  scrollIntoView(options) {
    this.scrollIntoViewOptions = options || {};
  }

  getBoundingClientRect() {
    return {
      ...this.box,
      right: this.box.x + this.box.width,
      bottom: this.box.y + this.box.height
    };
  }

  cloneNode(deep) {
    const clone = new FakeElement(this.tagName, this.ownTextContent, this.box);
    clone.className = this.className;
    clone.id = this.id;
    clone.tabIndex = this.tabIndex;
    clone.type = this.type;
    for (const [name, value] of this.attributes) clone.setAttribute(name, value);
    if (deep) {
      for (const child of this.children) clone.appendChild(child.cloneNode(true));
    }
    return clone;
  }

  querySelectorAll(selector) {
    return walk(this).slice(1).filter(node => node.matches(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  matches(selector) {
    return selector.split(",").some(part => matchesSimple(this, part.trim()));
  }
}

function walk(root) {
  const nodes = [root];
  for (const child of root.children || []) {
    nodes.push(...walk(child));
  }
  return nodes;
}

function matchesSimple(node, selector) {
  if (selector === "*") return true;
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  if (selector.startsWith(".")) return node.className.split(/\s+/).includes(selector.slice(1));
  if (selector === "a") return node.tagName === "A";
  if (selector === "button") return node.tagName === "BUTTON";
  if (selector === "input") return node.tagName === "INPUT";
  if (selector === "select") return node.tagName === "SELECT";
  if (selector === "textarea") return node.tagName === "TEXTAREA";
  if (selector === "div") return node.tagName === "DIV";
  if (selector === "form") return node.tagName === "FORM";
  if (selector === "nav") return node.tagName === "NAV";
  if (selector === "span") return node.tagName === "SPAN";
  if (selector === "[role='textbox'][contenteditable='true']") {
    return node.getAttribute("role") === "textbox" && node.getAttribute("contenteditable") === "true";
  }
  if (selector === "[id]") return Boolean(node.id);
  if (selector === "[tabindex]") return node.attributes.has("tabindex");
  if (selector === "[data-dtm-hidden='true']") return node.dataset.dtmHidden === "true";
  if (selector === "[data-dtm-header-title='true']") return node.dataset.dtmHeaderTitle === "true";

  const roleMatch = selector.match(/^\[role='([^']+)'\]$/);
  if (roleMatch) return node.getAttribute("role") === roleMatch[1];

  const classMatch = selector.match(/^\[class\*='([^']+)'\]$/);
  if (classMatch) return node.className.includes(classMatch[1]);

  const dataMatch = selector.match(/^\[data-([a-z0-9-]+)='([^']+)'\]$/i);
  if (dataMatch) {
    const key = dataMatch[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    return node.dataset[key] === dataMatch[2];
  }

  return false;
}
