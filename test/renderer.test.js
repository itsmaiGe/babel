"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { __test } = require("../src/mod/renderer");

function setReadingRuntime(runtime) {
  runtime=runtime||{};
  const originalApi=runtime.nativeApi||{};
  const {TranslationService}=require("../src/mod/core/translation-service");
  const cache={entries:new Map(),generation:0,ready:Promise.resolve(),get(key){return this.entries.get(key)},put(key,text,generation){if(this.generation===generation)this.entries.set(key,text)},clear(){this.generation++;this.entries.clear();return Promise.resolve(originalApi.saveCache?.({}))}};
  const service=new TranslationService({snapshot:()=>({settings:JSON.parse(JSON.stringify(__test.getSettingsForTests())),executionRevision:1}),credential:model=>({apiKey:"",namespace:model.baseUrl}),cache,
    provider:{translate:async request=>{const result=await originalApi.translate?.(request);return result?.text||"";}}});
  const api={...originalApi,translate:request=>service.translate(1,request),cancel:request=>service.cancel(1,request.requestIds),clearCache:()=>cache.clear()};
  __test.setRuntimeForTests({...runtime,nativeApi:api});
}

test("automatic translation colors follow the theme without a background and contrast with custom bubbles", () => {
  const theme = __test.translationPreviewStyle({ background: false, textColor: "auto" }, false);
  assert.match(theme.color, /var\(--text-default/);
  assert.equal(theme.backgroundColor, "transparent");
  assert.equal(__test.translationPreviewStyle({ backgroundColor: "#f2f3f5", textColor: "auto" }).color, "#111827");
  assert.equal(__test.translationPreviewStyle({ backgroundColor: "#303446", textColor: "auto" }).color, "#f2f3f5");
  assert.equal(__test.translationPreviewStyle({ background: false, textColor: "#ff0000" }).color, "#ff0000");
  assert.match(__test.translationPreviewStyle({ backgroundColor: "auto", textColor: "auto" }).backgroundColor, /var\(/);
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
  global.window.setInterval = () => 0;
  global.window.clearInterval = () => {};
  global.window.location = { pathname: "/channels/test/channel" };
  global.window.MutationObserver = class { observe() {} disconnect() {} };
  global.window.addEventListener("dtm:unmount-controls", event => events.push(event.detail));
  for (const key of ["general", "model", "read", "style"]) {
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
  for (const key of ["general", "model", "read", "style"]) {
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

test("delayed duplicate bridge messages do not repeat renderer handler effects", t => {
  settingsRuntime(t);
  let effects = 0;
  const field = __test.toggleRow("Test", false, () => { effects += 1; });
  const id = field.dataset.dtmControlId;
  const deliver = (messageId, transport) => {
    const detail = { id, value: true, __dtmMessageId: `dtm-main-${messageId}` };
    if (transport === "event") {
      global.window.dispatchEvent(new CustomEvent("dtm:control-change", { detail }));
      return;
    }
    const message = new Event("message");
    Object.defineProperty(message, "data", {
      value: { source: "dtm", type: "dtm:control-change", detail },
    });
    Object.defineProperty(message, "source", { value: global.window });
    global.window.dispatchEvent(message);
  };
  deliver(1, "event");
  deliver(1, "message");
  assert.equal(effects, 1);
  for (let messageId = 2; messageId <= 1001; messageId += 1) deliver(messageId, "event");
  const afterBoundary = effects;
  deliver(1001, "message");
  deliver(1, "message");
  assert.equal(effects, afterBoundary);
  assert.equal(effects, 1001);
  deliver(500, "message");
  assert.equal(effects, 1001);
});

test("renderer bridge rejects malformed ids and still delivers in-window messages once", t => {
  settingsRuntime(t);
  let effects = 0;
  const field = __test.toggleRow("Test", false, () => { effects += 1; });
  const id = field.dataset.dtmControlId;
  const deliver = (messageId, transport) => {
    const detail = { id, value: true, __dtmMessageId: messageId };
    if (transport === "event") {
      global.window.dispatchEvent(new CustomEvent("dtm:control-change", { detail }));
      return;
    }
    const message = new Event("message");
    Object.defineProperty(message, "data", {
      value: { source: "dtm", type: "dtm:control-change", detail },
    });
    Object.defineProperty(message, "source", { value: global.window });
    global.window.dispatchEvent(message);
  };
  for (const messageId of ["dtm-renderer-1", "dtm-main-01", "dtm-main-1.0", "dtm-main-1e2", "dtm-main- 1", "dtm-main-+1", "legacy-or-invalid-1"]) {
    deliver(messageId, "event");
    deliver(messageId, "message");
  }
  assert.equal(effects, 0);
  for (let n = 1; n <= 5000; n += 1) {
    assert.equal(__test.acceptMainWorldMessageId("legacy-or-invalid-" + n), false);
    assert.equal(__test.acceptMainWorldMessageId(new String("dtm-main-1")), false);
  }
  assert.equal(__test.mainWorldDedupeSize(), 0);
  deliver(new String("dtm-main-1"), "event");
  assert.equal(effects, 0);
  deliver("dtm-main-5", "event");
  deliver("dtm-main-3", "message");
  deliver("dtm-main-4", "event");
  deliver("dtm-main-3", "message");
  deliver("dtm-main-5", "event");
  assert.equal(effects, 3);
  deliver("dtm-main-1", "message");
  assert.equal(effects, 4);
  for (let messageId = 6; messageId <= 1005; messageId += 1) {
    if (messageId === 800) continue;
    deliver(`dtm-main-${messageId}`, "event");
  }
  const beforeGap = effects;
  deliver("dtm-main-800", "message");
  deliver("dtm-main-800", "event");
  assert.equal(effects, beforeGap + 1);
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
  control("服务商").__dtmControlSpec.onChange("deepseek");
  const model = control("模型").__dtmControlSpec.value;
  pending.resolve({ models: [{ value: "unrelated-model", label: "Unrelated model" }] });
  await flushMicrotasks();
  assert.equal(control("模型").__dtmControlSpec.value, model);
});

test("saving captures preferences and API key together without discarding later edits", async t => {
  const pending = deferredTranslation();
  const saved = [];
  const keys = [];
  const { document } = settingsRuntime(t, {
    saveConfig: request => {keys.push(request.key);saved.push(request.settings);return pending.promise.then(()=>({...request,settingsRevision:2,executionRevision:2}));}
  });
  await __test.openSettingsPanel();
  const control = name => walk(document).find(node => node.__dtmControlSpec?.name === name);
  const save = walk(document).find(node => node.__dtmControlSpec?.label === "保存");
  control("API Key").__dtmControlSpec.onChange("test-only-original");
  const saving = save.listeners.get("click")();
  control("服务商").__dtmControlSpec.onChange("deepseek");
  control("API Key").__dtmControlSpec.onChange("test-only-new");
  const apiControl = control("API Key");
  pending.resolve({ ok: true });
  await saving;
  assert.equal(saved[0].model.provider, "openai");
  assert.equal(keys[0].value, "test-only-original");
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
    assert.equal(style.textContent.includes(".dtm-swatch-field"),false);
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("refreshModels = button(msg(\"plugin.refreshModels\"), \"secondary\")"));
  assert.ok(source.includes("testConnection = button(msg(\"plugin.testConnection\"), \"secondary\")"));
  assert.ok(source.includes("let refreshModelsInFlight = false"));
  assert.ok(source.includes("testConnectionInFlight = false"));
  assert.ok(source.includes("buttonRow([refreshModels, testConnection])"));
  assert.ok(source.includes("testConnection.setLoading(true)"));
  assert.ok(source.includes("refreshModels.setLoading(true)"));
  assert.equal(source.includes("showNativeToast(\"正在测试连接...\", \"message\")"), false);
  assert.ok(source.includes("plugin.connectionSuccess"));
  assert.equal(source.includes("showNativeToast(\"正在刷新模型...\", \"message\")"), false);
  assert.ok(source.includes("plugin.modelsRefreshed"));
  assert.equal(source.includes("showNativeToast(\"正在保存...\", \"message\")"), false);
  assert.equal(source.includes("showNativeToast(\"已保存。\", \"success\")"), false);
  assert.ok(source.includes("openConfig = button(msg(\"plugin.openConfig\"), \"secondary\")"));
  assert.ok(source.includes("await nativeApi.openSettingsFile()"));
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
  assert.ok(source.includes("dataset.dtmActionStatus"));
  assert.equal(source.includes("helperText: host.dataset"), false);
  assert.equal(source.includes("testConnection.setStatus"), false);
  assert.equal(source.includes("refreshControl.setLoading"), false);
  assert.equal(source.includes("modelListStatusText"), false);
  assert.equal(source.includes("function actionField"), false);
  assert.equal(source.includes("dtm:control-click"), false);
  assert.equal(source.includes("mainWorldControlClickCallbacks"), false);
  assert.equal(source.includes("actionField(\"模型列表\""), false);
  assert.ok(source.includes("dataset.dtmActionStatus"));
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.ok(source.includes("nativeApi.listModels"));
  assert.ok(source.includes("refreshModelList"));
  assert.ok(source.includes("renderModelField"));
  assert.ok(source.includes("modelComboBoxHost.updateOptions("));
  assert.ok(source.includes("plugin.modelsRefreshed"));
  assert.ok(source.includes("modelComboBoxHostFor(msg(\"plugin.model\")"));
  assert.ok(source.includes("kind: \"combobox\""));
  assert.equal(source.includes("SearchableSelect"), false);
  assert.ok(preloadSource.includes("SearchableSelect"));
  assert.equal(source.includes("ComboboxProvider"), false);
  assert.equal(source.includes("ComboboxListbox"), false);
  assert.equal(source.includes("dtm-combobox-popout"), false);
  assert.equal(source.includes("dtm-model-row"), false);
  assert.equal(source.includes("textInputHost(msg(\"plugin.model\")"), false);
  assert.equal(source.includes("selectHostFor(msg(\"plugin.model\")"), false);
  assert.equal(source.includes("模型搜索 / 手动输入"), false);
  assert.equal(source.includes("textField(\"模型 ID\""), false);
});

test("settings source lets Discord render the model listbox without a custom popout", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");

  assert.ok(source.includes("inputField(msg(\"plugin.endpoint\"), \"text\", formState.model.baseUrl"));
  assert.ok(source.includes('disabled: formState.model.provider !== "custom"'));
  assert.equal(source.includes("if (provider.value === \"custom\") {\n      providerFields.append(textField(msg(\"plugin.endpoint\")"), false);
});

test("API key field shows a masked preview and never stages the mask as a new key", () => {
  setReadingRuntime({
    providerApiKeyStatus: { openai: true, google: false, previews: { openai: "sk-a…wxyz" } }
  });
  try {
    assert.equal(__test.text(__test.apiKeyPlaceholder("openai")), "已保存 sk-a…wxyz");
    assert.equal(__test.text(__test.apiKeyPlaceholder("google")), "粘贴 API Key");
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.equal(source.includes("renderOptionLabel: item => renderSelectOptionLabel"), false);
  assert.equal(source.includes("formatOption: item => formatSelectOption"), false);
  assert.ok(preloadSource.includes("renderOptionLabel: item => renderSelectOption(ui, item)"));
  assert.ok(preloadSource.includes("LockIcon"));
  assert.equal(source.includes(".dtm-provider-select-field [class*='selectedIcon']"), false);
  assert.equal(source.includes("已保存 API Key\" }, \"✓\""), false);
});

test("settings source lays feature toggles out as regular Discord setting rows", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");
  const preloadSource = fs.readFileSync(path.join(__dirname, "../src/mod/preload.js"), "utf8");

  assert.equal(source.includes("featureToggleGrid(["), false);
  assert.equal(source.includes("function featureToggleGrid"), false);
  assert.equal(source.includes(".dtm-feature-grid"), false);
  assert.ok(source.includes("toggleRow(msg(\"plugin.enabled\")"));
  assert.ok(source.includes("toggleRow(msg(\"plugin.sendEnabled\")"));
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");

  assert.ok(source.includes("section(msg(\"plugin.section.general\")"));
  assert.ok(source.includes("section(msg(\"plugin.section.style\")"));
  assert.ok(source.includes("section(msg(\"plugin.section.read\")"));
  assert.equal(source.includes("section(msg(\"plugin.section.send\")"), false);
  assert.equal(source.includes("plugin.persistCache"), false);
  assert.equal(source.includes("plugin.update.download"), false);
  assert.equal(source.includes("plugin.cacheStatus"), false);
  assert.equal(source.includes("advancedSettings(["), false);
  assert.equal(source.includes("function advancedSettings"), false);
  assert.equal(source.includes("button(\"高级设置\""), false);
});

test("settings source only exposes native color selects and font selection for translation style", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");

  assert.ok(source.includes("BACKGROUND_COLOR_OPTIONS"));
  assert.ok(source.includes("TEXT_COLOR_OPTIONS"));
  assert.ok(source.includes("selectField(msg(\"plugin.backgroundColor\")"));
  assert.ok(source.includes("selectField(msg(\"plugin.textColor\")"));
  assert.ok(source.includes("selectField(msg(\"plugin.font\")"));
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");

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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");

  assert.ok(source.includes('document.createElement("style")'));
  assert.ok(source.includes("style.textContent"));
  assert.ok(source.includes(".dtm-translation-block"));
  assert.ok(source.includes("#${SEND_BOX_ID}"));
  assert.equal(source.includes(".dtm-swatch-field"),false);
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");

  assert.ok(source.includes("function diagnosticLog"));
  assert.ok(source.includes("host.dataset.dtmNativeReactError"));
  assert.ok(source.includes("MAIN_WORLD_BRIDGE_ERROR"));
  assert.equal(source.includes("discordUiResolveReason"), false);
  assert.equal(source.includes("function resolveDiscordUi"), false);
});

test("settings source keeps cache enabled without exposing a cache toggle", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");

  assert.equal(source.includes("启用 AI 缓存"), false);
  assert.equal(source.includes("section(\"缓存\""), false);
});

test("publicError removes Electron IPC prefixes and keeps user-facing text short", () => {
  assert.equal(
    __test.publicError(new Error("Error invoking remote method 'dtm:test-connection': Error: Model request failed (401): token expired or incorrect")),
    "Model request failed (401): token expired or incorrect"
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
    setReadingRuntime({
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");
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
  assert.ok(source.includes("state?.source !== unit.text"));

  // Save confirms inline without a spinner.
  assert.equal(source.includes("host.flashLabel"),false);
  assert.equal(source.includes("flashLabel"), false);
  assert.ok(source.includes('saveStatus.update('));
  assert.ok(source.includes('plugin.savedToast'));
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
    setReadingRuntime({
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
    setReadingRuntime({
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
    setReadingRuntime({
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

    setReadingRuntime({ settings: { style: { position: "below" } } });
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
    setReadingRuntime({
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
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8").replace(/(\w+)\(\s*\n\s*/g, "$1(").replace(/,\s*\n\s*/g, ", ");

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
  assert.ok(source.includes("selectField(msg(\"plugin.backgroundColor\")"));
  assert.ok(source.includes("selectField(msg(\"plugin.textColor\")"));
  assert.equal(source.includes("sliderField("), false);
  assert.equal(source.includes("selectField(\"文字装饰\""), false);
  assert.ok(source.includes("translationStylePreview"));
  assert.ok(source.includes("selectField(msg(\"plugin.provider\")"));
  assert.ok(source.includes("selectField(msg(\"plugin.translationStyle\")"));
  assert.ok(source.includes('inputField(msg("plugin.customPrompt"), "textarea"'));
  assert.ok(source.includes('setRowVisible(customPromptHost,'));
  assert.ok(source.includes('formState.translationStyle === "custom"'));
  assert.ok(source.includes('toggleRow(msg("plugin.autoSend")'));
  assert.ok(source.includes('selectField(msg("plugin.opacity")'));
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
    if (child && typeof child.remove === "function" && child.parentElement) child.remove();
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
    if (child && typeof child.remove === "function" && child.parentElement) child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    if (child && typeof child.remove === "function" && child.parentElement) child.remove();
    const index = before ? this.children.indexOf(before) : -1;
    child.parentElement = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  prepend(child) {
    if (child && typeof child.remove === "function" && child.parentElement) child.remove();
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
  if (selector === "[data-dtm-chrome]") return node.attributes.has("data-dtm-chrome");
  if (selector === "[data-dtm-control-id]") return Boolean(node.dataset.dtmControlId);
  if (selector === "[data-dtm-section-key]") return Boolean(node.dataset.dtmSectionKey);
  if (selector === "[data-dtm-hidden='true']") return node.dataset.dtmHidden === "true";
  if (selector === "[data-dtm-header-title='true']") return node.dataset.dtmHeaderTitle === "true";
  if (selector === "[hidden]") return node.hidden === true || node.attributes.has("hidden");
  const presence = selector.match(/^\[data-([a-z0-9-]+)\]$/i);
  if (presence) {
    const key = presence[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    return node.dataset[key] != null && String(node.dataset[key]).length > 0;
  }

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
    setReadingRuntime({
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
    setReadingRuntime({
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
    setReadingRuntime({
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
    setReadingRuntime({
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
    setReadingRuntime({
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
    setReadingRuntime({
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
    setReadingRuntime({
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
    setReadingRuntime({
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
  setReadingRuntime(runtime);
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

for (const className of ["dtm-send-grip", "dtm-send-resize"]) {
  test(`disabling during ${className} removes document pointer listeners`, t => {
    const { document, box } = sendingRuntime(t);
    const listeners = new Map();
    document.addEventListener = (name, listener) => listeners.set(name, listener);
    document.removeEventListener = (name, listener) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    };
    box.querySelector(`.${className}`).listeners.get("pointerdown")({
      clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {}
    });
    assert.equal(listeners.size, 3);
    __test.getSettingsForTests().enabled = false;
    __test.applyAutoTranslateSettings();
    assert.equal(document.getElementById("dtm-send-box"), null);
    assert.equal(listeners.size, 0);
  });
}

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


test("edited source never displays an obsolete result", async t => {
  const pending = deferredTranslation();
  const document = readingRuntime(t, { settings: {}, nativeApi: { translate: () => pending.promise } });
  const message = chatMessage("1", "1000000000000000000", "before edit");
  document.appendChild(message);
  const task = __test.translateMessage(message);
  message.children[0].textContent = "after edit";
  pending.resolve({ ok: true, text: "translated before edit" });
  await task;
  assert.equal(message.querySelector(".dtm-translation-block"), null);
});

test("disabled plugin cannot restore a cached translation", async t => {
  const document = readingRuntime(t, { settings: {}, nativeApi: { translate: async () => ({ ok: true, text: "cached" }) } });
  const message = chatMessage("1", "1000000000000000000", "source");
  document.appendChild(message);
  await __test.translateMessage(message);
  __test.getSettingsForTests().enabled = false;
  message.querySelector(".dtm-translation-block").remove();
  __test.restoreVisibleTranslations([message]);
  assert.equal(message.querySelector(".dtm-translation-block"), null);
});

test("disable removes blocks; re-enable restores only the same reading configuration and credential",async()=>{
 const previousDocument=global.document,previousElement=global.Element,document=new FakeDocument();
 const message=new FakeElement("div","",rect(0,0,600,120));message.id="chat-messages-reenable";
 const content=new FakeElement("div","Original source",rect(0,0,400,24));content.className="messageContent__test";message.appendChild(content);document.appendChild(message);
 try {
  global.document=document;global.Element=FakeElement;
  setReadingRuntime({settings:{enabled:true},nativeApi:{translate:async()=>({text:"成功译文"})}});
  const saved=__test.getSettingsForTests();__test.applySnapshot({settings:saved,executionRevision:1,credentialContext:"opaque-a"});
  await __test.translateMessage(message);assert.equal(message.querySelector(".dtm-translation-block").textContent,"成功译文");
  __test.applySnapshot({settings:{...saved,enabled:false},executionRevision:2,credentialContext:"opaque-a"});__test.restoreVisibleTranslations([message]);assert.equal(message.querySelector(".dtm-translation-block"),null);
  __test.applySnapshot({settings:saved,executionRevision:3,credentialContext:"opaque-a"});__test.restoreVisibleTranslations([message]);assert.equal(message.querySelector(".dtm-translation-block").textContent,"成功译文");
  __test.applySnapshot({settings:saved,executionRevision:4,credentialContext:"opaque-b"});__test.restoreVisibleTranslations([message]);assert.equal(message.querySelector(".dtm-translation-block"),null);
 }finally{__test.resetRuntimeForTests();if(previousDocument)global.document=previousDocument;else delete global.document;if(previousElement)global.Element=previousElement;else delete global.Element}
});

for (const locale of ["en", "zh-Hans", "zh-Hant", "ja"]) {
  test(`a system locale change to ${locale} refreshes labels without replacing controls or later key edits`, async t => {
    const pending = deferredTranslation(), calls = [];
    const initial = require("../src/shared/settings").normalizeSettings({});
    const {document} = settingsRuntime(t, {
      getSettings: async () => ({settings:initial,ui:{systemLocale:"en"},settingsRevision:1,executionRevision:1}),
      saveConfig: request => {calls.push(request);return pending.promise.then(()=>({settings:request.settings,ui:{systemLocale:locale},settingsRevision:2,executionRevision:1}));},
      listModels: () => {throw new Error("locale save must not refresh models");},
      testConnection: () => {throw new Error("locale save must not test the connection");},
      translate: () => {throw new Error("locale save must not translate");},
    });
    await __test.openSettingsPanel();
    const field = id => walk(document).find(node => node.__dtmControlSource?.name?.id===id);
    const action = id => walk(document).find(node => node.__dtmControlSource?.label?.id===id);
    const key = walk(document).find(node=>node.__dtmControlSpec?.type==="password");
    const ids = walk(document).filter(node=>node.dataset?.dtmControlId).map(node=>node.dataset.dtmControlId);
    const updates=[];global.window.addEventListener("dtm:mount-control",event=>{if(event.detail.textOnly)updates.push(event.detail)});
    // The operating system is the only interface-language source; no stored value can move it.
    __test.applySnapshot({settings:__test.getSettingsForTests(),ui:{systemLocale:locale},settingsRevision:1,executionRevision:1});
    assert.equal(__test.getUiLocale(),locale);
    // One harmless visual change makes the ordinary Save flow run.
    field("plugin.background").__dtmControlSpec.onChange(false);
    const saving=action("plugin.save").listeners.get("click")();
    key.__dtmControlSpec.onChange("test-only-post-submit-key");
    const oldNode=key;pending.resolve();await saving;
    assert.equal(__test.getUiLocale(),locale);
    assert.equal(walk(document).find(node=>node.__dtmControlSpec?.type==="password"),oldNode);
    assert.deepEqual(walk(document).filter(node=>node.dataset?.dtmControlId).map(node=>node.dataset.dtmControlId),ids);
    assert.equal(calls[0].key.action,"keep");assert.equal(Object.hasOwn(calls[0].settings,"__apiKey"),false);
    const draft=__test.getFormForTests().draft();assert.ok(draft);
    assert.equal(__test.getFormForTests().keyActionForTests(),"replace");
    for(const update of updates){assert.equal(Object.hasOwn(update,"value"),false);assert.equal(Object.hasOwn(update,"onChange"),false);assert.equal(JSON.stringify(update).includes("test-only-post-submit-key"),false);}
    assert.equal(field("plugin.enabled").lang,locale);
  });
  test(`${locale} read loading/errors use UI lang and completed content keeps its target lang`, async t => {
    const pending=deferredTranslation(),document=readingRuntime(t,{settings:{model:{targetLanguage:"日语"}},systemLocale:locale,nativeApi:{translate:()=>pending.promise}});
    const message=chatMessage("1","1000000000000000000","source text");document.appendChild(message);
    const task=__test.translateMessage(message);await flushMicrotasks();
    assert.equal(message.querySelector(".dtm-translation-block").lang,locale);
    pending.resolve({text:"domain content {braces}"});await task;
    assert.equal(message.querySelector(".dtm-translation-block").lang,"ja");
    const content=message.children.find(node=>node.className.includes("messageContent"));assert.equal(content.lang,undefined);
    __test.applySnapshot({settings:{...__test.getSettingsForTests(),model:{...__test.getSettingsForTests().model,targetLanguage:"unknown target"}},executionRevision:1});
    __test.refreshUiChrome();assert.equal(message.querySelector(".dtm-translation-block").lang,"");
  });
}
test("a legacy stored interface language never overrides the system locale or the open draft",async t=>{
  const initial=require("../src/shared/settings").normalizeSettings({});
  const {document}=settingsRuntime(t,{getSettings:async()=>({settings:initial,ui:{systemLocale:"en"},settingsRevision:1,executionRevision:1})});
  await __test.openSettingsPanel();
  assert.equal(walk(document).some(node=>node.__dtmControlSource?.name?.id==="plugin.uiLanguage"),false);
  assert.equal(__test.getUiLocale(),"en");
  let key=walk(document).find(node=>node.__dtmControlSpec?.type==="password");key.__dtmControlSpec.onChange("test-only-staged");
  // Discarding an unsaved draft never moves the interface language off the system value.
  const discard=walk(document).find(node=>node.__dtmControlSource?.label?.id==="plugin.discard");discard.listeners.get("click")();await flushMicrotasks();
  assert.equal(__test.getUiLocale(),"en");
  assert.equal(__test.getFormForTests().keyActionForTests(),"keep");
  key=walk(document).find(node=>node.__dtmControlSpec?.type==="password");key.__dtmControlSpec.onChange("test-only-staged");
  // An external rewrite that only carries the retired field is not a meaningful change.
  __test.applySnapshot({settings:{...initial,uiLanguage:"zh-Hant"},settingsRevision:2,executionRevision:1});
  assert.equal(__test.getUiLocale(),"en");
  __test.getFormForTests().externalChange();
  assert.equal(walk(document).find(node=>node.__dtmControlSpec?.type==="password"),key);
  assert.equal(__test.getFormForTests().keyActionForTests(),"replace");
  assert.equal(walk(document).find(node=>node.__dtmControlSource?.label?.id==="plugin.overwrite"),undefined);
  assert.equal(walk(document).some(node=>node.__dtmControlSource?.helperText?.id==="plugin.conflict"),false);
});

for(const fail of [false,true])test(`startup ${fail?"failure":"success"} registers labels after the settings result`,async t=>{
 const pending=deferredTranslation(),{document}=settingsRuntime(t);const registered=[];
 const renderer=require("../src/mod/renderer");global.window.addEventListener("dtm:settings-config",event=>registered.push(event.detail));
 renderer.start({uiSystemLocale:"ja",getSettings:()=>pending.promise});assert.equal(registered.length,0);
 if(fail)pending.reject(Object.assign(new Error("never render this diagnostic"),{code:"STORAGE",reason:"READ_FAILED"}));else pending.resolve({settings:{uiLanguage:"zh-Hant",enabled:false},ui:{systemLocale:"ja"}});
 await flushMicrotasks();assert.ok(registered.length>=1);assert.equal(registered.at(-1).locale,"ja");assert.ok(registered.at(-1).sections[0].label);
 assert.equal(JSON.stringify(registered).includes("never render"),false);
});

test("connected chrome follows the UI locale and detached chrome keeps its label", t => {
  const document = readingRuntime(t, { settings: {}, systemLocale: "en" });
  const connected = __test.createSendBox();
  const detached = __test.createSendBox();
  document.appendChild(connected);
  const label = box => box.children[0].getAttribute("aria-label");
  const inputLabel = box => box.children[1].getAttribute("aria-label");
  const english = label(connected);
  const englishInput = inputLabel(connected);
  assert.equal(label(detached), english);
  assert.equal(connected.children[2].lang, "en");
  __test.applySnapshot({
    settings: __test.getSettingsForTests(),
    executionRevision: 1,
    ui: { systemLocale: "ja" }
  });
  assert.equal(__test.getUiLocale(), "ja");
  assert.equal(label(connected), __test.text(__test.msg("plugin.send.drag")));
  assert.notEqual(label(connected), english);
  assert.equal(inputLabel(connected), __test.text(__test.msg("plugin.send.input")));
  assert.notEqual(inputLabel(connected), englishInput);
  assert.equal(connected.children[2].lang, "ja");
  assert.equal(label(detached), english);
  assert.equal(inputLabel(detached), englishInput);
  assert.equal(detached.children[2].lang, "en");
});

test("discarded send boxes release their chrome nodes", () => {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(process.execPath, ["--expose-gc", "-e", `
    class Element {}
    class Node extends Element {
      constructor(tag) {
        super();
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.dataset = {};
        this.style = {};
        this.className = "";
        this.classList = { add() {}, remove() {}, contains() { return false; } };
      }
      set textContent(value) { this.ownText = String(value); }
      get textContent() { return this.ownText || ""; }
      setAttribute(name, value) { this.attributes.set(name, String(value)); }
      getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
      removeAttribute(name) { this.attributes.delete(name); }
      addEventListener() {}
      append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
      getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, x: 0, y: 0 }; }
    }
    const document = {
      children: [],
      documentElement: null,
      createElement(tag) { return new Node(tag); },
      querySelectorAll() { return []; },
      getElementById() { return null; },
      addEventListener() {},
      removeEventListener() {}
    };
    document.documentElement = document;
    global.document = document;
    global.Element = Element;
    global.window = { innerWidth: 800, innerHeight: 600, addEventListener() {} };
    const { __test } = require(${JSON.stringify(path.join(__dirname, "../src/mod/renderer.js"))});
    __test.setRuntimeForTests({ settings: { enabled: true, sendTranslation: { enabled: true } }, systemLocale: "en" });
    function make() {
      const box = __test.createSendBox();
      return new WeakRef(box.children[2]);
    }
    const refs = [];
    for (let i = 0; i < 1000; i++) refs.push(make());
    setImmediate(() => {
      gc();
      setImmediate(() => {
        gc();
        const alive = refs.filter(ref => ref.deref()).length;
        if (alive !== 0) { console.error("alive " + alive); process.exit(1); }
      });
    });
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("api key status stays mounted across provider changes and a save", async t => {
  const saved = [];
  const { document } = settingsRuntime(t, {
    getApiKeyStatus: async () => ({ previews: { openai: "sk-o…enai" }, openai: true, secureStorageAvailable: true }),
    saveConfig: async request => {
      saved.push(request);
      return { settings: request.settings, settingsRevision: 2, executionRevision: 2, ui: { systemLocale: "zh-Hans" } };
    }
  });
  await __test.openSettingsPanel();
  const status = walk(document).find(node => node.dataset?.dtmKeyStatus === "true");
  const key = walk(document).find(node => node.__dtmControlSpec?.type === "password");
  assert.ok(status);
  assert.equal(status.__dtmControlSource.helperText, "");
  assert.equal(settingRowOf(status).hidden, true);
  assert.equal(key.__dtmControlSource.placeholder.id, "plugin.key.savedPlaceholder");
  assert.equal(key.__dtmControlSource.placeholder.params.preview, "sk-o…enai");
  key.__dtmControlSpec.onChange("test-only-key");
  await walk(document).find(node => node.__dtmControlSource?.label?.id === "plugin.save").listeners.get("click")();
  assert.equal(saved[0].key.action, "replace");
  assert.equal(saved[0].key.value, "test-only-key");
  assert.equal(saved[0].settings.model.provider, "openai");
  const provider = walk(document).find(node => node.__dtmControlSource?.name?.id === "plugin.provider");
  provider.__dtmControlSpec.onChange("deepseek");
  await flushMicrotasks();
  const password = walk(document).find(node => node.__dtmControlSpec?.type === "password");
  assert.equal(status.__dtmControlSource.helperText, "");
  assert.equal(password.__dtmControlSource.placeholder.id, "plugin.key.paste");
  assert.equal(settingRowOf(status).hidden, true);
  assert.notEqual(status.dataset.dtmNativeReactMounted, "disposed");
  assert.notEqual(status.dataset.dtmNativeReactError, "Discord main-world bridge was not captured.");
  assert.equal(password.parentElement.contains(status), false);
});

test("recoverable damaged keys offer reset and do not stage a replacement", async t => {
  const saved = [];
  const { document } = settingsRuntime(t, {
    getSettings: async () => ({
      settings: {},
      ui: { systemLocale: "zh-Hans" },
      settingsRevision: 1,
      executionRevision: 1,
      keyStatus: { previews: {}, unavailable: { code: "MALFORMED", reason: "INVALID_JSON", recoverable: true }, secureStorageAvailable: true }
    }),
    saveConfig: async request => {
      saved.push(request);
      return { settings: request.settings, settingsRevision: 2, executionRevision: 2, ui: { systemLocale: "zh-Hans" }, keyStatus: { previews: {}, secureStorageAvailable: true } };
    }
  });
  await __test.openSettingsPanel();
  const status = walk(document).find(node => node.__dtmControlSource?.helperText?.id === "plugin.key.damaged");
  const reset = walk(document).find(node => node.__dtmControlSource?.label?.id === "plugin.key.reset");
  const key = walk(document).find(node => node.__dtmControlSpec?.type === "password");
  assert.ok(status);
  assert.equal(reset.__dtmControlSpec.label, "重置已保存的密钥");
  assert.equal(key.__dtmControlSpec.disabled, true);
  key.__dtmControlSpec.onChange("should-not-stage");
  assert.equal(__test.getFormForTests().keyActionForTests(), "keep");
  reset.listeners.get("click")();
  assert.equal(__test.getFormForTests().keyActionForTests(), "reset");
  assert.equal(status.__dtmControlSource.helperText.id, "plugin.key.resetExplain");
  await walk(document).find(node => node.__dtmControlSource?.label?.id === "plugin.save").listeners.get("click")();
  assert.equal(saved[0].key.action, "reset");
  assert.equal(saved[0].key.value, undefined);
});

test("unreadable keys explain the denial and offer no reset", async t => {
  const { document } = settingsRuntime(t, {
    getSettings: async () => ({
      settings: {},
      ui: { systemLocale: "zh-Hans" },
      settingsRevision: 1,
      executionRevision: 1,
      keyStatus: { previews: {}, unavailable: { code: "STORAGE", reason: "ACCESS_DENIED", recoverable: false }, secureStorageAvailable: false }
    })
  });
  await __test.openSettingsPanel();
  assert.ok(walk(document).find(node => node.__dtmControlSource?.helperText?.id === "plugin.key.accessDenied"));
  assert.equal(walk(document).find(node => node.__dtmControlSource?.label?.id === "plugin.key.reset"), undefined);
  const key = walk(document).find(node => node.__dtmControlSpec?.type === "password");
  key.__dtmControlSpec.onChange("should-not-stage");
  assert.equal(__test.getFormForTests().keyActionForTests(), "keep");
});

test("a send-language revision keeps rendered reads and drops pending reads", async t => {
  const pending = deferredTranslation();
  const document = readingRuntime(t, {
    settings: { enabled: true, model: { sendLanguage: "英语", targetLanguage: "简体中文" } },
    nativeApi: {
      translate: (request) => request.text === "pending source" ? pending.promise : Promise.resolve({ text: "kept" })
    }
  });
  const done = chatMessage("1", "1000000000000000001", "source text");
  const waiting = chatMessage("2", "1000000000000000002", "pending source");
  document.appendChild(done);
  document.appendChild(waiting);
  const saved = __test.getSettingsForTests();
  __test.applySnapshot({ settings: saved, executionRevision: 1, credentialContext: "opaque-a" });
  await __test.translateMessage(done);
  const loading = __test.translateMessage(waiting);
  await flushMicrotasks();
  assert.equal(done.querySelector(".dtm-translation-block").textContent, "kept");
  assert.equal(waiting.querySelector(".dtm-translation-block").textContent.length > 0, true);
  __test.applySnapshot({
    settings: { ...saved, model: { ...saved.model, sendLanguage: "日语" } },
    executionRevision: 2,
    credentialContext: "opaque-a"
  });
  assert.equal(done.querySelector(".dtm-translation-block").textContent, "kept");
  assert.equal(waiting.querySelector(".dtm-translation-block"), null);
  pending.resolve({ text: "too late" });
  await loading;
  assert.equal(waiting.querySelector(".dtm-translation-block"), null);
  __test.applySnapshot({
    settings: { ...saved, model: { ...saved.model, targetLanguage: "日语" } },
    executionRevision: 3,
    credentialContext: "opaque-a"
  });
  __test.restoreVisibleTranslations([done, waiting]);
  assert.equal(done.querySelector(".dtm-translation-block"), null);
});

function controlByName(document, id) {
  return walk(document).find((node) => node.__dtmControlSource?.name?.id === id);
}
function settingRowOf(node) {
  return node?.closest?.("[data-dtm-native-setting-row]") || null;
}
const ACTION_STATUS_KEY = {
  "plugin.save": "save",
  "plugin.overwrite": "save",
  "plugin.discard": "save",
  "plugin.reload": "save",
  "plugin.openConfig": "openConfig",
  "plugin.clearCache": "cache",
};
function actionStatusNear(button) {
  let node = button;
  while (node && node.dataset?.dtmActions !== "true") node = node.parentElement;
  return walk(node).find((child) => child.dataset?.dtmActionStatus === ACTION_STATUS_KEY[button.__dtmControlSource?.label?.id]);
}
function controlByLabel(document, id) {
  return walk(document).find((node) => node.__dtmControlSource?.label?.id === id);
}
function saveControl(document) {
  return controlByLabel(document, "plugin.save") || controlByLabel(document, "plugin.overwrite");
}
function discardControl(document) {
  return controlByLabel(document, "plugin.discard") || controlByLabel(document, "plugin.reload");
}
function mutableSettings(hold) {
  const { normalizeSettings } = require("../src/shared/settings");
  let revision = 1;
  let current = normalizeSettings({});
  let pending = null;
  const saves = [];
  return {
    saves,
    current: () => current,
    release() { pending?.resolve(); pending = null; },
    api: {
      getSettings: async () => ({ settings: current, settingsRevision: revision, executionRevision: 1 }),
      saveConfig: async (request) => {
        saves.push(request);
        if (hold) await pending?.promise;
        current = normalizeSettings({
          ...request.settings,
          sendBox: {
            ...request.settings.sendBox,
            x: current.sendBox.x,
            y: current.sendBox.y,
            width: current.sendBox.width,
          },
        });
        revision += 1;
        return { settings: current, settingsRevision: revision, executionRevision: 1 };
      },
    },
    arm() {
      pending = deferredTranslation();
    },
  };
}

test("a saved settings form does not restore an older draft after it is closed", async (t) => {
  const store = mutableSettings(false);
  const { document } = settingsRuntime(t, store.api);
  await __test.openSettingsPanel();
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("deepseek");
  __test.closeSettingsPanel();
  await __test.openSettingsPanel();
  assert.equal(controlByName(document, "plugin.provider").__dtmControlSource.value, "deepseek");
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.save");
  await saveControl(document).listeners.get("click")();
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("zhipu");
  await saveControl(document).listeners.get("click")();
  __test.closeSettingsPanel();
  await __test.openSettingsPanel();
  assert.equal(store.current().model.provider, "zhipu");
  assert.equal(controlByName(document, "plugin.provider").__dtmControlSource.value, "zhipu");
  assert.equal(saveControl(document).disabled, true);
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.save");
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.saved"), false);
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.savedToast"), false);
  assert.equal(controlByLabel(document, "plugin.overwrite"), undefined);
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.conflict"), false);
});

test("edits made while a settings save is in flight survive close and reopen", async (t) => {
  const store = mutableSettings(true);
  store.arm();
  const { document } = settingsRuntime(t, store.api);
  await __test.openSettingsPanel();
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("deepseek");
  const saving = saveControl(document).listeners.get("click")();
  controlByName(document, "plugin.customPrompt").__dtmControlSpec.onChange("kept-during-save");
  store.release();
  await saving;
  assert.equal(__test.getFormForTests().draft().settings.customPrompt, "kept-during-save");
  assert.equal(__test.getFormForTests().draft().settings.model.provider, "deepseek");
  __test.closeSettingsPanel();
  await __test.openSettingsPanel();
  assert.equal(controlByName(document, "plugin.provider").__dtmControlSource.value, "deepseek");
  assert.equal(controlByName(document, "plugin.customPrompt").__dtmControlSource.value, "kept-during-save");
  assert.equal(saveControl(document).disabled, false);
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.save");
  assert.ok(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.dirty"));
  assert.equal(controlByLabel(document, "plugin.overwrite"), undefined);
});

test("closing during a settings save drops the draft when nothing else changed", async (t) => {
  const store = mutableSettings(true);
  store.arm();
  const { document } = settingsRuntime(t, store.api);
  await __test.openSettingsPanel();
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("deepseek");
  const saving = saveControl(document).listeners.get("click")();
  __test.closeSettingsPanel();
  store.release();
  await saving;
  await __test.openSettingsPanel();
  assert.equal(store.current().model.provider, "deepseek");
  assert.equal(controlByName(document, "plugin.provider").__dtmControlSource.value, "deepseek");
  assert.equal(saveControl(document).disabled, true);
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.save");
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.saved"), false);
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.savedToast"), false);
});

test("closing during a settings save keeps edits made before the close", async (t) => {
  const store = mutableSettings(true);
  store.arm();
  const { document } = settingsRuntime(t, store.api);
  await __test.openSettingsPanel();
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("deepseek");
  const saving = saveControl(document).listeners.get("click")();
  controlByName(document, "plugin.customPrompt").__dtmControlSpec.onChange("kept-during-save");
  __test.closeSettingsPanel();
  store.release();
  await saving;
  await __test.openSettingsPanel();
  assert.equal(controlByName(document, "plugin.provider").__dtmControlSource.value, "deepseek");
  assert.equal(controlByName(document, "plugin.customPrompt").__dtmControlSource.value, "kept-during-save");
  assert.equal(saveControl(document).disabled, false);
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.save");
  assert.ok(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.dirty"));
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.conflict"), false);
});

test("reopening while a settings save is pending keeps the newer input", async (t) => {
  const store = mutableSettings(true);
  store.arm();
  const { document } = settingsRuntime(t, store.api);
  await __test.openSettingsPanel();
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("deepseek");
  const saving = saveControl(document).listeners.get("click")();
  __test.closeSettingsPanel();
  await __test.openSettingsPanel();
  assert.equal(controlByName(document, "plugin.provider").__dtmControlSource.value, "deepseek");
  controlByName(document, "plugin.customPrompt").__dtmControlSpec.onChange("typed-while-pending");
  store.release();
  await saving;
  __test.getFormForTests().externalChange();
  const draft = __test.getFormForTests().draft();
  assert.equal(draft.settings.model.provider, "deepseek");
  assert.equal(draft.settings.customPrompt, "typed-while-pending");
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.overwrite");
});

test("an external settings change still conflicts without replacing the open draft", async (t) => {
  const { normalizeSettings } = require("../src/shared/settings");
  const initial = normalizeSettings({});
  let savedRevision = null;
  const { document } = settingsRuntime(t, {
    getSettings: async () => ({ settings: initial, settingsRevision: 1, executionRevision: 1 }),
    saveConfig: async (request) => {
      savedRevision = request.baseSettingsRevision;
      return { settings: request.settings, settingsRevision: 5, executionRevision: 1 };
    },
  });
  await __test.openSettingsPanel();
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("deepseek");
  __test.applySnapshot({
    settings: normalizeSettings({ customPrompt: "external" }),
    settingsRevision: 4,
    executionRevision: 1,
  });
  __test.getFormForTests().externalChange();
  assert.equal(__test.getFormForTests().draft().settings.model.provider, "deepseek");
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.overwrite");
  assert.ok(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.conflict"));
  await saveControl(document).listeners.get("click")();
  assert.equal(savedRevision, 4);
});

test("storage failures stay distinct from configuration conflicts", async (t) => {
  const { normalizeSettings } = require("../src/shared/settings");
  const settings = normalizeSettings({});
  async function openStatus(status) {
    const { document } = settingsRuntime(t, {
      getSettings: async () => ({ settings, settingsRevision: 3, executionRevision: 1, status }),
    });
    await __test.openSettingsPanel();
    return document;
  }
  const writeFailed = await openStatus({ code: "STORAGE", reason: "WRITE_FAILED" });
  assert.equal(saveControl(writeFailed).disabled, true);
  assert.equal(saveControl(writeFailed).__dtmControlSource.label.id, "plugin.save");
  assert.equal(discardControl(writeFailed).disabled, true);
  assert.equal(discardControl(writeFailed).__dtmControlSource.label.id, "plugin.discard");
  assert.ok(walk(writeFailed).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.error.STORAGE.WRITE_FAILED"));
  controlByName(writeFailed, "plugin.customPrompt").__dtmControlSpec.onChange("edited");
  assert.equal(saveControl(writeFailed).disabled, false);
  assert.equal(saveControl(writeFailed).__dtmControlSource.label.id, "plugin.save");
  __test.closeSettingsPanel();

  const unreadable = await openStatus({ code: "MALFORMED", reason: "UNREADABLE" });
  assert.equal(saveControl(unreadable).__dtmControlSource.label.id, "plugin.save");
  assert.equal(saveControl(unreadable).disabled, true);
  assert.equal(discardControl(unreadable).disabled, false);
  assert.equal(discardControl(unreadable).__dtmControlSource.label.id, "plugin.reload");
  assert.ok(walk(unreadable).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.error.MALFORMED.UNREADABLE"));
  __test.closeSettingsPanel();

  const partial = await openStatus({ code: "PARTIAL_SAVE", reason: "KEY_ROLLBACK_FAILED" });
  assert.equal(saveControl(partial).__dtmControlSource.label.id, "plugin.save");
  assert.equal(saveControl(partial).disabled, true);
  assert.equal(discardControl(partial).disabled, false);
  assert.equal(discardControl(partial).__dtmControlSource.label.id, "plugin.reload");
  assert.ok(walk(partial).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.error.PARTIAL_SAVE.KEY_ROLLBACK_FAILED"));
  __test.closeSettingsPanel();

  const invalid = await openStatus({ code: "MALFORMED", reason: "INVALID_JSON" });
  assert.equal(saveControl(invalid).disabled, false);
  assert.equal(saveControl(invalid).__dtmControlSource.label.id, "plugin.overwrite");
  assert.equal(discardControl(invalid).__dtmControlSource.label.id, "plugin.reload");
  assert.ok(walk(invalid).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.error.MALFORMED.INVALID_JSON"));
  assert.equal(walk(invalid).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.conflict"), false);
  __test.closeSettingsPanel();

  const oversized = await openStatus({ code: "MALFORMED", reason: "OVERSIZED" });
  assert.equal(saveControl(oversized).disabled, true);
  assert.equal(saveControl(oversized).__dtmControlSource.label.id, "plugin.save");
  assert.ok(walk(oversized).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.error.MALFORMED.OVERSIZED"));
  __test.closeSettingsPanel();

  const conflict = await openStatus({ code: "CONFLICT" });
  assert.equal(saveControl(conflict).disabled, false);
  assert.equal(saveControl(conflict).__dtmControlSource.label.id, "plugin.overwrite");
  assert.equal(discardControl(conflict).__dtmControlSource.label.id, "plugin.reload");
  assert.ok(walk(conflict).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.conflict"));
});

test("an unreadable store keeps a mismatched draft instead of offering overwrite", async (t) => {
  const { normalizeSettings } = require("../src/shared/settings");
  const settings = normalizeSettings({});
  let revision = 1;
  let status = null;
  const { document } = settingsRuntime(t, {
    getSettings: async () => ({ settings, settingsRevision: revision, executionRevision: 1, status }),
  });
  await __test.openSettingsPanel();
  controlByName(document, "plugin.customPrompt").__dtmControlSpec.onChange("kept-draft");
  __test.closeSettingsPanel();
  revision = 2;
  status = { code: "MALFORMED", reason: "UNREADABLE" };
  await __test.openSettingsPanel();
  assert.equal(controlByName(document, "plugin.customPrompt").__dtmControlSource.value, "kept-draft");
  assert.equal(__test.getFormForTests().draft().settings.customPrompt, "kept-draft");
  assert.ok(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.error.MALFORMED.UNREADABLE"));
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.conflict"), false);
  assert.equal(saveControl(document).disabled, false);
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.save");
  assert.equal(discardControl(document).disabled, false);
  assert.equal(discardControl(document).__dtmControlSource.label.id, "plugin.reload");
  __test.applySnapshot({
    settings: normalizeSettings({ customPrompt: "external" }),
    settingsRevision: 3,
    executionRevision: 1,
  });
  __test.getFormForTests().externalChange();
  assert.equal(__test.getFormForTests().draft().settings.customPrompt, "kept-draft");
  assert.equal(saveControl(document).__dtmControlSource.label.id, "plugin.overwrite");
  assert.ok(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.conflict"));
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.error.MALFORMED.UNREADABLE"), false);
});

test("color swatches accept only auto or six-digit hex and keep the preview mounted", async (t) => {
  assert.equal(__test.safeSwatch("#aabbcc"), "#AABBCC");
  assert.equal(__test.safeSwatch(" AuTo "), "auto");
  assert.equal(__test.safeSwatch("#abc"), "");
  assert.equal(__test.safeSwatch("red"), "");
  assert.equal(__test.safeSwatch("url(#ffffff)"), "");
  const { document } = settingsRuntime(t);
  await __test.openSettingsPanel();
  const background = controlByName(document, "plugin.backgroundColor");
  const options = background.__dtmControlSource.options;
  assert.equal(options.find((option) => option.value === "auto").swatch, "auto");
  const hex = options.find((option) => option.value === "#303446");
  assert.equal(hex.swatch, "#303446");
  assert.equal(hex.label.id, "plugin.color.slate");
  assert.equal(options.find((option) => option.value === "auto").label.id, "plugin.color.auto");
  const preview = walk(document).find((node) => node.__dtmControlSource?.kind === "translation-preview");
  const before = preview.children.length;
  background.__dtmControlSpec.onChange("#303446");
  assert.equal(preview.__dtmControlSource.style.backgroundColor, "#303446");
  assert.equal(preview.children.length, before);
  assert.equal(typeof preview.updateStyle, "function");
});

test("setting rows hide when empty and stay hidden across style and address changes", async (t) => {
  const { document } = settingsRuntime(t);
  __test.injectBaseStyles();
  await __test.openSettingsPanel();
  const style = document.getElementById("dtm-style").textContent;
  // No query container may sit above a native control: Discord's inline floating
  // menus would treat it as their positioning box and land off the field. The
  // explanatory comment may name the conflict; the declarations may not use it.
  const declarations = style.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(declarations, /container-type|@container/);
  const pairRule = declarations.match(/\[data-dtm-pair\]\s*\{([^}]*)\}/);
  assert.ok(pairRule, "pair rule missing");
  assert.match(pairRule[1], /display:grid/);
  assert.match(pairRule[1], /grid-template-columns:repeat\(auto-fill,minmax\(/);
  assert.match(pairRule[1], /gap:16px/);
  assert.match(pairRule[1], /align-items:end/);
  assert.match(style, /\[data-dtm-native-setting-row\]\[hidden\] \{display:none;\}/);
  assert.match(style, /\[data-dtm-action-status\] \{flex:1 1 240px;min-width:0;\}/);
  const model = document.getElementById("dtm-settings-section-model");
  assert.doesNotMatch(model.getAttribute("style"), /container-type|@container/);
  for (const id of ["general", "model", "read", "style"]) {
    assert.doesNotMatch(document.getElementById(`dtm-settings-section-${id}`).getAttribute("style"), /container-type/);
  }
  const prompt = controlByName(document, "plugin.customPrompt");
  const promptRow = settingRowOf(prompt);
  assert.equal(promptRow.hidden, true);
  assert.equal(promptRow.getAttribute("hidden"), "");
  controlByName(document, "plugin.translationStyle").__dtmControlSpec.onChange("custom");
  assert.equal(promptRow.hidden, false);
  assert.equal(promptRow.getAttribute("hidden"), null);
  controlByName(document, "plugin.enabled").__dtmControlSpec.onChange(false);
  assert.equal(promptRow.hidden, false);
  controlByName(document, "plugin.translationStyle").__dtmControlSpec.onChange("natural");
  assert.equal(promptRow.hidden, true);
  const httpRow = model.children.filter((node) => node.dataset.dtmNativeSettingRow === "true")[2];
  assert.equal(httpRow.hidden, true);
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("custom");
  const endpoint = () => controlByName(document, "plugin.endpoint");
  endpoint().__dtmControlSpec.onChange("http://127.0.0.1:11434/v1");
  assert.equal(httpRow.hidden, true);
  endpoint().__dtmControlSpec.onChange("http://203.0.113.10/v1");
  assert.equal(httpRow.hidden, false);
  assert.ok(walk(httpRow).some((node) => node.__dtmControlSource?.name?.id === "plugin.allowHttp"));
  endpoint().__dtmControlSpec.onChange("not a url");
  assert.equal(httpRow.hidden, false);
  const endpointStatus = walk(httpRow).find((node) => node.__dtmControlSource?.kind === "status");
  assert.equal(endpointStatus.__dtmControlSource.helperText.id, "plugin.error.CONFIG.INVALID_ENDPOINT");
  assert.equal(endpointStatus.__dtmControlSource.role, "alert");
  assert.equal(endpointStatus.__dtmControlSource.live, "assertive");
  endpoint().__dtmControlSpec.onChange("https://example.com/v1");
  assert.equal(httpRow.hidden, true);
  const font = controlByName(document, "plugin.font");
  const opacity = controlByName(document, "plugin.opacity");
  assert.equal(font.parentElement, opacity.parentElement);
  assert.equal(document.getElementById("dtm-settings-section-style").contains(font), true);
  for (const id of ["plugin.autoNote", "plugin.httpNote", "plugin.reviewNote", "plugin.sendNativeNote", "plugin.key.savedPreview", "plugin.key.optional", "plugin.key.missing", "plugin.saved"]) {
    assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === id), false);
  }
});

test("operation results stay on the page when no toast is shown", async (t) => {
  let reads = 0;
  let releaseClear;
  const clearGate = new Promise((resolve) => { releaseClear = resolve; });
  const { document } = settingsRuntime(t, {
    listModels: async () => ({ models: [{ value: "fixture-model", label: "Fixture" }] }),
    testConnection: async () => ({ ok: true }),
    cacheStatus: async () => {
      reads += 1;
      return { count: 0, bytes: 0 };
    },
    saveCache: () => clearGate,
    saveConfig: async (request) => ({ settings: request.settings, settingsRevision: 2, executionRevision: 1 }),
  });
  await __test.openSettingsPanel();
  await flushMicrotasks();
  const refresh = controlByLabel(document, "plugin.refreshModels");
  const connection = walk(document.getElementById("dtm-settings-section-model")).find((node) => node.__dtmControlSource?.kind === "status" && node.dataset.dtmKeyStatus !== "true");
  assert.equal(settingRowOf(connection).hidden, true);
  await refresh.listeners.get("click")();
  assert.equal(connection.__dtmControlSource.helperText.id, "plugin.modelsRefreshed");
  assert.equal(settingRowOf(connection).hidden, false);
  assert.equal(connection.__dtmControlSource.role, "status");
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("deepseek");
  assert.equal(connection.__dtmControlSource.helperText, "");
  assert.equal(settingRowOf(connection).hidden, true);
  const save = saveControl(document);
  const saveStatus = actionStatusNear(save);
  await save.listeners.get("click")();
  assert.equal(saveStatus.__dtmControlSource.helperText.id, "plugin.savedToast");
  assert.equal(saveStatus.hidden, false);
  assert.equal(saveStatus.getAttribute("hidden"), null);
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("zhipu");
  assert.notEqual(saveStatus.__dtmControlSource.helperText.id, "plugin.savedToast");
  const clear = controlByLabel(document, "plugin.clearCache");
  const cacheStatus = actionStatusNear(clear);
  const toasts = [];
  global.window.addEventListener("dtm:show-toast", (event) => toasts.push(event.detail));
  assert.equal(cacheStatus.__dtmControlSource.helperText, "");
  assert.equal(cacheStatus.hidden, true);
  assert.equal(clear.disabled, false);
  const clearing = clear.listeners.get("click")();
  await flushMicrotasks();
  assert.equal(clear.disabled, true);
  releaseClear();
  await clearing;
  assert.equal(clear.disabled, false);
  assert.equal(cacheStatus.__dtmControlSource.helperText, "");
  assert.equal(cacheStatus.hidden, true);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].tone, "success");
  assert.equal(toasts[0].message, "翻译缓存已清除");
  assert.equal(reads, 1);
  __test.closeSettingsPanel();
  await __test.openSettingsPanel();
  await flushMicrotasks();
  const reopened = actionStatusNear(controlByLabel(document, "plugin.clearCache"));
  assert.equal(reopened.__dtmControlSource.helperText, "");
  assert.equal(reopened.hidden, true);
  assert.equal(reads, 2);
  assert.equal(controlByLabel(document, "plugin.clearCache").disabled, false);
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.savedToast"), false);
});

test("an older cache read does not replace a newer clear result", async (t) => {
  let releaseRead;
  const pending = new Promise((resolve) => { releaseRead = resolve; });
  let reads = 0;
  const { document } = settingsRuntime(t, {
    cacheStatus: () => {
      reads += 1;
      return reads === 1 ? pending.then(() => ({ count: 99, bytes: 2048 })) : { count: 0, bytes: 0 };
    },
    saveCache: async () => ({}),
  });
  await __test.openSettingsPanel();
  await flushMicrotasks();
  assert.equal(reads, 1);
  const clear = controlByLabel(document, "plugin.clearCache");
  const status = actionStatusNear(clear);
  assert.equal(clear.disabled, false);
  await clear.listeners.get("click")();
  assert.equal(clear.disabled, false);
  assert.equal(status.__dtmControlSource.helperText, "");
  assert.equal(status.hidden, true);
  assert.equal(reads, 1);
  releaseRead();
  await flushMicrotasks();
  assert.equal(status.__dtmControlSource.helperText, "");
  assert.equal(status.hidden, true);
  assert.equal(reads, 1);
});

test("an older cache read does not replace a clear failure", async (t) => {
  let releaseRead;
  const pending = new Promise((resolve) => { releaseRead = resolve; });
  const { document } = settingsRuntime(t, {
    cacheStatus: () => pending.then(() => ({ count: 99, bytes: 2048 })),
    saveCache: async () => { throw { code: "STORAGE", reason: "WRITE_FAILED" }; },
  });
  await __test.openSettingsPanel();
  await flushMicrotasks();
  const clear = controlByLabel(document, "plugin.clearCache");
  const status = actionStatusNear(clear);
  await clear.listeners.get("click")();
  assert.equal(clear.disabled, false);
  assert.equal(status.__dtmControlSource.helperText.id, "plugin.error.STORAGE.WRITE_FAILED");
  assert.equal(status.__dtmControlSource.tone, "critical");
  assert.equal(status.__dtmControlSource.role, "alert");
  releaseRead();
  await flushMicrotasks();
  assert.equal(status.__dtmControlSource.helperText.id, "plugin.error.STORAGE.WRITE_FAILED");
});

test("a cache read failure is shown beside clear and leaves clear available", async (t) => {
  const { document } = settingsRuntime(t, {
    cacheStatus: async () => ({ error: { code: "STORAGE", reason: "READ_FAILED" } }),
  });
  await __test.openSettingsPanel();
  await flushMicrotasks();
  const clear = controlByLabel(document, "plugin.clearCache");
  const status = actionStatusNear(clear);
  assert.equal(status.__dtmControlSource.helperText.id, "plugin.error.STORAGE.READ_FAILED");
  assert.equal(status.__dtmControlSource.tone, "critical");
  assert.equal(status.__dtmControlSource.role, "alert");
  assert.equal(clear.disabled, false);
});

test("settings pages keep one control per setting and the approved pairs", async (t) => {
  const { document } = settingsRuntime(t);
  await __test.openSettingsPanel();
  assert.equal(document.getElementById("dtm-settings-section-send"), null);
  assert.deepEqual([...document.children].map((node) => node.dataset.dtmSectionKey), ["general", "model", "read", "style"]);
  const once = (id) => {
    const nodes = walk(document).filter((node) => node.__dtmControlSource?.name?.id === id || node.__dtmControlSource?.label?.id === id);
    assert.equal(nodes.length, 1, id);
    return nodes[0];
  };
  const general = document.getElementById("dtm-settings-section-general");
  assert.equal(general.contains(once("plugin.enabled")), true);
  // The interface language is not a setting: only the operating system decides it.
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.name?.id === "plugin.uiLanguage"), false);
  const read = document.getElementById("dtm-settings-section-read");
  const readLanguage = once("plugin.readTarget");
  const sendLanguage = once("plugin.sendTarget");
  assert.equal(read.contains(readLanguage), true);
  assert.equal(readLanguage.parentElement, sendLanguage.parentElement);
  const translationStyle = once("plugin.translationStyle");
  assert.equal(read.contains(translationStyle), true);
  assert.equal(translationStyle.parentElement.children.length, 1);
  const style = document.getElementById("dtm-settings-section-style");
  assert.equal(once("plugin.position").parentElement, once("plugin.emphasis").parentElement);
  assert.equal(once("plugin.backgroundColor").parentElement, once("plugin.textColor").parentElement);
  assert.equal(style.contains(once("plugin.font")), true);
  assert.equal(once("plugin.font").parentElement, once("plugin.opacity").parentElement);
  const provider = once("plugin.provider");
  const model = once("plugin.model");
  assert.equal(provider.parentElement.parentElement, model.parentElement.parentElement);
  assert.equal(provider.parentElement.parentElement.dataset.dtmPair, "true");
  assert.equal(walk(document).filter((node) => node.__dtmControlSource?.label?.id === "plugin.update.check").length, 1);
});

test("page keys preserve a valid page, map send to translation, and refresh cache only on translation entry", async (t) => {
  let reads = 0;
  const { document } = settingsRuntime(t, {
    cacheStatus: async () => {
      reads += 1;
      return { count: 0, bytes: 0 };
    },
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/mod/renderer.js"), "utf8");
  const refresh = source.slice(source.indexOf("async function updateCacheStatus"), source.indexOf("clearCache.addEventListener", source.indexOf("async function updateCacheStatus")));
  assert.equal(/setTimeout|setInterval/.test(refresh), false);
  await __test.openSettingsPanel();
  await flushMicrotasks();
  assert.equal(reads, 1);
  assert.equal(document.getElementById("dtm-settings-section-general").contains(saveControl(document)), true);
  await __test.openSettingsPanel();
  await flushMicrotasks();
  assert.equal(reads, 1);
  await __test.openSettingsPanel("style");
  assert.equal(document.getElementById("dtm-settings-section-style").contains(saveControl(document)), true);
  await __test.openSettingsPanel("send");
  await flushMicrotasks();
  assert.equal(document.getElementById("dtm-settings-section-read").contains(saveControl(document)), true);
  assert.equal(reads, 2);
  await __test.openSettingsPanel();
  await flushMicrotasks();
  assert.equal(reads, 2);
  await __test.openSettingsPanel("read");
  await flushMicrotasks();
  assert.equal(reads, 3);
  await __test.openSettingsPanel("not-a-page");
  assert.equal(document.getElementById("dtm-settings-section-general").contains(saveControl(document)), true);
  await __test.openSettingsPanel("");
  assert.equal(document.getElementById("dtm-settings-section-general").contains(saveControl(document)), true);
  await __test.openSettingsPanel("style");
  __test.closeSettingsPanel();
  const beforeDirect = reads;
  await __test.openSettingsPanel("read");
  await flushMicrotasks();
  assert.equal(reads, beforeDirect + 1);
  __test.closeSettingsPanel();
  await __test.openSettingsPanel();
  await flushMicrotasks();
  assert.equal(document.getElementById("dtm-settings-section-read").contains(saveControl(document)), true);
  await flushMicrotasks();
  assert.equal(reads, beforeDirect + 2);
});

test("preset color names survive selection, case differences, custom values, and unrelated saves", async (t) => {
  let stored = { style: { backgroundColor: "#E8EDF8", textColor: "#010203" }, enabled: true };
  const saved = [];
  const { document } = settingsRuntime(t, {
    getSettings: async () => ({ settings: stored, settingsRevision: 1, executionRevision: 1 }),
    saveConfig: async (request) => {
      saved.push(request.settings);
      return { settings: request.settings, settingsRevision: 2, executionRevision: 1 };
    },
    cacheStatus: async () => ({ count: 0, bytes: 0 }),
  });
  const catalogs = Object.fromEntries(["en", "zh-Hans", "zh-Hant", "ja"].map((locale) => [locale, require(`../src/mod/ui/i18n/messages/${locale}`)]));
  await __test.openSettingsPanel();
  const background = controlByName(document, "plugin.backgroundColor");
  const ice = background.__dtmControlSource.options.filter((option) => option.label.id === "plugin.color.iceBlue");
  assert.equal(ice.length, 1);
  assert.equal(ice[0].value, "#E8EDF8");
  assert.equal(ice[0].swatch, "#E8EDF8");
  assert.equal(background.__dtmControlSource.options.some((option) => option.label.id === "plugin.color.custom"), false);
  const custom = controlByName(document, "plugin.textColor").__dtmControlSource.options.filter((option) => option.value === "#010203");
  assert.equal(custom.length, 1);
  assert.equal(custom[0].label.id, "plugin.color.custom");
  assert.equal(custom[0].swatch, "#010203");
  for (const option of background.__dtmControlSource.options.concat(controlByName(document, "plugin.textColor").__dtmControlSource.options)) {
    assert.match(option.label.id, /^plugin\.color\./);
    assert.equal(option.swatch, /^auto$/i.test(option.value) ? "auto" : option.value.toUpperCase());
    for (const locale of Object.keys(catalogs)) {
      const label = catalogs[locale][option.label.id];
      assert.equal(typeof label, "string");
      assert.equal(label.length > 0, true);
      assert.equal(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(label), false);
    }
  }
  assert.equal(background.__dtmControlSpec.options.find((option) => option.value === "#303446").label, "石板灰");
  controlByName(document, "plugin.enabled").__dtmControlSpec.onChange(false);
  await saveControl(document).listeners.get("click")();
  assert.equal(saved[0].enabled, false);
  assert.equal(saved[0].style.backgroundColor, "#E8EDF8");
  assert.equal(saved[0].style.textColor, "#010203");
  assert.equal(Object.hasOwn(saved[0], "persistCache"), false);
  __test.applySnapshot({ settings: __test.getSettingsForTests(), settingsRevision: 2, executionRevision: 1, ui: { systemLocale: "ja" } });
  assert.equal(controlByName(document, "plugin.backgroundColor").__dtmControlSpec.options.find((option) => option.value === "#303446").label, "スレート");
  assert.equal(controlByName(document, "plugin.backgroundColor").__dtmControlSource.options.find((option) => option.value === "#303446").label.id, "plugin.color.slate");
  __test.closeSettingsPanel();
  stored = { style: { backgroundColor: "Auto", textColor: "#DBDEE1" } };
  await __test.openSettingsPanel();
  const folded = controlByName(document, "plugin.backgroundColor").__dtmControlSource.options.filter((option) => option.label.id === "plugin.color.auto");
  assert.equal(folded.length, 1);
  assert.equal(folded[0].value, "Auto");
  assert.equal(folded[0].swatch, "auto");
  const gray = controlByName(document, "plugin.textColor").__dtmControlSource.options.filter((option) => option.label.id === "plugin.color.lightGray");
  assert.equal(gray.length, 1);
  assert.equal(gray[0].value, "#DBDEE1");
  assert.equal(gray[0].swatch, "#DBDEE1");
  __test.closeSettingsPanel();
  stored = {};
  await __test.openSettingsPanel();
  assert.equal(controlByName(document, "plugin.backgroundColor").__dtmControlSource.options.find((option) => option.label.id === "plugin.color.iceBlue").value, "#e8edf8");
});

test("a stale cache error cannot return after a successful clear", async (t) => {
  let releaseRead;
  const pending = new Promise((resolve) => { releaseRead = resolve; });
  const toasts = [];
  const { document } = settingsRuntime(t, {
    cacheStatus: () => pending.then(() => ({ error: { code: "STORAGE", reason: "READ_FAILED" } })),
    saveCache: async () => ({}),
  });
  global.window.addEventListener("dtm:show-toast", (event) => toasts.push(event.detail));
  await __test.openSettingsPanel();
  const clear = controlByLabel(document, "plugin.clearCache");
  const status = actionStatusNear(clear);
  await clear.listeners.get("click")();
  assert.equal(status.__dtmControlSource.helperText, "");
  assert.equal(toasts.at(-1).message, "翻译缓存已清除");
  releaseRead();
  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(status.__dtmControlSource.helperText, "");
  assert.equal(status.hidden, true);
});

test("configuration folder failures stay associated with that footer action", async (t) => {
  const { normalizeSettings } = require("../src/shared/settings");
  let saves = 0;
  const { document } = settingsRuntime(t, {
    getSettings: async () => ({ settings: normalizeSettings({}), settingsRevision: 1, executionRevision: 1 }),
    openSettingsFile: async () => ({ ok: false, error: { code: "UNKNOWN" } }),
    cacheStatus: async () => ({ count: 0, bytes: 0 }),
    saveConfig: async (request) => { saves += 1; return { settings: request.settings, settingsRevision: 2, executionRevision: 1 }; },
  });
  await __test.openSettingsPanel();
  await flushMicrotasks();
  const open = controlByLabel(document, "plugin.openConfig");
  const openStatus = actionStatusNear(open);
  assert.equal(openStatus.dataset.dtmActionStatus, "openConfig");
  assert.equal(openStatus.hidden, true);
  await open.listeners.get("click")();
  assert.equal(actionStatusNear(open).__dtmControlSource.helperText.id, "plugin.error.UNKNOWN");
  assert.notEqual(actionStatusNear(saveControl(document)).__dtmControlSource.helperText?.id, "plugin.error.UNKNOWN");
  // Opening the folder never saves or discards the form.
  assert.equal(saves, 0);
  assert.equal(saveControl(document).disabled, true);
});

test("the shared footer carries one four-button group and drops the old per-page rows", async (t) => {
  const { document } = settingsRuntime(t);
  await __test.openSettingsPanel();
  const open = controlByLabel(document, "plugin.openConfig");
  const clear = controlByLabel(document, "plugin.clearCache");
  const discard = discardControl(document);
  const save = saveControl(document);
  // The four existing actions share one compact group in order, save stays primary.
  const groupLabels = () => open.parentElement.children.map((node) => node.__dtmControlSource?.label?.id);
  assert.deepEqual(groupLabels(), ["plugin.openConfig", "plugin.clearCache", "plugin.discard", "plugin.save"]);
  assert.equal(save.__dtmControlSource.variant, "primary");
  assert.equal(open.__dtmControlSource.variant, "secondary");
  assert.equal(clear.__dtmControlSource.variant, "secondary");
  assert.equal(discard.__dtmControlSource.variant, "secondary");
  for (const id of ["plugin.openConfig", "plugin.clearCache", "plugin.discard", "plugin.save"])
    assert.equal(walk(document).filter((node) => node.__dtmControlSource?.label?.id === id).length, 1, id);
  // The emptied setting-row wrappers in General and Translation are gone.
  const rowsIn = (key) => document.getElementById(`dtm-settings-section-${key}`).children.filter((node) => node.dataset.dtmNativeSettingRow === "true");
  assert.equal(rowsIn("general").length, 1);
  assert.equal(rowsIn("general")[0].contains(controlByName(document, "plugin.enabled")), true);
  assert.equal(rowsIn("read").some((row) => row.contains(clear) || row.contains(open)), false);
  // The group lives in the single footer instance and follows the active page.
  const footer = open.parentElement.parentElement.parentElement;
  assert.equal(footer.lastElementChild.className, "dtm-about");
  await __test.openSettingsPanel("style");
  assert.equal(controlByLabel(document, "plugin.openConfig"), open);
  assert.deepEqual(groupLabels(), ["plugin.openConfig", "plugin.clearCache", "plugin.discard", "plugin.save"]);
  assert.equal(document.getElementById("dtm-settings-section-style").contains(open), true);
  assert.equal(document.getElementById("dtm-settings-section-general").contains(controlByName(document, "plugin.enabled")), true);
  assert.equal(walk(document.getElementById("dtm-settings-section-general")).some((node) => node.dataset.dtmActions === "true"), false);
  assert.equal(walk(document).filter((node) => node.__dtmControlSource?.label?.id === "plugin.openConfig").length, 1);
});

test("cache, folder, and save feedback stay independent in the shared footer", async (t) => {
  const { normalizeSettings } = require("../src/shared/settings");
  let saves = 0;
  const { document } = settingsRuntime(t, {
    getSettings: async () => ({ settings: normalizeSettings({}), settingsRevision: 1, executionRevision: 1 }),
    openSettingsFile: async () => ({ ok: false, error: { code: "UNKNOWN" } }),
    cacheStatus: async () => ({ count: 0, bytes: 0 }),
    saveCache: async () => { throw { code: "STORAGE", reason: "WRITE_FAILED" }; },
    saveConfig: async (request) => { saves += 1; return { settings: request.settings, settingsRevision: 2, executionRevision: 1 }; },
  });
  await __test.openSettingsPanel();
  await flushMicrotasks();
  const open = controlByLabel(document, "plugin.openConfig");
  const clear = controlByLabel(document, "plugin.clearCache");
  const saveStatus = actionStatusNear(saveControl(document));
  const openStatus = actionStatusNear(open);
  const cacheStatus = actionStatusNear(clear);
  // Empty statuses hide themselves instead of reserving blank rows.
  for (const status of [saveStatus, openStatus, cacheStatus]) {
    assert.equal(status.dataset.dtmSelfHide, "true");
    assert.equal(status.hidden, true);
    assert.equal(status.getAttribute("hidden"), "");
  }
  controlByName(document, "plugin.customPrompt").__dtmControlSpec.onChange("kept-draft");
  assert.equal(saveStatus.hidden, false);
  await open.listeners.get("click")();
  await clear.listeners.get("click")();
  // Each failure stays in its own footer status and none clobbers the others.
  assert.equal(openStatus.__dtmControlSource.helperText.id, "plugin.error.UNKNOWN");
  assert.equal(cacheStatus.__dtmControlSource.helperText.id, "plugin.error.STORAGE.WRITE_FAILED");
  assert.notEqual(saveStatus.__dtmControlSource.helperText?.id, "plugin.error.UNKNOWN");
  assert.notEqual(saveStatus.__dtmControlSource.helperText?.id, "plugin.error.STORAGE.WRITE_FAILED");
  // Folder and cache actions never save or discard the open draft.
  assert.equal(saves, 0);
  assert.equal(__test.getFormForTests().draft().settings.customPrompt, "kept-draft");
  // Feedback and the draft survive settings-page navigation.
  await __test.openSettingsPanel("model");
  assert.equal(actionStatusNear(controlByLabel(document, "plugin.openConfig")).__dtmControlSource.helperText.id, "plugin.error.UNKNOWN");
  assert.equal(actionStatusNear(controlByLabel(document, "plugin.clearCache")).__dtmControlSource.helperText.id, "plugin.error.STORAGE.WRITE_FAILED");
  assert.equal(__test.getFormForTests().draft().settings.customPrompt, "kept-draft");
});

test("the shared footer keeps the plain version label, one manual update button, and supporter thanks", async (t) => {
  let checks = 0;
  let openMode = "false";
  const opens = [];
  let releaseCheck;
  let releaseLate;
  let releaseOpen = null;
  const firstCheck = new Promise((resolve) => { releaseCheck = resolve; });
  const lateCheck = new Promise((resolve) => { releaseLate = resolve; });
  const toasts = [];
  const { document } = settingsRuntime(t, {
    cacheStatus: async () => ({ count: 0, bytes: 0 }),
    checkUpdate: () => {
      checks += 1;
      if (checks === 1) return firstCheck;
      if (checks === 2) return { ok: false, error: { code: "NETWORK" } };
      if (checks === 3) return { ok: true, updateAvailable: false, latest: "0.1.6" };
      return lateCheck;
    },
    openExternal: async (url) => {
      opens.push(url);
      if (releaseOpen) {
        const pending = releaseOpen;
        releaseOpen = null;
        return pending;
      }
      if (openMode === "false") return { ok: false, error: { code: "UNKNOWN" } };
      if (openMode === "throw") throw Object.assign(new Error("closed"), { code: "UNKNOWN" });
      return { ok: true, url };
    },
  });
  global.window.addEventListener("dtm:show-toast", (event) => toasts.push(event.detail));
  await __test.openSettingsPanel();
  await flushMicrotasks();
  assert.equal(checks, 0);
  const about = walk(document).find((node) => node.className === "dtm-about");
  const thanks = about.lastElementChild;
  assert.equal(thanks.className, "dtm-about-thanks");
  assert.equal(thanks.textContent, "感谢 Lallen 女士 和 Silva 先生 对巴别的支持。");
  assert.equal(thanks.textContent.includes("http"), false);
  let footer = thanks;
  while (footer.parentElement && !footer.parentElement.id) footer = footer.parentElement;
  assert.equal(footer.lastElementChild, about);
  assert.equal(walk(about).some((node) => node.tagName === "A"), false);
  assert.equal(walk(about).some((node) => String(node.className).includes("dtm-about-link")), false);
  assert.equal(walk(about).some((node) => String(node.textContent).includes("麦格")), false);
  const version = walk(about).find((node) => node.className === "dtm-about-version");
  const title = walk(about).find((node) => node.className === "dtm-about-title");
  assert.equal(walk(about).some((node) => node.className === "dtm-about-meta"), false);
  assert.equal(title.contains(version), true);
  assert.equal(version.textContent, `v${require("../src/shared/defaults").BABEL_VERSION}`);
  assert.equal(title.textContent.includes("Babel · 巴别"), true);
  assert.equal(walk(about).filter((node) => node.textContent === "Babel · 巴别").length, 1);
  const button = () => walk(document).find((node) => ["plugin.update.check", "plugin.update.checking", "plugin.update.current", "plugin.update.available", "plugin.update.failed", "plugin.update.openFailed"].includes(node.__dtmControlSource?.label?.id));
  assert.equal(walk(document).filter((node) => node.__dtmControlSource?.label?.id?.startsWith("plugin.update.")).length, 1);
  const update = button();
  assert.equal(update.getAttribute("aria-live"), "polite");
  assert.equal(update.getAttribute("aria-busy"), null);
  assert.equal(update.__dtmControlSource.live, undefined);
  assert.equal(update.__dtmControlSource.busy, undefined);
  assert.equal(update.__dtmControlSpec.label, "检查更新");
  const pending = update.listeners.get("click")();
  update.listeners.get("click")();
  assert.equal(checks, 1);
  assert.equal(update.__dtmControlSource.label.id, "plugin.update.checking");
  assert.equal(update.__dtmControlSpec.label, "检查中…");
  assert.equal(update.__dtmControlSource.loading, true);
  assert.equal(update.__dtmControlSource.live, undefined);
  assert.equal(update.__dtmControlSource.busy, undefined);
  assert.equal(update.getAttribute("aria-live"), "polite");
  assert.equal(update.getAttribute("aria-busy"), "true");
  assert.equal(update.disabled, false);
  openMode = "false";
  releaseCheck({ ok: true, updateAvailable: true, latest: "v9.9.9", url: "https://github.com/itsmaiGe/babel/releases/tag/v9.9.9" });
  await pending;
  await flushMicrotasks();
  assert.equal(update.__dtmControlSource.label.id, "plugin.update.available");
  assert.equal(update.__dtmControlSpec.label, "获取 v9.9.9");
  assert.equal(update.getAttribute("aria-busy"), null);
  assert.equal(update.getAttribute("aria-live"), "polite");
  await __test.openSettingsPanel("model");
  assert.equal(button(), update);
  assert.equal(document.getElementById("dtm-settings-section-model").contains(update), true);
  const toastCount = toasts.length;
  let finishOpen;
  releaseOpen = new Promise((resolve) => { finishOpen = resolve; });
  const opening = update.listeners.get("click")();
  assert.equal(update.getAttribute("aria-busy"), "true");
  assert.equal(update.getAttribute("aria-live"), "polite");
  assert.equal(update.__dtmControlSource.loading, false);
  assert.equal(update.__dtmControlSource.label.id, "plugin.update.available");
  assert.equal(update.__dtmControlSpec.label, "获取 v9.9.9");
  update.listeners.get("click")();
  assert.equal(opens.length, 1);
  finishOpen({ ok: false, error: { code: "UNKNOWN" } });
  await opening;
  assert.equal(checks, 1);
  assert.deepEqual(opens, ["https://github.com/itsmaiGe/babel/releases/tag/v9.9.9"]);
  assert.equal(update.__dtmControlSource.label.id, "plugin.update.openFailed");
  assert.equal(update.__dtmControlSpec.label, "重新打开");
  assert.equal(update.getAttribute("aria-busy"), null);
  assert.equal(toasts.length, toastCount + 1);
  openMode = "throw";
  await update.listeners.get("click")();
  assert.equal(checks, 1);
  assert.equal(update.__dtmControlSource.label.id, "plugin.update.openFailed");
  assert.equal(update.getAttribute("aria-busy"), null);
  openMode = "ok";
  await update.listeners.get("click")();
  assert.equal(checks, 1);
  assert.equal(opens.at(-1), "https://github.com/itsmaiGe/babel/releases/tag/v9.9.9");
  assert.equal(update.__dtmControlSource.label.id, "plugin.update.available");
  assert.equal(update.getAttribute("aria-busy"), null);
  __test.closeSettingsPanel();
  await __test.openSettingsPanel();
  const reopened = button();
  assert.equal(reopened.__dtmControlSource.label.id, "plugin.update.check");
  assert.equal(reopened.getAttribute("aria-live"), "polite");
  assert.equal(reopened.getAttribute("aria-busy"), null);
  await reopened.listeners.get("click")();
  assert.equal(reopened.__dtmControlSource.label.id, "plugin.update.failed");
  assert.equal(reopened.getAttribute("aria-busy"), null);
  await reopened.listeners.get("click")();
  assert.equal(reopened.__dtmControlSource.label.id, "plugin.update.current");
  assert.equal(reopened.__dtmControlSpec.label, "已是最新");
  assert.equal(reopened.getAttribute("aria-busy"), null);
  const again = reopened.listeners.get("click")();
  assert.equal(reopened.__dtmControlSource.label.id, "plugin.update.checking");
  assert.equal(reopened.getAttribute("aria-busy"), "true");
  const beforeClose = toasts.length;
  __test.closeSettingsPanel();
  releaseLate(Object.assign(new Error("late"), { code: "NETWORK" }));
  await again;
  await flushMicrotasks();
  assert.equal(toasts.length, beforeClose);
  await __test.openSettingsPanel();
  assert.equal(button().__dtmControlSource.label.id, "plugin.update.check");
  assert.equal(button().getAttribute("aria-busy"), null);
  assert.equal(button().getAttribute("aria-live"), "polite");
  assert.equal(checks, 4);
});

test("an open read panel shows pause and other translation errors inline", async (t) => {
  const { failure } = require("../src/mod/core/errors");
  let mode = "paused";
  const toasts = [];
  const { document } = settingsRuntime(t, {
    translate: () => {
      if (mode === "ok") return { text: "你好" };
      throw failure(mode === "paused" ? "PAUSED" : "NETWORK");
    },
  });
  global.window.addEventListener("dtm:show-toast", (event) => toasts.push(event.detail));
  await __test.openSettingsPanel();
  const read = document.getElementById("dtm-settings-section-read");
  const pause = walk(read).find((node) => node.__dtmControlSource?.kind === "status" && !node.dataset.dtmActionStatus);
  assert.equal(settingRowOf(pause).hidden, true);
  const paused = chatMessage("9", "1000000000000000001", "Hello");
  const failed = chatMessage("9", "1000000000000000002", "Again");
  const done = chatMessage("9", "1000000000000000003", "Done");
  document.append(paused, failed, done);
  await __test.translateMessage(paused);
  assert.equal(pause.__dtmControlSource.helperText.id, "plugin.error.PAUSED");
  assert.equal(settingRowOf(pause).hidden, false);
  assert.equal(toasts.length, 1);
  const mounts = [];
  global.window.addEventListener("dtm:mount-control", (event) => mounts.push(event.detail));
  __test.getFormForTests().reportReadNotice(pause.__dtmControlSource.helperText);
  assert.equal(mounts.length, 0);
  mode = "network";
  await __test.translateMessage(failed);
  assert.equal(pause.__dtmControlSource.helperText.id, "plugin.error.NETWORK");
  assert.equal(toasts.length, 1);
  mode = "ok";
  await __test.translateMessage(done);
  assert.equal(pause.__dtmControlSource.helperText, "");
  assert.equal(settingRowOf(pause).hidden, true);
});

// ---------------------------------------------------------------------------
// Regression coverage for the reconciled 0.1.6 review findings: automatic
// cancellation at its source (F1), text units without container fallbacks (F2),
// and one live-message identity for the async result paths (F3). The fake-DOM
// fixtures pin the contract; they are not claims about live Discord DOM shapes.
// ---------------------------------------------------------------------------

// The production queue semantics (TranslationService) plus observable
// provider-call and cancel-call logs.
function observedRuntime(t, runtime) {
  const previousDocument = global.document;
  const previousElement = global.Element;
  const previousLocation = global.location;
  const document = new FakeDocument();
  global.document = document;
  global.Element = FakeElement;
  const { TranslationService } = require("../src/mod/core/translation-service");
  const calls = [];
  const cancels = [];
  const cache = {
    entries: new Map(),
    generation: 0,
    ready: Promise.resolve(),
    get(key) { return this.entries.get(key); },
    put(key, value, generation) { if (this.generation === generation) this.entries.set(key, value); },
    clear() { this.generation += 1; this.entries.clear(); return Promise.resolve({}); }
  };
  const service = new TranslationService({
    snapshot: () => ({ settings: JSON.parse(JSON.stringify(__test.getSettingsForTests())), executionRevision: 1 }),
    credential: (model) => ({ apiKey: "", namespace: model.baseUrl }),
    cache,
    provider: {
      translate: async (request) => {
        calls.push(request.text);
        return runtime.provider(request.text);
      }
    }
  });
  __test.setRuntimeForTests({
    ...runtime,
    nativeApi: {
      translate: (request) => service.translate(1, request),
      cancel: (request) => {
        cancels.push([...request.requestIds]);
        return service.cancel(1, request.requestIds);
      },
      clearCache: () => cache.clear()
    }
  });
  if (runtime.location) global.location = runtime.location;
  t.after(() => {
    __test.resetRuntimeForTests();
    if (previousDocument) global.document = previousDocument;
    else delete global.document;
    if (previousElement) global.Element = previousElement;
    else delete global.Element;
    if (previousLocation) global.location = previousLocation;
    else delete global.location;
  });
  return { document, calls, cancels };
}

test("turning only auto-translate off detaches queued and pending automatic work", async t => {
  const clock = autoTranslateClock(t);
  const held = [];
  const { document, calls, cancels } = observedRuntime(t, {
    channelId: "500",
    settings: {
      enabled: true,
      readTranslation: { enabled: true, cache: true },
      autoTranslate: { enabled: true },
      model: { targetLanguage: "简体中文" }
    },
    provider: (text) => {
      const pending = deferredTranslation();
      held.push({ text, pending });
      return pending.promise;
    }
  });
  document.appendChild(chatMessage("500", snowflakeAt(clock.now - 1000), "baseline"));
  __test.runAutoTranslate(); // pins the baseline
  clock.now += 1000;
  const messages = [1, 2, 3, 4].map((index) =>
    chatMessage("500", snowflakeAt(clock.now, index), `automatic message ${index}`),
  );
  document.append(...messages);
  __test.runAutoTranslate(); // enqueues all four automatic messages
  await flushMicrotasks();
  // The background queue admits two: the first two provider calls are held.
  assert.deepEqual([...calls].sort(), ["automatic message 1", "automatic message 2"]);

  // Toggle ONLY autoTranslate.enabled off; the execution revision is unchanged.
  const saved = __test.getSettingsForTests();
  assert.equal(saved.autoTranslate.enabled, true);
  __test.applySnapshot({
    settings: { ...saved, autoTranslate: { ...saved.autoTranslate, enabled: false } },
    executionRevision: 1
  });
  __test.applyAutoTranslateSettings();

  // Settling the held calls must never start the queued two.
  for (const { pending } of held) pending.resolve("T");
  await flushMicrotasks();
  await flushMicrotasks();
  assert.deepEqual([...calls].sort(), ["automatic message 1", "automatic message 2"]);
  // Cancellation removed every pending placeholder without red canceled blocks.
  for (const message of messages) assert.equal(message.querySelectorAll(".dtm-translation-block").length, 0);
  // Exactly the four detached requests were canceled.
  assert.equal(cancels.flat().length, 4);
});

test("switching channels mid-reply never starts the reply body after its quote is detached", async t => {
  const clock = autoTranslateClock(t);
  const held = [];
  const { document, calls, cancels } = observedRuntime(t, {
    channelId: "600",
    location: { pathname: "/channels/1/600" },
    settings: {
      enabled: true,
      readTranslation: { enabled: true, cache: true },
      autoTranslate: { enabled: true },
      model: { targetLanguage: "简体中文" }
    },
    provider: (text) => {
      const pending = deferredTranslation();
      held.push({ text, pending });
      return pending.promise;
    }
  });
  document.appendChild(chatMessage("600", snowflakeAt(clock.now - 1000), "baseline"));
  __test.runAutoTranslate(); // pins the baseline
  clock.now += 1000;
  const reply = new FakeElement("div", "", rect(0, 50, 600, 120));
  reply.id = `chat-messages-600-${snowflakeAt(clock.now)}`;
  const quote = new FakeElement("div", "", rect(0, 50, 400, 20));
  quote.className = "repliedMessage__reply";
  const quoteText = new FakeElement("div", "real quoted text", rect(0, 50, 380, 16));
  quoteText.className = "repliedTextContent__reply";
  quote.appendChild(quoteText);
  const body = new FakeElement("div", "real reply body", rect(0, 74, 400, 24));
  body.className = "messageContent__reply";
  reply.append(quote, body);
  document.appendChild(reply);

  __test.runAutoTranslate(); // production path starts the automatic reply
  await flushMicrotasks();
  // The quote unit is in flight and held; the body must not have started.
  assert.deepEqual(calls, ["real quoted text"]);

  // The old DOM node goes away and the channel changes.
  reply.remove();
  global.location.pathname = "/channels/1/700";
  __test.syncCurrentChannel();

  held[0].pending.resolve("T");
  await flushMicrotasks();
  await flushMicrotasks();
  assert.deepEqual(calls, ["real quoted text"]);
  // The detached quote left no pending placeholder and no red canceled block.
  assert.equal(reply.querySelectorAll(".dtm-translation-block").length, 0);
  assert.equal(cancels.flat().length, 1);
});

test("disabling auto-translate keeps manual consumers sharing a provider job and rendered translations", async t => {
  const clock = autoTranslateClock(t);
  const held = [];
  const { document, calls, cancels } = observedRuntime(t, {
    channelId: "700",
    settings: {
      enabled: true,
      readTranslation: { enabled: true, cache: true },
      autoTranslate: { enabled: true },
      model: { targetLanguage: "简体中文" }
    },
    provider: (text) => {
      if (text === "already rendered") return "T:already rendered";
      const pending = deferredTranslation();
      held.push({ text, pending });
      return pending.promise;
    }
  });
  // A manual translation that completed before auto-translate started.
  const done = chatMessage("700", snowflakeAt(clock.now - 1000), "already rendered");
  document.appendChild(done);
  await __test.translateMessage(done);
  assert.equal(done.querySelector(".dtm-translation-block").textContent, "T:already rendered");

  __test.runAutoTranslate(); // pins the baseline; the manual record predates it
  clock.now += 1000;
  const automatic = chatMessage("700", snowflakeAt(clock.now, 2), "shared text");
  document.appendChild(automatic);
  __test.runAutoTranslate(); // production path starts the automatic message
  await flushMicrotasks();
  // A manual consumer joins the very same provider job for the same text.
  const manual = chatMessage("700", snowflakeAt(clock.now, 3), "shared text");
  document.appendChild(manual);
  const manualTask = __test.translateMessage(manual);
  await flushMicrotasks();
  assert.deepEqual(calls, ["already rendered", "shared text"]);

  const saved = __test.getSettingsForTests();
  __test.applySnapshot({
    settings: { ...saved, autoTranslate: { ...saved.autoTranslate, enabled: false } },
    executionRevision: 1
  });
  __test.applyAutoTranslateSettings();

  held[0].pending.resolve("T:shared text");
  await manualTask;
  await flushMicrotasks();
  // The manual consumer of the shared job still finishes and renders.
  assert.equal(manual.querySelector(".dtm-translation-block").textContent, "T:shared text");
  // The detached automatic consumer renders nothing and leaves no placeholder.
  assert.equal(automatic.querySelectorAll(".dtm-translation-block").length, 0);
  // Successfully rendered translations survive the disable.
  assert.equal(done.querySelector(".dtm-translation-block").textContent, "T:already rendered");
  // Only the automatic consumer's request id was canceled.
  assert.deepEqual(cancels, [["babel:2"]]);
});

test("repeated disabled maintenance performs no record traversal and adds no cancellation sweep", async t => {
  const clock = autoTranslateClock(t);
  const held = [];
  const { document, calls, cancels } = observedRuntime(t, {
    channelId: "800",
    settings: {
      enabled: true,
      readTranslation: { enabled: true, cache: true },
      autoTranslate: { enabled: true },
      model: { targetLanguage: "简体中文" }
    },
    provider: (text) => {
      const pending = deferredTranslation();
      held.push({ text, pending });
      return pending.promise;
    }
  });
  document.appendChild(chatMessage("800", snowflakeAt(clock.now - 1000), "baseline"));
  __test.runAutoTranslate(); // pins the baseline
  clock.now += 1000;
  const one = chatMessage("800", snowflakeAt(clock.now, 1), "held one");
  const two = chatMessage("800", snowflakeAt(clock.now, 2), "held two");
  document.append(one, two);
  __test.runAutoTranslate(); // production path enqueues both automatic messages
  await flushMicrotasks();
  assert.equal(calls.length, 2);

  // Observe the actual cancellation-record traversal, not only cancel calls.
  const records = __test.displayState().records, original = records.values;
  let scans = 0, visits = 0;
  records.values = function* () { scans++; for (const value of original.call(this)) { visits++; yield value; } };

  const saved = __test.getSettingsForTests();
  __test.applySnapshot({
    settings: { ...saved, autoTranslate: { ...saved.autoTranslate, enabled: false } },
    executionRevision: 1
  });
  __test.applyAutoTranslateSettings();
  // Exactly one transition sweep visited the two automatic records.
  assert.equal(scans, 1);
  assert.equal(visits, 2);
  assert.equal(cancels.length, 2);

  // Later disabled DOM maintenance passes never traverse the records again,
  // even while the detached requests are still pending.
  for (let i = 0; i < 5; i += 1) __test.runAutoTranslate();
  __test.applyAutoTranslateSettings();
  assert.equal(scans, 1);
  assert.equal(visits, 2);
  assert.equal(cancels.length, 2);

  for (const { pending } of held) pending.resolve("T");
  await flushMicrotasks();
  assert.equal(calls.length, 2);
  assert.equal(cancels.length, 2);
});

test("metadata-only and empty messages request nothing for translation", async t => {
  const calls = [];
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: { translate: async ({ text }) => { calls.push(text); return { text: "T:" + text }; } }
  });

  // Author, timestamp and attachment, but no body at all.
  const metadataOnly = new FakeElement("div", "", rect(0, 0, 600, 120));
  metadataOnly.id = "chat-messages-meta-1000000000000000001";
  const author = new FakeElement("div", "Example author", rect(0, 0, 400, 16));
  author.className = "username__meta";
  const time = new FakeElement("div", "Today", rect(0, 0, 400, 12));
  time.className = "timestamp__meta";
  const attachment = new FakeElement("div", "", rect(0, 0, 400, 60));
  attachment.className = "attachment__meta";
  const fileName = new FakeElement("div", "image.png", rect(0, 0, 400, 14));
  fileName.className = "fileNameLink__meta";
  attachment.appendChild(fileName);
  metadataOnly.append(author, time, attachment);

  // A recognized but empty body surrounded by the same metadata.
  const emptyBody = new FakeElement("div", "", rect(0, 0, 600, 120));
  emptyBody.id = "chat-messages-meta-1000000000000000002";
  const emptyContent = new FakeElement("div", "", rect(0, 0, 400, 24));
  emptyContent.className = "messageContent__meta";
  emptyBody.append(author.cloneNode(true), emptyContent, attachment.cloneNode(true));

  document.append(metadataOnly, emptyBody);
  await __test.translateMessage(metadataOnly);
  await __test.translateMessage(emptyBody);
  assert.deepEqual(calls, []);
  assert.equal(metadataOnly.querySelectorAll(".dtm-translation-block").length, 0);
  assert.equal(emptyBody.querySelectorAll(".dtm-translation-block").length, 0);
});

test("a metadata-only quote preview never translates; the real reply body still does", async t => {
  const calls = [];
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: { translate: async ({ text }) => { calls.push(text); return { text: "T:" + text }; } }
  });
  const reply = new FakeElement("div", "", rect(0, 50, 600, 120));
  reply.id = "chat-messages-reply-1000000000000000003";
  const quote = new FakeElement("div", "", rect(0, 50, 400, 20));
  quote.className = "repliedMessage__meta";
  const quoteAuthor = new FakeElement("div", "Example author", rect(0, 50, 380, 16));
  quoteAuthor.className = "username__meta";
  const quoteFile = new FakeElement("div", "image.png", rect(0, 50, 380, 14));
  quoteFile.className = "fileNameLink__meta";
  quote.append(quoteAuthor, quoteFile);
  const body = new FakeElement("div", "real reply body", rect(0, 74, 400, 24));
  body.className = "messageContent__meta";
  reply.append(quote, body);
  document.appendChild(reply);

  await __test.translateMessage(reply);
  assert.deepEqual(calls, ["real reply body"]);
  const blocks = Array.from(reply.querySelectorAll(".dtm-translation-block"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].dataset.dtmUnit, "content");
});

test("ordinary text, text replies and text with attachments still translate their own units", async t => {
  const calls = [];
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: { translate: async ({ text }) => { calls.push(text); return { text: "T:" + text }; } }
  });

  const plain = chatMessage("1", "1000000000000000004", "ordinary text");

  const reply = new FakeElement("div", "", rect(0, 50, 600, 120));
  reply.id = "chat-messages-reply-1000000000000000005";
  const quote = new FakeElement("div", "", rect(0, 50, 400, 20));
  quote.className = "repliedMessage__keep";
  const quoteText = new FakeElement("div", "original quoted text", rect(0, 50, 380, 16));
  quoteText.className = "repliedTextContent__keep";
  quote.appendChild(quoteText);
  const body = new FakeElement("div", "my reply body", rect(0, 74, 400, 24));
  body.className = "messageContent__keep";
  reply.append(quote, body);

  const withAttachment = new FakeElement("div", "", rect(0, 0, 600, 160));
  withAttachment.id = "chat-messages-attach-1000000000000000006";
  const text = new FakeElement("div", "hello with attachment", rect(0, 0, 400, 24));
  text.className = "messageContent__keep";
  const attachment = new FakeElement("div", "", rect(0, 30, 400, 60));
  attachment.className = "attachment__keep";
  const fileName = new FakeElement("div", "image.png", rect(0, 30, 400, 14));
  fileName.className = "fileNameLink__keep";
  attachment.appendChild(fileName);
  withAttachment.append(text, attachment);

  document.append(plain, reply, withAttachment);
  await __test.translateMessage(plain);
  await __test.translateMessage(reply);
  await __test.translateMessage(withAttachment);
  assert.deepEqual(calls, ["ordinary text", "original quoted text", "my reply body", "hello with attachment"]);
  assert.equal(withAttachment.querySelectorAll(".dtm-translation-block").length, 1);
});

function dataOnlyMessage(snowflake, text) {
  const message = new FakeElement("div", "", rect(0, 0, 600, 80));
  const listItemId = `chat-messages-1-${snowflake}`;
  // The fake DOM separates attributes from dataset, so populate both.
  message.setAttribute("data-list-item-id", listItemId);
  message.dataset.listItemId = listItemId;
  const content = new FakeElement("div", text, rect(0, 0, 400, 24));
  content.className = "messageContent__data";
  message.appendChild(content);
  return message;
}

test("data-list-item-id-only messages render results and errors immediately", async t => {
  const calls = [];
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: {
      translate: ({ text }) => {
        calls.push(text);
        if (text === "fails") return Promise.reject(new Error("provider down"));
        return Promise.resolve({ text: "T:" + text });
      }
    }
  });

  // The successful result appears immediately, without any restore pass.
  const ok = dataOnlyMessage("2000000000000000001", "translatable");
  document.appendChild(ok);
  await __test.translateMessage(ok);
  assert.equal(ok.querySelector(".dtm-translation-block").textContent, "T:translatable");

  // Errors land on the same live node right away.
  const failing = dataOnlyMessage("2000000000000000002", "fails");
  document.appendChild(failing);
  await __test.translateMessage(failing);
  const errorBlock = failing.querySelector(".dtm-translation-block");
  assert.ok(errorBlock);
  assert.equal(errorBlock.dataset.dtmError, "true");

  // The existing HTML-id identity works in the same pass.
  const byId = chatMessage("1", "2000000000000000003", "id based");
  document.appendChild(byId);
  await __test.translateMessage(byId);
  assert.equal(byId.querySelector(".dtm-translation-block").textContent, "T:id based");
  assert.deepEqual(calls, ["translatable", "fails", "id based"]);
});

test("replaced and removed nodes never receive stale translation output", async t => {
  const pending = new Map();
  const document = readingRuntime(t, {
    settings: {},
    nativeApi: {
      translate: ({ text }) => {
        const deferred = deferredTranslation();
        pending.set(text, deferred);
        return deferred.promise;
      }
    }
  });

  // A replaced node with the same identity gets the result on the live node.
  const oldNode = chatMessage("1", "3000000000000000001", "same text");
  document.appendChild(oldNode);
  const replacedTask = __test.translateMessage(oldNode);
  const freshNode = chatMessage("1", "3000000000000000001", "same text");
  oldNode.remove();
  document.appendChild(freshNode);
  await flushMicrotasks();
  pending.get("same text").resolve({ text: "T:same text" });
  await replacedTask;
  assert.equal(freshNode.querySelector(".dtm-translation-block").textContent, "T:same text");
  assert.equal(walk(oldNode).some((node) => node.textContent === "T:same text"), false);

  // A replaced node whose source text changed gets no stale output at all.
  const staleNode = chatMessage("1", "3000000000000000002", "before edit");
  document.appendChild(staleNode);
  const staleTask = __test.translateMessage(staleNode);
  const renamedNode = chatMessage("1", "3000000000000000002", "after edit");
  staleNode.remove();
  document.appendChild(renamedNode);
  await flushMicrotasks();
  pending.get("before edit").resolve({ text: "T:before edit" });
  await staleTask;
  assert.equal(renamedNode.querySelectorAll(".dtm-translation-block").length, 0);
  assert.equal(walk(renamedNode).some((node) => node.textContent === "T:before edit"), false);

  // A removed node renders nothing and keeps no pending placeholder.
  const goneNode = chatMessage("1", "3000000000000000003", "gone");
  document.appendChild(goneNode);
  const goneTask = __test.translateMessage(goneNode);
  goneNode.remove();
  await flushMicrotasks();
  pending.get("gone").resolve({ text: "T:gone" });
  await goneTask;
  assert.equal(goneNode.querySelectorAll(".dtm-translation-block").length, 0);
  assert.equal(walk(document).some((node) => node.textContent === "T:gone"), false);

  // Source text edited in place never displays the obsolete result.
  const editedNode = chatMessage("1", "3000000000000000004", "unedited");
  document.appendChild(editedNode);
  const editedTask = __test.translateMessage(editedNode);
  editedNode.children[0].textContent = "edited in place";
  await flushMicrotasks();
  pending.get("unedited").resolve({ text: "T:unedited" });
  await editedTask;
  assert.equal(editedNode.querySelectorAll(".dtm-translation-block").length, 0);
});

test("disabled maintenance never traverses display records when no automatic work exists", async t => {
  const document = readingRuntime(t, {
    settings: { autoTranslate: { enabled: false } },
    nativeApi: { translate: async ({ text }) => ({ text: "T:" + text }) }
  });
  const message = chatMessage("100", "123456789123456789", "some text");
  document.append(message);
  await __test.translateMessage(message); // one completed manual record
  assert.equal(message.querySelector(".dtm-translation-block").textContent, "T:some text");

  // Observe the actual cancellation-record traversal, not only cancel calls.
  const records = __test.displayState().records, original = records.values;
  let scans = 0, visits = 0;
  records.values = function* () { scans++; for (const value of original.call(this)) { visits++; yield value; } };
  for (let i = 0; i < 5; i += 1) __test.runAutoTranslate();
  assert.equal(scans, 0);
  assert.equal(visits, 0);
  // The rendered manual translation is untouched by the disabled passes.
  assert.equal(message.querySelector(".dtm-translation-block").textContent, "T:some text");
});

test("an already delivered result cannot outlive its cancellation in the DOM or stored state", async t => {
  const clock = autoTranslateClock(t);
  let cancellations = 0;
  const document = readingRuntime(t, {
    channelId: "100",
    settings: {
      enabled: true,
      readTranslation: { enabled: true, cache: true },
      autoTranslate: { enabled: true },
      model: { targetLanguage: "简体中文" }
    },
    nativeApi: {}
  });
  // A native stub whose translate result is already delivered when the cancel
  // arrives: cancellation cannot recall it, so the local token/state lifecycle
  // must discard it.
  __test.setRuntimeForTests({
    channelId: "100",
    settings: {
      enabled: true,
      readTranslation: { enabled: true, cache: true },
      autoTranslate: { enabled: true },
      model: { targetLanguage: "简体中文" }
    },
    nativeApi: {
      translate: () => Promise.resolve({ text: "T:already delivered" }),
      cancel: () => { cancellations += 1; return Promise.resolve(); }
    }
  });
  __test.applyAutoTranslateSettings(); // pins the baseline
  clock.now += 1000;
  const message = chatMessage("100", snowflakeAt(clock.now), "some new text");
  document.append(message);
  __test.runAutoTranslate(); // production path starts the automatic message

  const cfg = __test.getSettingsForTests();
  __test.applySnapshot({ settings: { ...cfg, autoTranslate: { ...cfg.autoTranslate, enabled: false } }, executionRevision: 1 });
  __test.applyAutoTranslateSettings();
  await flushMicrotasks();

  // Real automatic cancellation happened, yet no stale loading block remains.
  assert.equal(cancellations, 1);
  assert.equal(message.querySelectorAll(".dtm-translation-block").length, 0);

  // The canceled result is not restorable from the stored unit state.
  __test.restoreVisibleTranslations([message]);
  assert.equal(message.querySelectorAll(".dtm-translation-block").length, 0);
  const record = __test.displayState().get(message.id);
  assert.deepEqual([...record.units.values()].filter((state) => state.status === "success"), []);
  assert.equal(record.units.size, 0);
});

test("an older canceled continuation never removes a newer manual translation of the same message", async t => {
  const clock = autoTranslateClock(t);
  const pending = [];
  const document = readingRuntime(t, {
    channelId: "300",
    settings: {
      enabled: true,
      readTranslation: { enabled: true, cache: true },
      autoTranslate: { enabled: true },
      model: { targetLanguage: "简体中文" }
    },
    nativeApi: {}
  });
  // A native stub whose issued calls settle only when the fixture releases
  // them; cancel cannot recall them.
  __test.setRuntimeForTests({
    channelId: "300",
    settings: {
      enabled: true,
      readTranslation: { enabled: true, cache: true },
      autoTranslate: { enabled: true },
      model: { targetLanguage: "简体中文" }
    },
    nativeApi: {
      translate: (request) => {
        const deferred = deferredTranslation();
        pending.push({ text: request.text, deferred });
        return deferred.promise;
      },
      cancel: () => Promise.resolve()
    }
  });
  __test.applyAutoTranslateSettings(); // pins the baseline
  clock.now += 1000;
  const first = chatMessage("300", snowflakeAt(clock.now, 1), "first source");
  const second = chatMessage("300", snowflakeAt(clock.now, 2), "second source");
  document.append(first, second);
  __test.runAutoTranslate();
  await flushMicrotasks();
  assert.deepEqual(pending.map((entry) => entry.text), ["first source", "second source"]);

  // Disable only auto-translate at the same execution revision: the two
  // already issued automatic calls stay in flight.
  const cfg = __test.getSettingsForTests();
  __test.applySnapshot({ settings: { ...cfg, autoTranslate: { ...cfg.autoTranslate, enabled: false } }, executionRevision: 1 });
  __test.applyAutoTranslateSettings();

  // Newer manual translations of the same messages take over.
  const manualFirst = __test.translateMessage(first);
  const manualSecond = __test.translateMessage(second);
  await flushMicrotasks();
  pending[2].deferred.resolve({ text: "manual first" });
  pending[3].deferred.resolve({ text: "manual second" });
  await Promise.all([manualFirst, manualSecond]);
  assert.equal(first.querySelector(".dtm-translation-block").textContent, "manual first");
  assert.equal(second.querySelector(".dtm-translation-block").textContent, "manual second");

  // The older continuations settle late — one rejects as canceled, one was
  // already delivered — and may never erase the newer manual blocks.
  pending[0].deferred.reject(Object.assign(new Error("canceled"), { code: "CANCELED" }));
  pending[1].deferred.resolve({ text: "stale second" });
  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(first.querySelector(".dtm-translation-block").textContent, "manual first");
  assert.equal(second.querySelector(".dtm-translation-block").textContent, "manual second");
  __test.restoreVisibleTranslations([first, second]);
  assert.equal(first.querySelector(".dtm-translation-block").textContent, "manual first");
  assert.equal(second.querySelector(".dtm-translation-block").textContent, "manual second");
});

test("the API format selector appears only for providers with multiple formats", async (t) => {
  const { document } = settingsRuntime(t);
  await __test.openSettingsPanel();
  const format = () => controlByName(document, "plugin.protocol");
  assert.ok(format());
  assert.equal(__test.text(format().__dtmControlSource.name), "接口协议");
  assert.equal(format().__dtmControlSpec.value, "openai");
  assert.deepEqual(format().__dtmControlSpec.options.map((option) => option.value), ["openai", "responses"]);
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("custom");
  assert.deepEqual(format().__dtmControlSpec.options.map((option) => option.value), ["openai", "responses", "anthropic"]);
  for (const provider of ["anthropic", "deepseek", "google"]) {
    controlByName(document, "plugin.provider").__dtmControlSpec.onChange(provider);
    assert.equal(format(), undefined, provider);
  }
});

test("switching provider resets the API format to that provider's default", async (t) => {
  const { document } = settingsRuntime(t);
  await __test.openSettingsPanel();
  controlByName(document, "plugin.protocol").__dtmControlSpec.onChange("responses");
  assert.equal(__test.getFormForTests().draft().settings.model.protocol, "responses");
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("anthropic");
  assert.equal(__test.getFormForTests().draft().settings.model.protocol, "anthropic");
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("custom");
  assert.equal(__test.getFormForTests().draft().settings.model.protocol, "openai");
  assert.equal(controlByName(document, "plugin.protocol").__dtmControlSpec.value, "openai");
  controlByName(document, "plugin.provider").__dtmControlSpec.onChange("openai");
  assert.equal(__test.getFormForTests().draft().settings.model.protocol, "openai");
  assert.deepEqual(controlByName(document, "plugin.protocol").__dtmControlSpec.options.map((option) => option.value), ["openai", "responses"]);
});

test("changing the API format marks the form changed without resetting the key", async (t) => {
  const { document } = settingsRuntime(t);
  await __test.openSettingsPanel();
  const form = __test.getFormForTests();
  const apiKey = () => walk(document).find((node) => node.__dtmControlSpec?.name === "API Key");
  const keyControl = apiKey();
  keyControl.__dtmControlSpec.onChange("test-only-key");
  controlByName(document, "plugin.protocol").__dtmControlSpec.onChange("responses");
  const draft = form.draft();
  // The change is pending against the saved configuration and stays unsaved.
  assert.equal(draft.settings.model.protocol, "responses");
  assert.equal(draft.base.model.protocol, "openai");
  // The key and its field are untouched by a format change.
  assert.equal(form.keyActionForTests(), "replace");
  assert.equal(apiKey(), keyControl);
  // The model field re-renders with the new format and keeps its value.
  assert.equal(controlByName(document, "plugin.model").__dtmControlSpec.value, "gpt-4.1-mini");
});

test("the model list cache key includes the format", async (t) => {
  const calls = [];
  const { document } = settingsRuntime(t, {
    listModels: (request) => {
      calls.push(request.settings.model.protocol);
      return Promise.resolve({ models: [{ value: `model-${calls.length}`, label: `Model ${calls.length}` }] });
    },
  });
  await __test.openSettingsPanel();
  const refresh = () => walk(document).find((node) => node.__dtmControlSource?.label?.id === "plugin.refreshModels").listeners.get("click")();
  const options = () => (controlByName(document, "plugin.model").__dtmControlSpec.options || []).map((option) => option.value);
  await refresh();
  assert.ok(options().includes("model-1"));
  controlByName(document, "plugin.protocol").__dtmControlSpec.onChange("responses");
  assert.equal(options().includes("model-1"), false);
  await refresh();
  assert.ok(options().includes("model-2"));
  controlByName(document, "plugin.protocol").__dtmControlSpec.onChange("openai");
  assert.ok(options().includes("model-1"));
  assert.deepEqual(calls, ["openai", "responses"]);
});

test("in-flight model list and test connection results are dropped after a format change", async (t) => {
  const models = deferredTranslation();
  const connection = deferredTranslation();
  const secondConnection = deferredTranslation();
  const connections = [connection, secondConnection];
  const { document } = settingsRuntime(t, {
    listModels: () => models.promise,
    testConnection: () => connections.shift().promise,
  });
  await __test.openSettingsPanel();
  const action = (id) => walk(document).find((node) => node.__dtmControlSource?.label?.id === id);
  action("plugin.refreshModels").listeners.get("click")();
  action("plugin.testConnection").listeners.get("click")();
  controlByName(document, "plugin.protocol").__dtmControlSpec.onChange("responses");
  models.resolve({ models: [{ value: "stale-model", label: "Stale" }] });
  connection.resolve({ ok: true, text: "stale" });
  await flushMicrotasks();
  const options = (controlByName(document, "plugin.model").__dtmControlSpec.options || []).map((option) => option.value);
  assert.equal(options.includes("stale-model"), false);
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.connectionSuccess"), false);
  // Without a format change the same results are accepted.
  action("plugin.testConnection").listeners.get("click")();
  secondConnection.resolve({ ok: true, text: "fresh" });
  await flushMicrotasks();
  assert.equal(walk(document).some((node) => node.__dtmControlSource?.helperText?.id === "plugin.connectionSuccess"), true);
});
