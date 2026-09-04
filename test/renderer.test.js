"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { __test } = require("../src/mod/renderer");

test("automatic translation colors follow the theme without a background and contrast with custom bubbles", () => {
  const theme = __test.translationPreviewStyle({ background: false, textColor: "auto" }, false);
  assert.match(theme.color, /var\(--text-default/);
  assert.equal(theme.backgroundColor, "transparent");
  assert.equal(__test.translationPreviewStyle({ backgroundColor: "#f2f3f5", textColor: "auto" }).color, "#111827");
  assert.equal(__test.translationPreviewStyle({ backgroundColor: "#303446", textColor: "auto" }).color, "#f2f3f5");
  assert.equal(__test.translationPreviewStyle({ background: false, textColor: "#ff0000" }).color, "#ff0000");
  assert.match(__test.translationPreviewStyle({ backgroundColor: "auto", textColor: "auto" }).backgroundColor, /var\(/);
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

    assert.equal(document.getElementById("dtm-settings-slot-model"), null);
    assert.equal(document.querySelectorAllCalls.includes("nav, [role='navigation'], [role='tablist'], [class*='sidebar'], [class*='side']"), false);
  } finally {
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
  }
});

test("settings categories retain native setting rows", () => {
  const previous = global.document;
  global.document = new FakeDocument();
  try {
    const field = new FakeElement("div", "field");
    const section = __test.section("模型", [field], "model");
    assert.equal(section.id, "dtm-settings-section-model");
    assert.equal(section.getAttribute("data-direction"), "vertical");
    assert.equal(section.children[0].dataset.dtmNativeSettingRow, "true");
    assert.equal(section.contains(field), true);
  } finally { global.document = previous; }
});

function settingsRuntime(t, api = {}) {
  const document = readingRuntime(t, { settings: {}, nativeApi: { getSettings: async () => ({}), ...api } });
  const previousWindow = global.window;
  const events = [];
  global.window = new EventTarget();
  global.window.CustomEvent = CustomEvent;
  global.window.postMessage = () => {};
  global.window.setTimeout = () => {};
  global.window.addEventListener("dtm:unmount-controls", event => events.push(event.detail));
  for (const key of ["model", "read", "send", "style"]) {
    const slot = new FakeElement("div");
    slot.id = `dtm-settings-slot-${key}`;
    slot.dataset.dtmSectionKey = key;
    document.appendChild(slot);
  }
  t.after(() => { __test.closeSettingsPanel(); global.window = previousWindow; });
  return { document, events };
}

test("native settings slots share one form and dispose callbacks when the panel closes", async t => {
  const { document, events } = settingsRuntime(t);
  await __test.openSettingsPanel();
  for (const key of ["model", "read", "send", "style"]) {
    const slot = document.getElementById(`dtm-settings-slot-${key}`);
    assert.equal(slot.children.length, 1);
    assert.equal(slot.children[0].id, `dtm-settings-section-${key}`);
  }
  await __test.openSettingsPanel();
  assert.equal(document.getElementById("dtm-settings-slot-model").children.length, 1);
  let changes = 0;
  const field = __test.toggleRow("Test", false, () => { changes++; });
  document.getElementById("dtm-settings-section-read").appendChild(field);
  const change = () => global.window.dispatchEvent(new CustomEvent("dtm:control-change", { detail: { id: field.dataset.dtmControlId, value: true } }));
  change();
  assert.equal(changes, 1);
  __test.closeSettingsPanel();
  change();
  assert.equal(changes, 1);
  assert.equal(field.dataset.dtmNativeReactMounted, "disposed");
  assert.ok(events.flatMap(event => event.ids).includes(field.dataset.dtmControlId));
});

test("closing native settings while preferences load does not mount a stale form", async t => {
  const request = deferredTranslation();
  const { document } = settingsRuntime(t, { getSettings: () => request.promise });
  const opening = __test.openSettingsPanel();
  __test.closeSettingsPanel();
  request.resolve({});
  await opening;
  assert.equal(document.getElementById("dtm-settings-slot-model").children.length, 0);
});

test("replacing a provider field disposes only its old native control", t => {
  const { events } = settingsRuntime(t);
  let changes = 0;
  const container = new FakeElement("div");
  const old = __test.languageSelectField("Language", "英语", () => { changes++; });
  container.appendChild(old);
  __test.clearChildren(container);
  global.window.dispatchEvent(new CustomEvent("dtm:control-change", { detail: { id: old.dataset.dtmControlId, value: "日语" } }));
  assert.equal(changes, 0);
  assert.equal(old.dataset.dtmNativeReactMounted, "disposed");
  assert.deepEqual(events.at(-1).ids, [old.dataset.dtmControlId]);
});

test("a model refresh cannot replace another provider selected while the request is pending", async t => {
  const pending = deferredTranslation();
  const { document } = settingsRuntime(t, { listModels: () => pending.promise });
  await __test.openSettingsPanel();
  const control = name => walk(document).find(node => node.__dtmControlSpec?.name === name);
  const refresh = walk(document).find(node => node.__dtmControlSpec?.label === "刷新模型");
  refresh.listeners.get("click")();
  control("AI 平台").__dtmControlSpec.onChange("deepseek");
  const model = control("匹配模型").__dtmControlSpec.value;
  pending.resolve({ models: [{ value: "unrelated-model", label: "Unrelated model" }] });
  await flushMicrotasks();
  assert.equal(control("匹配模型").__dtmControlSpec.value, model);
});

test("saving captures preferences and API key together without discarding later edits", async t => {
  const pending = deferredTranslation();
  const saved = [];
  const keys = [];
  const { document } = settingsRuntime(t, {
    setApiKey: request => { keys.push(request); return pending.promise; },
    saveSettings: async preferences => { saved.push(preferences); return preferences; }
  });
  await __test.openSettingsPanel();
  const control = name => walk(document).find(node => node.__dtmControlSpec?.name === name);
  const save = walk(document).find(node => node.__dtmControlSpec?.label === "保存");
  control("API Key").__dtmControlSpec.onChange("test-only-original");
  const saving = save.listeners.get("click")();
  control("AI 平台").__dtmControlSpec.onChange("deepseek");
  control("API Key").__dtmControlSpec.onChange("test-only-new");
  const apiControl = control("API Key");
  pending.resolve({ ok: true });
  await saving;
  assert.equal(saved[0].model.provider, keys[0].provider);
  assert.equal(keys[0].apiKey, "test-only-original");
  assert.equal(Object.hasOwn(saved[0], "__apiKey"), false);
  assert.equal(control("API Key"), apiControl);
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
  const settingsSource = source.slice(source.indexOf("async function openSettingsPanel"), source.indexOf("function onMessageDoubleClick"));
  assert.equal(settingsSource.includes("overflow-wrap: anywhere"), false);
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
  assert.equal(source.includes("SearchableSelect"), false);
  assert.ok(preloadSource.includes("SearchableSelect"));
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
  assert.ok(preloadSource.includes("onSearchChange"));
  assert.ok(preloadSource.includes("maxVisibleItems"));
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
  assert.ok(preloadSource.includes("renderOptionLabel: item => renderSelectOption(ui, item)"));
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
  assert.ok(preloadSource.includes('findComponent(require, ["switchIconsEnabled", "hasIcon"])'));
  assert.ok(preloadSource.includes('h(ui.Switch, { label: detail.name || "", checked: value'));
  assert.equal(source.includes("DISCORD_SWITCH_COLORS"), false);
  assert.equal(source.includes("syncNativeSwitchColors"), false);
  assert.equal(source.includes("bindNativeSwitchColorSync"), false);
  assert.equal(source.includes("pointerleave"), false);
  assert.equal(source.includes("checked: value,\n        value,"), false);
});

test("settings source shows translation style controls directly without advanced disclosure", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");

  assert.ok(source.includes("section(\"译文外观\""));
  assert.ok(source.includes("section(\"消息翻译\""));
  assert.ok(source.includes("section(\"发送翻译\""));
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

  // Double-click hide is remembered so cache-restore does not bring it back, and restore
  // only ever acts on messages the user actually translated (no cross-message bleed).
  assert.ok(source.includes("dismissedTranslations.add(getMessageId(message))"));
  assert.ok(source.includes("dismissedTranslations.delete(getMessageId(message))"));
  assert.ok(source.includes("if (!translatedMessages.has(id) || dismissedTranslations.has(id)) continue;"));

  // Save confirms inline without a spinner.
  assert.ok(source.includes("host.flashLabel"));
  assert.ok(source.includes("save.flashLabel(\"已保存\")"));
  assert.equal(source.includes("save.setLoading"), false);

  // Translation preview is a padded rounded box, not a thin strip.
  assert.ok(source.includes("padding: 9px 13px;"));
});

test("translation cache hit reuses the previous AI result", async () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  const message = new FakeElement("div", "", rect(0, 0, 600, 120));
  message.id = "chat-messages-cache-1";
  const content = new FakeElement("div", "Hello", rect(0, 0, 400, 24));
  content.className = "messageContent__cache";
  message.appendChild(content);
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

    await __test.translateMessage(message);
    await __test.translateMessage(message);

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

test("reply messages translate the body and the quoted preview as separate units", async () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();

  const message = new FakeElement("div", "", rect(0, 0, 600, 160));
  message.id = "chat-messages-reply-1";
  const quote = new FakeElement("div", "", rect(0, 0, 400, 20));
  quote.className = "repliedMessage__abc";
  const quoteText = new FakeElement("div", "original quoted text", rect(0, 0, 380, 16));
  quoteText.className = "repliedTextContent__abc";
  quote.appendChild(quoteText);
  const content = new FakeElement("div", "my reply body", rect(0, 24, 400, 24));
  content.className = "messageContent__abc";
  message.append(quote, content);
  document.appendChild(message);

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      settings: { enabled: true, readTranslation: { enabled: true, cache: true }, model: { targetLanguage: "简体中文" } },
      nativeApi: { translate: async ({ text }) => ({ ok: true, text: "T:" + text }) }
    });

    await __test.translateMessage(message);

    const blocks = Array.from(message.querySelectorAll(".dtm-translation-block"));
    const bodyBlock = blocks.find(b => b.dataset.dtmUnit === "content");
    const quoteBlock = blocks.find(b => b.dataset.dtmUnit === "quote");

    assert.equal(blocks.length, 2);
    // The bug: the body must be translated (not the quoted preview).
    assert.equal(bodyBlock.textContent, "T:my reply body");
    assert.equal(quoteBlock.textContent, "T:original quoted text");
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("translation position places each translation above or below its own source", async () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  const message = new FakeElement("div", "", rect(0, 0, 600, 160));
  message.id = "chat-messages-position-1";
  const quote = new FakeElement("div", "", rect(0, 0, 400, 20));
  quote.className = "repliedMessage__abc";
  const quoteText = new FakeElement("div", "quoted", rect(0, 0, 380, 16));
  quoteText.className = "repliedTextContent__abc";
  quote.appendChild(quoteText);
  const contentWrap = new FakeElement("div", "", rect(0, 24, 400, 50));
  contentWrap.className = "contents__abc";
  const content = new FakeElement("div", "body", rect(0, 24, 400, 24));
  content.className = "messageContent__abc";
  contentWrap.appendChild(content);
  message.append(quote, contentWrap);
  document.appendChild(message);

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        model: { targetLanguage: "简体中文" },
        style: { position: "above" }
      },
      nativeApi: { translate: async ({ text }) => ({ ok: true, text: "T:" + text }) }
    });

    await __test.translateMessage(message);
    const quoteBlock = message.querySelector("[data-dtm-unit='quote']");
    const bodyBlock = message.querySelector("[data-dtm-unit='content']");
    assert.equal(quote.previousElementSibling, quoteBlock);
    assert.equal(content.previousElementSibling, bodyBlock);

    __test.setRuntimeForTests({ settings: { style: { position: "below" } } });
    __test.refreshTranslationStyles();
    assert.equal(quote.nextElementSibling, quoteBlock);
    assert.equal(message.children[message.children.length - 1], bodyBlock);
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
        sendBox: { opacity: 0.7 },
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
    assert.equal(box.style.opacity, "0.7");
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
  assert.ok(source.includes('inputField("自定义提示词", "textarea"'));
  assert.ok(source.includes('customPromptHost.closest("[data-dtm-native-setting-row=\'true\']")'));
  assert.ok(source.includes("if (row) row.style.display = display;"));
  assert.ok(source.includes('toggleRow("回车后自动发送"'));
  assert.ok(source.includes('selectField("输入框透明度"'));
  assert.ok(source.includes("applySendBoxOpacity"));
  assert.ok(source.includes("(document.body || document.documentElement).appendChild(box)"));
  assert.ok(source.includes("function findDiscordComposerMount"));
  assert.ok(source.includes("[class*='channelTextArea']"));
  assert.equal(source.includes("mount.parentElement.insertBefore(box, mount)"), false);
});

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

  createTextNode(text) {
    return new FakeElement("#text", text);
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

  get lastElementChild() { return this.children.at(-1) || null; }

  get isConnected() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node instanceof FakeDocument;
  }

  focus() { global.document.activeElement = this; }

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
    const parent = this.parentElement;
    if (!parent) return null;
    if (element.parentElement) element.remove();
    const siblings = parent.children;
    const index = siblings.indexOf(this);
    element.parentElement = parent;
    if (position === "beforebegin") siblings.splice(index, 0, element);
    else if (position === "afterend") siblings.splice(index + 1, 0, element);
    else assert.fail(`unsupported insertAdjacentElement position: ${position}`);
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
  if (selector === "[data-dtm-control-id]") return Boolean(node.dataset.dtmControlId);
  if (selector === "[data-dtm-section-key]") return Boolean(node.dataset.dtmSectionKey);
  if (selector === "[data-dtm-hidden='true']") return node.dataset.dtmHidden === "true";
  if (selector === "[data-dtm-header-title='true']") return node.dataset.dtmHeaderTitle === "true";

  const roleMatch = selector.match(/^\[role='([^']+)'\]$/);
  if (roleMatch) return node.getAttribute("role") === roleMatch[1];

  const classMatch = selector.match(/^\[class\*='([^']+)'\]$/);
  if (classMatch) return node.className.includes(classMatch[1]);

  const idPrefixMatch = selector.match(/^\[id\^='([^']+)'\]$/);
  if (idPrefixMatch) return String(node.id || "").startsWith(idPrefixMatch[1]);

  const dataContainsMatch = selector.match(/^\[data-([a-z0-9-]+)\*='([^']+)'\]$/i);
  if (dataContainsMatch) {
    const key = dataContainsMatch[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    return String(node.dataset[key] || "").includes(dataContainsMatch[2]);
  }

  const dataMatch = selector.match(/^\[data-([a-z0-9-]+)='([^']+)'\]$/i);
  if (dataMatch) {
    const key = dataMatch[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    return node.dataset[key] === dataMatch[2];
  }

  return false;
}

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function chatMessage(channelId, snowflake, text, contentClass = "messageContent__auto") {
  const message = new FakeElement("div", "", rect(0, 0, 600, 80));
  message.id = `chat-messages-${channelId}-${snowflake}`;
  const content = new FakeElement("div", text, rect(0, 0, 400, 24));
  content.className = contentClass;
  message.appendChild(content);
  return message;
}

function snowflakeAt(timestamp, increment = 0) {
  return (((BigInt(timestamp) - 1420070400000n) << 22n) | BigInt(increment)).toString();
}

function autoTranslateClock(t) {
  const clock = { now: Date.UTC(2026, 8, 5, 12) };
  t.mock.method(Date, "now", () => clock.now);
  return clock;
}

test("auto-translate only touches messages newer than the moment it was enabled", async t => {
  const clock = autoTranslateClock(t);
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  // An existing message present when auto-translate is switched on (the baseline).
  const existing = chatMessage("100", snowflakeAt(clock.now - 1000), "Old message");
  document.appendChild(existing);

  let requests = 0;
  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      channelId: "100",
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        autoTranslate: { enabled: true, skipSameLanguage: true },
        model: { targetLanguage: "简体中文" }
      },
      nativeApi: {
        translate: async ({ text }) => {
          requests += 1;
          return { ok: true, text: "T:" + text };
        }
      }
    });

    // First run in the channel pins the baseline; the existing backlog is left alone.
    __test.runAutoTranslate();
    await flushMicrotasks();
    assert.equal(existing.querySelectorAll(".dtm-translation-block").length, 0);

    // A genuinely new message arrives (higher snowflake) in this channel.
    clock.now += 1000;
    const fresh = chatMessage("100", snowflakeAt(clock.now), "Hi there");
    document.appendChild(fresh);
    __test.runAutoTranslate();
    await flushMicrotasks();

    assert.equal(requests, 1);
    assert.equal(fresh.querySelectorAll(".dtm-translation-block").length, 1);
    assert.equal(existing.querySelectorAll(".dtm-translation-block").length, 0);
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("auto-translate skips a message already written in the target language", async t => {
  const clock = autoTranslateClock(t);
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  const baseline = chatMessage("200", snowflakeAt(clock.now - 1000), "baseline");
  document.appendChild(baseline);

  let requests = 0;
  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      channelId: "200",
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        autoTranslate: { enabled: true, skipSameLanguage: true },
        model: { targetLanguage: "简体中文" }
      },
      nativeApi: {
        translate: async () => {
          requests += 1;
          return { ok: true, text: "should not run" };
        }
      }
    });

    // Pin the baseline, then a new Chinese message arrives.
    __test.runAutoTranslate();
    clock.now += 1000;
    const chineseMessage = chatMessage("200", snowflakeAt(clock.now), "你好，今天过得怎么样？");
    document.appendChild(chineseMessage);
    __test.runAutoTranslate();
    await flushMicrotasks();

    assert.equal(requests, 0);
    assert.equal(chineseMessage.querySelectorAll(".dtm-translation-block").length, 0);
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("auto-translate stays off when the global setting is disabled", async t => {
  const clock = autoTranslateClock(t);
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  document.appendChild(chatMessage("abc", snowflakeAt(clock.now - 1000), "baseline"));

  let requests = 0;
  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      channelId: "abc",
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        autoTranslate: { enabled: false, skipSameLanguage: true },
        model: { targetLanguage: "简体中文" }
      },
      nativeApi: { translate: async () => { requests += 1; return { ok: true, text: "x" }; } }
    });

    // Even a brand-new message is ignored while the global setting is off.
    clock.now += 1000;
    const fresh = chatMessage("abc", snowflakeAt(clock.now), "Hi there");
    document.appendChild(fresh);
    __test.runAutoTranslate();
    __test.runAutoTranslate();
    await flushMicrotasks();

    assert.equal(requests, 0);
    assert.equal(fresh.querySelectorAll(".dtm-translation-block").length, 0);
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("snowflake timestamps use the Discord epoch and ignore worker and sequence bits", () => {
  const timestamp = Date.UTC(2026, 8, 5, 12);
  assert.equal(__test.snowflakeTimestamp(snowflakeAt(timestamp)), timestamp);
  assert.equal(__test.snowflakeTimestamp(snowflakeAt(timestamp, 0x3fffff)), timestamp);
  assert.equal(__test.snowflakeTimestamp(snowflakeAt(timestamp + 1)), timestamp + 1);
  assert.equal(__test.snowflakeTimestamp(""), 0);
});

test("auto-translate never translates the backlog when messages render after it is enabled", async t => {
  const clock = autoTranslateClock(t);
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  let requests = 0;
  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      channelId: "300",
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        autoTranslate: { enabled: true },
        model: { targetLanguage: "简体中文" }
      },
      nativeApi: {
        translate: async ({ text }) => { requests += 1; return { ok: true, text: "T:" + text }; }
      }
    });

    // Auto-translate is on but the channel hasn't rendered any messages yet.
    __test.runAutoTranslate();
    await flushMicrotasks();

    // The backlog now renders. Both messages predate enabling auto-translate.
    const backlogA = chatMessage("300", snowflakeAt(clock.now - 2000), "backlog one");
    const backlogB = chatMessage("300", snowflakeAt(clock.now - 1000), "backlog two");
    document.appendChild(backlogA);
    document.appendChild(backlogB);
    __test.runAutoTranslate();
    await flushMicrotasks();
    assert.equal(requests, 0);
    assert.equal(backlogA.querySelectorAll(".dtm-translation-block").length, 0);
    assert.equal(backlogB.querySelectorAll(".dtm-translation-block").length, 0);

    // Only a genuinely newer message gets translated.
    clock.now += 1000;
    const fresh = chatMessage("300", snowflakeAt(clock.now), "fresh hi");
    document.appendChild(fresh);
    __test.runAutoTranslate();
    await flushMicrotasks();
    assert.equal(requests, 1);
    assert.equal(fresh.querySelectorAll(".dtm-translation-block").length, 1);
    assert.equal(backlogA.querySelectorAll(".dtm-translation-block").length, 0);
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("cache is keyed by text, so identical text in different messages hits the model once", async () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  // Two DIFFERENT messages (different ids) with the SAME text.
  const a = new FakeElement("div", "", rect(0, 0, 600, 80));
  a.id = "chat-messages-1-1000000000000000000";
  const ac = new FakeElement("div", "lol", rect(0, 0, 400, 24));
  ac.className = "messageContent__a";
  a.appendChild(ac);
  const b = new FakeElement("div", "", rect(0, 0, 600, 80));
  b.id = "chat-messages-1-2000000000000000000";
  const bc = new FakeElement("div", "lol", rect(0, 0, 400, 24));
  bc.className = "messageContent__b";
  b.appendChild(bc);
  document.append(a, b);

  let requests = 0;
  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        model: { targetLanguage: "简体中文" }
      },
      nativeApi: { translate: async () => { requests += 1; return { ok: true, text: "笑死" }; } }
    });

    await __test.translateMessage(a);
    await __test.translateMessage(b);

    assert.equal(requests, 1); // second message's identical text was served from cache
    assert.equal(a.querySelectorAll(".dtm-translation-block")[0].textContent, "笑死");
    assert.equal(b.querySelectorAll(".dtm-translation-block")[0].textContent, "笑死");
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test("auto-translate caps concurrent model calls via the queue", async t => {
  const clock = autoTranslateClock(t);
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  document.appendChild(chatMessage("q", snowflakeAt(clock.now - 1000), "baseline"));

  let active = 0;
  let peak = 0;
  let calls = 0;
  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      channelId: "q",
      settings: {
        enabled: true,
        readTranslation: { enabled: true, cache: true },
        autoTranslate: { enabled: true },
        model: { targetLanguage: "简体中文" }
      },
      nativeApi: {
        translate: () => {
          calls += 1;
          active += 1;
          peak = Math.max(peak, active);
          return new Promise(resolve => setTimeout(() => { active -= 1; resolve({ ok: true, text: "T" }); }, 5));
        }
      }
    });

    __test.runAutoTranslate();            // pins the baseline
    clock.now += 1000;
    for (let i = 0; i < 6; i += 1) {
      document.appendChild(chatMessage("q", snowflakeAt(clock.now, i), "msg" + i));
    }
    __test.runAutoTranslate();            // enqueues all six
    await waitMs(120);

    assert.equal(calls, 6);               // every new message was translated
    assert.ok(peak <= 2, `peak concurrency ${peak} should be <= 2`);
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("translating a reply does not bleed its translation onto the original quoted message", async () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();

  // The original standalone message, whose text equals the reply's quoted preview.
  const original = new FakeElement("div", "", rect(0, 0, 600, 40));
  original.id = "chat-messages-100-1000000000000000000";
  const originalContent = new FakeElement("div", "original quoted text", rect(0, 0, 400, 24));
  originalContent.className = "messageContent__o";
  original.appendChild(originalContent);

  // The reply: a quoted preview (same text) plus its own body.
  const reply = new FakeElement("div", "", rect(0, 50, 600, 120));
  reply.id = "chat-messages-100-2000000000000000000";
  const quote = new FakeElement("div", "", rect(0, 50, 400, 20));
  quote.className = "repliedMessage__r";
  const quoteText = new FakeElement("div", "original quoted text", rect(0, 50, 380, 16));
  quoteText.className = "repliedTextContent__r";
  quote.appendChild(quoteText);
  const replyBody = new FakeElement("div", "my reply body", rect(0, 74, 400, 24));
  replyBody.className = "messageContent__r";
  reply.append(quote, replyBody);

  document.append(original, reply);

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      settings: { enabled: true, readTranslation: { enabled: true, cache: true }, model: { targetLanguage: "简体中文" } },
      nativeApi: { translate: async ({ text }) => ({ ok: true, text: "T:" + text }) }
    });

    // Only the reply is translated (2 blocks: quote + body).
    await __test.translateMessage(reply);
    assert.equal(reply.querySelectorAll(".dtm-translation-block").length, 2);

    // The cache now holds the quote text's translation. A restore pass must NOT add a
    // block to the original message just because it shares that text.
    __test.restoreVisibleTranslations();
    assert.equal(original.querySelectorAll(".dtm-translation-block").length, 0);
    assert.equal(reply.querySelectorAll(".dtm-translation-block").length, 2);
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

test("pre-translating the quoted original still lets a later double-click translate the reply body", async () => {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();

  const original = new FakeElement("div", "", rect(0, 0, 600, 40));
  original.id = "chat-messages-100-1000000000000000000";
  const originalContent = new FakeElement("div", "hello", rect(0, 0, 400, 24));
  originalContent.className = "messageContent__o";
  original.appendChild(originalContent);

  const reply = new FakeElement("div", "", rect(0, 50, 600, 120));
  reply.id = "chat-messages-100-2000000000000000000";
  const quote = new FakeElement("div", "", rect(0, 50, 400, 20));
  quote.className = "repliedMessage__r";
  const quoteText = new FakeElement("div", "hello", rect(0, 50, 380, 16));
  quoteText.className = "repliedTextContent__r";
  quote.appendChild(quoteText);
  const replyBody = new FakeElement("div", "my reply body", rect(0, 74, 400, 24));
  replyBody.className = "messageContent__r";
  reply.append(quote, replyBody);

  document.append(original, reply);

  try {
    global.document = document;
    global.Element = FakeElement;
    __test.setRuntimeForTests({
      settings: { enabled: true, readTranslation: { enabled: true, cache: true }, model: { targetLanguage: "简体中文" } },
      nativeApi: { translate: async ({ text }) => ({ ok: true, text: "T:" + text }) }
    });

    // 1) Translate the original (quoted) message first → caches "hello".
    await __test.translateMessage(original);
    // A maintenance/restore pass — must NOT pre-seed a block onto the reply.
    __test.restoreVisibleTranslations();
    assert.equal(reply.querySelectorAll(".dtm-translation-block").length, 0, "reply must be clean before its own double-click");

    // 2) Now double-click the reply.
    __test.onMessageDoubleClick({ target: replyBody, preventDefault() {}, stopPropagation() {} });
    await flushMicrotasks();
    await flushMicrotasks();

    const blocks = Array.from(reply.querySelectorAll(".dtm-translation-block"));
    const body = blocks.find(b => b.dataset.dtmUnit === "content");
    const q = blocks.find(b => b.dataset.dtmUnit === "quote");
    assert.equal(blocks.length, 2, "reply should get BOTH quote and body translations");
    assert.equal(body && body.textContent, "T:my reply body", "the reply body must be translated");
    assert.equal(q && q.textContent, "T:hello", "the quote translation comes from cache");
  } finally {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  }
});

function readingRuntime(t, runtime) {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const document = new FakeDocument();
  global.document = document;
  global.Element = FakeElement;
  __test.setRuntimeForTests(runtime);
  t.after(() => {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
  });
  return document;
}

function deferredTranslation() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sendingRuntime(t, api = {}, autoSend = false) {
  const document = readingRuntime(t, {
    settings: { sendTranslation: { enabled: true, enterToSend: autoSend } },
    nativeApi: { beginSend: async () => 1, cancelSend: async () => {}, insertAndSend: async () => ({ ok: true, sent: autoSend }), ...api }
  });
  const previousWindow = global.window;
  const previousLocation = global.location;
  global.window = { location: { pathname: "/channels/1/2" }, innerWidth: 1200, innerHeight: 800, addEventListener() {} };
  global.location = global.window.location;
  t.after(() => { global.window = previousWindow; global.location = previousLocation; });
  const mount = new FakeElement("div", "", rect(300, 650, 600, 60));
  mount.className = "channelTextArea__test";
  const editor = new FakeElement("div");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("contenteditable", "true");
  mount.appendChild(editor);
  document.appendChild(mount);
  __test.ensureSendBox();
  const box = document.getElementById("dtm-send-box");
  const input = box.querySelector("input");
  input.value = "Original text";
  const keydown = options => input.listeners.get("keydown")({ key: "Enter", preventDefault() {}, stopPropagation() {}, ...options });
  return { document, box, input, editor, keydown };
}

test("send box maintenance leaves an unchanged hint and transient errors alone", t => {
  const { box } = sendingRuntime(t);
  const status = box.querySelector("span");
  let writes = 0;
  let text = status.textContent;
  Object.defineProperty(status, "textContent", { get: () => text, set: value => { text = value; writes++; } });
  for (let i = 0; i < 10; i++) __test.ensureSendBox();
  assert.equal(writes, 0);
  status.textContent = "Test error";
  __test.ensureSendBox();
  assert.equal(status.textContent, "Test error");
  assert.equal(writes, 1);
});

test("IME confirmation and repeated Enter do not start send translations", async t => {
  let calls = 0;
  const { keydown, input } = sendingRuntime(t, { translate: async () => { calls++; return { text: "T" }; } });
  await keydown({ isComposing: true });
  await keydown({ keyCode: 229 });
  input.readOnly = true;
  await keydown({});
  assert.equal(calls, 0);
});

test("send input consumes Enter before yielding and remains focusable while translating", async t => {
  const pending = deferredTranslation();
  let calls = 0;
  const { input, keydown } = sendingRuntime(t, { translate: () => { calls++; return pending.promise; } });
  let stopped = false;
  const sending = keydown({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(input.readOnly, true);
  assert.notEqual(input.disabled, true);
  await keydown({});
  await flushMicrotasks();
  assert.equal(calls, 1);
  pending.resolve({ text: "Translation" });
  await sending;
  assert.equal(input.readOnly, false);
});

test("rejected or composing Enter never reaches Discord's global send shortcut", async t => {
  const { keydown, input } = sendingRuntime(t, { beginSend: async () => { throw new Error("已有草稿"); } });
  for (const options of [{}, { isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
    let stopped = false;
    await keydown({ ...options, stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(input.value, "Original text");
  }
  assert.equal(input.readOnly, false);
});

test("changing channels during a send translation preserves source and never inserts", async t => {
  const pending = deferredTranslation();
  let inserted = 0;
  const { keydown, input, document } = sendingRuntime(t, {
    translate: () => pending.promise,
    insertAndSend: async () => { inserted++; return { ok: true }; }
  });
  const sending = keydown({});
  await flushMicrotasks();
  global.window.location.pathname = "/channels/1/3";
  pending.resolve({ text: "Translation" });
  await sending;
  assert.equal(inserted, 0);
  assert.equal(input.value, "Original text");
  assert.notEqual(document.activeElement, input);
  assert.equal(input.readOnly, false);
});

test("failed native insertion preserves the send translation source", async t => {
  const { keydown, input, box } = sendingRuntime(t, {
    translate: async () => ({ text: "Translation" }),
    insertAndSend: async () => { throw new Error("Test insertion failed"); }
  });
  await keydown({});
  assert.equal(input.value, "Original text");
  assert.equal(input.readOnly, false);
  assert.equal(box.querySelector("span").dataset.error, "true");
});

for (const autoSend of [false, true]) {
  test(`send translation keeps auto-send=${autoSend} bound to its captured composer`, async t => {
    const requests = [];
    let mode;
    const { keydown, input } = sendingRuntime(t, {
      beginSend: async send => { mode = send; return 1; },
      translate: async () => ({ text: "Translation" }),
      insertAndSend: async request => { requests.push(request); return { ok: true, sent: mode }; }
    }, autoSend);
    await keydown({});
    assert.deepEqual(requests, [{ id: 1, text: "Translation" }]);
    assert.equal(mode, autoSend);
    assert.equal(input.value, "");
  });
}

test("auto-translate ignores newer history while browsing old records", async t => {
  const clock = autoTranslateClock(t);
  const calls = [];
  const document = readingRuntime(t, {
    channelId: "100",
    settings: { autoTranslate: { enabled: true } },
    nativeApi: { translate: async ({ text }) => { calls.push(text); return { text: `T:${text}` }; } }
  });
  document.append(chatMessage("100", snowflakeAt(clock.now - 86400000), "yesterday"));
  __test.runAutoTranslate();
  const history = chatMessage("100", snowflakeAt(clock.now - 1000), "recent history");
  const boundary = chatMessage("100", snowflakeAt(clock.now, 4095), "already here at enabling time");
  clock.now += 1000;
  const fresh = chatMessage("100", snowflakeAt(clock.now), "new arrival");
  document.append(history, boundary, fresh);
  __test.runAutoTranslate();
  await flushMicrotasks();
  assert.deepEqual(calls, ["new arrival"]);
  assert.equal(history.querySelector(".dtm-translation-block"), null);
  assert.equal(boundary.querySelector(".dtm-translation-block"), null);
});

test("auto-translate starts its clock on enabling before the first rendered message", async t => {
  const clock = autoTranslateClock(t);
  const calls = [];
  const document = readingRuntime(t, {
    channelId: "100",
    settings: { autoTranslate: { enabled: true } },
    nativeApi: { translate: async ({ text }) => { calls.push(text); return { text }; } }
  });
  __test.applyAutoTranslateSettings();
  const history = chatMessage("100", snowflakeAt(clock.now - 1000), "history");
  clock.now += 1000;
  const fresh = chatMessage("100", snowflakeAt(clock.now), "new while loading");
  clock.now += 1000;
  document.append(history, fresh);
  __test.runAutoTranslate();
  await flushMicrotasks();
  assert.deepEqual(calls, ["new while loading"]);
  assert.equal(history.querySelector(".dtm-translation-block"), null);
});

test("auto-translate resets the time baseline when returning to a channel", async t => {
  const clock = autoTranslateClock(t);
  const calls = [];
  const document = readingRuntime(t, {
    channelId: "100",
    settings: { autoTranslate: { enabled: true } },
    nativeApi: { translate: async ({ text }) => { calls.push(text); return { text }; } }
  });
  const previousLocation = global.location;
  t.after(() => {
    if (previousLocation) global.location = previousLocation;
    else delete global.location;
  });
  document.append(chatMessage("100", snowflakeAt(clock.now - 1000), "old channel history"));
  __test.runAutoTranslate();
  clock.now += 1000;
  global.location = { pathname: "/channels/guild/200" };
  __test.syncCurrentChannel();
  document.append(chatMessage("100", snowflakeAt(clock.now), "arrived while away"));
  clock.now += 1000;
  global.location.pathname = "/channels/guild/100";
  __test.syncCurrentChannel();
  __test.runAutoTranslate();
  await flushMicrotasks();
  assert.deepEqual(calls, []);
  clock.now += 1000;
  document.append(chatMessage("100", snowflakeAt(clock.now), "arrived after returning"));
  __test.runAutoTranslate();
  await flushMicrotasks();
  assert.deepEqual(calls, ["arrived after returning"]);
});

test("auto-translate re-enabling excludes messages from the disabled interval", async t => {
  const clock = autoTranslateClock(t);
  const calls = [];
  const document = readingRuntime(t, {
    channelId: "100",
    settings: { autoTranslate: { enabled: true } },
    nativeApi: { translate: async ({ text }) => { calls.push(text); return { text }; } }
  });
  document.append(chatMessage("100", snowflakeAt(clock.now - 1000), "old history"));
  __test.runAutoTranslate();
  const config = __test.getSettingsForTests();
  config.autoTranslate.enabled = false;
  __test.applyAutoTranslateSettings();
  clock.now += 1000;
  const missed = chatMessage("100", snowflakeAt(clock.now), "arrived while disabled");
  clock.now += 1000;
  config.autoTranslate.enabled = true;
  __test.applyAutoTranslateSettings();
  __test.runAutoTranslate();
  clock.now += 1000;
  document.append(missed, chatMessage("100", snowflakeAt(clock.now), "arrived after enabling"));
  __test.runAutoTranslate();
  await flushMicrotasks();
  assert.deepEqual(calls, ["arrived after enabling"]);
});

test("reading translation cache does not collide for Tell Aa now. and Tell BB now.", async t => {
  const calls = [];
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: { translate: async ({ text }) => { calls.push(text); return { text: `T:${text}` }; } }
  });
  const a = chatMessage("100", "1", "Tell Aa now.");
  const b = chatMessage("100", "2", "Tell BB now.");
  document.append(a, b);
  await __test.translateMessage(a);
  await __test.translateMessage(b);
  assert.deepEqual(calls, ["Tell Aa now.", "Tell BB now."]);
  assert.equal(b.querySelector(".dtm-translation-block").textContent, "T:Tell BB now.");
});

test("reading translation cache key hashes the complete effective model and shared messages", t => {
  const { createHash } = require("node:crypto");
  const { normalizeSettings } = require("../src/shared/settings");
  const { buildTranslationMessages, resolveModelConfig } = require("../src/shared/translate");
  const config = normalizeSettings({
    model: { provider: "custom", baseUrl: "https://first.invalid/v1", modelId: "model:a", targetLanguage: "English" },
    translationStyle: "custom",
    customPrompt: "Tell Aa now."
  });
  readingRuntime(t, { settings: config, nativeApi: {} });
  const unit = { text: "source:text" };
  const key = __test.getUnitCacheKey(unit);
  const expected = createHash("sha256").update(JSON.stringify({
    model: resolveModelConfig(config.model),
    messages: buildTranslationMessages({ text: unit.text, direction: "read", settings: config })
  })).digest("hex");
  assert.equal(key, expected);
  for (const changed of [
    { ...config, model: { ...config.model, baseUrl: "https://second.invalid/v1" } },
    { ...config, model: { ...config.model, modelId: "model:b" } },
    { ...config, model: { ...config.model, provider: "openai" } },
    { ...config, model: { ...config.model, targetLanguage: "French" } },
    { ...config, translationStyle: "natural" },
    { ...config, customPrompt: "Tell BB now." }
  ]) {
    __test.setRuntimeForTests({ settings: changed });
    assert.notEqual(__test.getUnitCacheKey(unit), key);
  }
});

test("reading translation merges concurrent identical requests", async t => {
  const pending = deferredTranslation();
  let calls = 0;
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: { translate: () => { calls += 1; return pending.promise; } }
  });
  const a = chatMessage("100", "1", "same text");
  const b = chatMessage("100", "2", "same text");
  document.append(a, b);
  const tasks = [__test.translateMessage(a), __test.translateMessage(b)];
  pending.resolve({ text: "shared result" });
  await Promise.all(tasks);
  assert.equal(calls, 1);
  for (const message of [a, b]) assert.equal(message.querySelector(".dtm-translation-block").textContent, "shared result");
});

test("reading translation separates custom endpoints without clearing existing cache", async t => {
  const calls = [];
  const pending = deferredTranslation();
  const document = readingRuntime(t, {
    settings: { model: { provider: "custom", baseUrl: "https://first.invalid/v1" } },
    nativeApi: { translate: () => {
      const endpoint = __test.getSettingsForTests().model.baseUrl;
      calls.push(endpoint);
      return endpoint.includes("first") ? pending.promise : Promise.resolve({ text: "second" });
    } }
  });
  const a = chatMessage("100", "1", "same text");
  const b = chatMessage("100", "2", "same text");
  document.append(a, b);
  const first = __test.translateMessage(a);
  __test.getSettingsForTests().model.baseUrl = "https://second.invalid/v1";
  const second = __test.translateMessage(b);
  pending.resolve({ text: "first" });
  await Promise.all([first, second]);
  assert.equal(b.querySelector(".dtm-translation-block").textContent, "second");
  __test.getSettingsForTests().model.baseUrl = "https://first.invalid/v1";
  await __test.translateMessage(b);
  assert.equal(b.querySelector(".dtm-translation-block").textContent, "first");
  assert.deepEqual(calls, ["https://first.invalid/v1", "https://second.invalid/v1"]);
});

test("reading translation hiding one subscriber leaves a shared request usable by another", async t => {
  const pending = deferredTranslation();
  let calls = 0;
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: { translate: () => { calls += 1; return pending.promise; } }
  });
  const a = chatMessage("100", "1", "same text");
  const b = chatMessage("100", "2", "same text");
  document.append(a, b);
  const tasks = [__test.translateMessage(a), __test.translateMessage(b)];
  __test.onMessageDoubleClick({ target: a.children[0], preventDefault() {}, stopPropagation() {} });
  pending.resolve({ text: "shared result" });
  await Promise.all(tasks);
  __test.restoreVisibleTranslations();
  assert.equal(calls, 1);
  assert.equal(a.querySelector(".dtm-translation-block"), null);
  assert.equal(b.querySelector(".dtm-translation-block").textContent, "shared result");
});

test("reading translation retries after a shared request fails", async t => {
  const pending = deferredTranslation();
  let calls = 0;
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: { translate: () => ++calls === 1 ? pending.promise : Promise.resolve({ text: "retry" }) }
  });
  const a = chatMessage("100", "1", "same text");
  const b = chatMessage("100", "2", "same text");
  document.append(a, b);
  const tasks = [__test.translateMessage(a), __test.translateMessage(b)];
  pending.reject(new Error("test failure"));
  await Promise.all(tasks);
  assert.equal(a.querySelector(".dtm-translation-block").dataset.dtmError, "true");
  assert.equal(b.querySelector(".dtm-translation-block").dataset.dtmError, "true");
  await __test.translateMessage(a);
  assert.equal(calls, 2);
  assert.equal(a.querySelector(".dtm-translation-block").textContent, "retry");
});

test("reading translation cache clear prevents in-flight results from refilling it", async t => {
  const pending = deferredTranslation();
  const saves = [];
  let calls = 0;
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: {
      translate: () => ++calls === 1 ? pending.promise : Promise.resolve({ text: "fresh" }),
      saveCache: async value => { saves.push(value); }
    }
  });
  const message = chatMessage("100", "1", "same text");
  document.append(message);
  const task = __test.translateMessage(message);
  await __test.clearTranslationCache();
  pending.resolve({ text: "old" });
  await task;
  assert.equal(message.querySelector(".dtm-translation-block").textContent, "old", "clearing cache does not hide a requested translation");
  await __test.translateMessage(message);
  assert.equal(calls, 2);
  assert.equal(message.querySelector(".dtm-translation-block").textContent, "fresh");
  assert.deepEqual(saves, [{}]);
});

test("reading translation cache clear separates old and new in-flight generations", async t => {
  const oldRequest = deferredTranslation();
  const newRequest = deferredTranslation();
  let calls = 0;
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: { translate: () => ++calls === 1 ? oldRequest.promise : newRequest.promise }
  });
  const messages = [1, 2, 3].map(id => chatMessage("100", String(id), "same text"));
  document.append(...messages);
  const oldTask = __test.translateMessage(messages[0]);
  await __test.clearTranslationCache();
  const newTask = __test.translateMessage(messages[1]);
  oldRequest.resolve({ text: "old" });
  await oldTask;
  const sharedTask = __test.translateMessage(messages[2]);
  newRequest.resolve({ text: "fresh" });
  await Promise.all([newTask, sharedTask]);
  assert.equal(calls, 2);
  assert.equal(messages[2].querySelector(".dtm-translation-block").textContent, "fresh");
});

test("reading translation cache clear also invalidates a pending disk load", async t => {
  const pending = deferredTranslation();
  let calls = 0;
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: {
      loadCache: () => pending.promise,
      translate: async () => { calls += 1; return { text: "fresh" }; }
    }
  });
  const message = chatMessage("100", "1", "same text");
  document.append(message);
  const loading = __test.loadPersistedCache();
  await __test.clearTranslationCache();
  pending.resolve({ [__test.getUnitCacheKey({ text: "same text" })]: "old" });
  await loading;
  await __test.translateMessage(message);
  assert.equal(calls, 1);
  assert.equal(message.querySelector(".dtm-translation-block").textContent, "fresh");
});

for (const automatic of [false, true]) {
  for (const reject of [false, true]) {
    test(`reading translation hide cancels the entire ${automatic ? "automatic" : "manual"} reply after ${reject ? "failure" : "success"}`, async t => {
      const pending = deferredTranslation();
      const calls = [];
      const document = readingRuntime(t, {
        settings: {},
        nativeApi: { translate: ({ text }) => {
          calls.push(text);
          return text === "quoted text" ? pending.promise : Promise.resolve({ text: "body result" });
        } }
      });
      const message = chatMessage("100", "1", "reply body");
      const content = message.children[0];
      const quote = new FakeElement("div", "quoted text", rect(0, 0, 400, 20));
      quote.className = "repliedMessage__cancel";
      message.prepend(quote);
      document.append(message);
      const task = automatic ? __test.autoTranslateMessage(message) : __test.translateMessage(message);
      __test.onMessageDoubleClick({ target: content, preventDefault() {}, stopPropagation() {} });
      if (reject) pending.reject(new Error("test failure"));
      else pending.resolve({ text: "quote result" });
      await task;
      __test.restoreVisibleTranslations();
      assert.deepEqual(calls, ["quoted text"], "hiding a pending quote must not start the reply body");
      assert.equal(message.querySelectorAll(".dtm-translation-block").length, 0);
    });
  }
}
